import { db } from "@/lib/db";
import { lines, records, keys, dispatchLocks } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { addLog, executeImport, saveChannelSlots, createRecordAndAdvanceName, getCookie, getAuthHeaders } from "@/lib/channel";

const FREEZE_AFTER = 5 * 60;
const BILLING_GRACE = 3 * 60;
const LOCK_TTL = 60;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function acquireLock(key: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.select().from(dispatchLocks).where(eq(dispatchLocks.lockKey, key)).get();
  if (existing && now - existing.lockedAt < LOCK_TTL) return false;
  if (existing) {
    db.update(dispatchLocks).set({ lockedAt: now }).where(eq(dispatchLocks.lockKey, key)).run();
  } else {
    db.insert(dispatchLocks).values({ lockKey: key, lockedAt: now }).run();
  }
  return true;
}

function releaseLock(key: string) {
  db.delete(dispatchLocks).where(eq(dispatchLocks.lockKey, key)).run();
}

async function fetchChannels(cfg: Record<string, string>, name: string) {
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const authValue = cfg.authValue || "";
  if (!baseUrl || !authValue) return null;
  const cookie = getCookie(cfg);
  const url = `${baseUrl}/api/channel/search?keyword=${encodeURIComponent(name)}&group=&model=&id_sort=false&tag_mode=false&p=1&page_size=100`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json", "Accept": "application/json",
    "New-API-User": cfg.newApiUser || "3", "Cache-Control": "no-store",
  };
  if (cookie) headers["Cookie"] = cookie;
  try {
    const resp = await fetch(url, { method: "GET", headers });
    const data = await resp.json();
    if (data.success !== false && data.data?.items) {
      return (data.data.items as Array<{ name: string; status: number; used_quota: number }>).filter(ch => ch.name === name);
    }
  } catch { /* ignore */ }
  return null;
}

function checkTrigger(rec: { keyCount: number; disabledCount: number; cachedQuota: number }, cfg: Record<string, string>): boolean {
  const mode = cfg.triggerMode || "dead_ratio";
  if (rec.keyCount <= 0) return false;

  if (mode === "dead_ratio") {
    const threshold = parseFloat(cfg.triggerDeadRatio) || 0.67;
    return rec.disabledCount / rec.keyCount >= threshold;
  }
  if (mode === "quota_total") {
    const threshold = parseInt(cfg.triggerQuotaTotal) || 0;
    return threshold > 0 && rec.cachedQuota >= threshold;
  }
  if (mode === "quota_avg") {
    const threshold = parseInt(cfg.triggerQuotaAvg) || 0;
    return threshold > 0 && rec.cachedQuota / rec.keyCount >= threshold;
  }
  return false;
}

async function doImportForLine(line: any, cfg: Record<string, string>, batchSize: number, logPrefix: string) {
  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(batchSize).all();
  if (!poolKeys.length) {
    addLog(line.id, `${logPrefix} 密钥池为空，跳过`, "warn");
    return false;
  }
  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const strategy = cfg.importStrategy || "default";
  addLog(line.id, `${logPrefix} 导入 ${useKeys.length} 个密钥 (${strategy})`, "info");

  const result = await executeImport(cfg, useKeys, line.id);
  if (result.ok) {
    saveChannelSlots(line.id, result.channelIds, cfg.channelName || "");
    createRecordAndAdvanceName(line.id, cfg, useKeys, strategy);
    addLog(line.id, `${logPrefix} 成功！`, "ok");
    return true;
  }

  for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
  addLog(line.id, `${logPrefix} 失败，密钥已退回池中`, "warn");
  return false;
}

async function autoImportGlobal(groupLines: Map<string, any[]>, allCfgs: Map<number, Record<string, string>>) {
  for (const [group, gLines] of groupLines) {
    let totalChannels = 0, totalDisabled = 0, totalQuota = 0;
    let hasUnmonitored = false;
    for (const line of gLines) {
      const unfrozen = db.select().from(records).where(eq(records.lineId, line.id)).all().filter(r => !r.frozen);
      const latest = unfrozen[unfrozen.length - 1];
      if (latest && latest.lastRefresh === null) {
        hasUnmonitored = true;
      }
      if (latest) {
        totalChannels += latest.keyCount;
        totalDisabled += latest.disabledCount;
        totalQuota += latest.cachedQuota;
      }
    }

    if (hasUnmonitored) continue;
    if (totalChannels <= 0) continue;

    const firstCfg = allCfgs.get(gLines[0].id) || {};
    if (!checkTrigger({ keyCount: totalChannels, disabledCount: totalDisabled, cachedQuota: totalQuota }, firstCfg)) continue;

    const lockKey = `group:${group}`;
    if (!acquireLock(lockKey)) continue;

    try {
      const groupBatch = parseInt(firstCfg.globalGroupBatch) || 10;
      const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(groupBatch).all();
      if (!poolKeys.length) { releaseLock(lockKey); continue; }
      const useKeys = poolKeys.map(k => k.key);
      for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

      let anySuccess = false;
      for (const line of gLines) {
        const cfg = allCfgs.get(line.id) || {};
        const ratio = parseInt(cfg.globalRatio as string) || 100;
        if (ratio <= 0) continue;
        const n = Math.round(useKeys.length * ratio / 100);
        const lineKeys = ratio >= 100 ? useKeys : shuffle(useKeys).slice(0, Math.max(1, n));

        const strategy = cfg.importStrategy || "default";
        addLog(line.id, `[自动上弹-全局/${group}] 导入 ${lineKeys.length} 个密钥 (${strategy}, ${ratio}%)`, "info");
        const result = await executeImport(cfg as Record<string, string>, lineKeys, line.id);
        if (result.ok) {
          saveChannelSlots(line.id, result.channelIds, cfg.channelName || "");
          createRecordAndAdvanceName(line.id, cfg as Record<string, string>, lineKeys, strategy);
          anySuccess = true;
        }
      }

      if (!anySuccess) {
        for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
        for (const line of gLines) addLog(line.id, `[自动上弹-全局/${group}] 所有线路均失败，密钥已退回池中`, "warn");
      }
    } finally {
      releaseLock(lockKey);
    }
  }
}

export async function POST() {
  const allLines = db.select().from(lines).all();
  const now = Math.floor(Date.now() / 1000);
  let updated = 0;
  let cooldown = false;

  const globalGroupLines = new Map<string, any[]>();
  const allCfgs = new Map<number, Record<string, string>>();

  for (const line of allLines) {
    const cfg = JSON.parse(line.config);
    allCfgs.set(line.id, cfg);
    const isGlobal = cfg.importMode === "global";
    const recs = db.select().from(records).where(eq(records.lineId, line.id)).all();

    // Phase 1: Monitor all non-frozen records
    for (const r of recs) {
      if (r.frozen) {
        const frozenAt = r.allDisabledSince ? r.allDisabledSince + FREEZE_AFTER : 0;
        if (frozenAt && now - frozenAt < BILLING_GRACE) {
          const channels = await fetchChannels(cfg, r.name);
          if (channels) {
            const totalQuota = channels.reduce((s, ch) => s + (ch.used_quota || 0), 0);
            db.update(records).set({ cachedQuota: totalQuota, lastRefresh: now }).where(eq(records.id, r.id)).run();
            updated++;
          }
        }
        continue;
      }
      const channels = await fetchChannels(cfg, r.name);
      if (!channels) continue;
      const totalQuota = channels.reduce((s, ch) => s + (ch.used_quota || 0), 0);
      const disabledCount = channels.filter(ch => ch.status === 3).length;
      const allDisabled = channels.length > 0 && disabledCount === channels.length;
      const upd: Record<string, unknown> = { cachedQuota: totalQuota, keyCount: channels.length, disabledCount, lastRefresh: now };
      if (allDisabled) {
        if (!r.allDisabledSince) upd.allDisabledSince = now;
        else if (now - r.allDisabledSince >= FREEZE_AFTER) upd.frozen = 1;
      } else {
        upd.allDisabledSince = null;
      }
      db.update(records).set(upd).where(eq(records.id, r.id)).run();
      updated++;
    }

    // Phase 2: Trigger check
    if (line.autoEnabled) {
      const strategy = cfg.importStrategy || "default";
      const allRecs = db.select().from(records).where(eq(records.lineId, line.id)).all();
      const unfrozen = allRecs.filter(r => !r.frozen);
      const latest = unfrozen[unfrozen.length - 1];

      // fixed_slots 策略：监控每个固定渠道，哪个挂了就换哪个的 key
      if (strategy === "fixed_slots") {
        const slotIds: number[] = JSON.parse(cfg.fixedSlotIds || "[]");
        if (slotIds.length === 0) continue;

        const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
        const headers = getAuthHeaders(cfg);
        const cookie = getCookie(cfg);
        const searchHeaders: Record<string, string> = {
          "Content-Type": "application/json", "Accept": "application/json",
          "New-API-User": cfg.newApiUser || "3", "Cache-Control": "no-store",
        };
        if (cookie) searchHeaders["Cookie"] = cookie;

        // 逐个检查渠道状态
        for (const chId of slotIds) {
          try {
            const resp = await fetch(`${baseUrl}/api/channel/${chId}`, { headers: searchHeaders });
            const data = await resp.json();
            const ch = data.data || data;
            if (!ch || !ch.id) continue;

            if (ch.status === 3) {
              // 渠道被禁用，换 key
              const lockKey = `slot:${line.id}:${chId}`;
              if (!acquireLock(lockKey)) continue;
              try {
                const poolKey = db.select().from(keys).orderBy(asc(keys.id)).limit(1).all();
                if (!poolKey.length) {
                  addLog(line.id, `[固定槽位] 渠道 ${chId} 需要换key但密钥池为空`, "warn");
                  continue;
                }
                const newKey = poolKey[0].key;
                db.delete(keys).where(eq(keys.id, poolKey[0].id)).run();

                const putResp = await fetch(`${baseUrl}/api/channel/`, {
                  method: "PUT", headers,
                  body: JSON.stringify({ id: chId, key: "\n" + newKey, status: 1 }),
                });
                if (putResp.ok) {
                  addLog(line.id, `[固定槽位] 渠道 ${chId} 已换key+启用`, "ok");
                  cooldown = true;
                } else {
                  db.insert(keys).values({ key: newKey }).run();
                  addLog(line.id, `[固定槽位] 渠道 ${chId} 换key失败: ${putResp.status}`, "err");
                }
              } finally {
                releaseLock(lockKey);
              }
            }
            updated++;
          } catch { /* skip */ }
        }
        continue;
      }

      // rotate 策略：检测到冻结批次就换 key，换完解冻
      if (strategy === "rotate") {
        const frozenRecs = allRecs.filter(r => r.frozen);
        const latestFrozen = frozenRecs[frozenRecs.length - 1];
        if (latestFrozen) {
          const lockKey = `line:${line.id}:rotate`;
          if (acquireLock(lockKey)) {
            try {
              const batchSize = line.autoBatchSize || 10;
              const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(batchSize).all();
              if (poolKeys.length > 0) {
                const useKeys = poolKeys.map(k => k.key);
                for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();
                addLog(line.id, `[自动换key] 换 ${useKeys.length} 个密钥 → 「${latestFrozen.name}」`, "info");
                const result = await executeImport(cfg, useKeys, line.id);
                addLog(line.id, `[自动换key] executeImport 返回 ok=${result.ok}`, "info");
                if (result.ok) {
                  db.update(records).set({ frozen: 0, allDisabledSince: null, disabledCount: 0 }).where(eq(records.id, latestFrozen.id)).run();
                  addLog(line.id, `[自动换key] 「${latestFrozen.name}」已换key+解冻 (recordId=${latestFrozen.id})`, "ok");
                } else {
                  for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
                  addLog(line.id, `[自动换key] 换key失败 ok=${result.ok}，密钥已退回`, "warn");
                }
                cooldown = true;
              }
            } finally {
              releaseLock(lockKey);
            }
          }
        }
        continue;
      }

      // 跳过刚创建还没被刷新过的批次
      if (latest && latest.lastRefresh === null) {
        continue;
      }

      if (latest && latest.keyCount > 0 && checkTrigger(latest, cfg)) {
        if (isGlobal) {
          const g = cfg.globalGroup || "默认";
          if (!globalGroupLines.has(g)) globalGroupLines.set(g, []);
          globalGroupLines.get(g)!.push(line);
        } else {
          const lockKey = `line:${line.id}`;
          if (acquireLock(lockKey)) {
            try {
              await doImportForLine(line, cfg, line.autoBatchSize || 10, "[自动上弹-单独]");
              cooldown = true;
            } finally {
              releaseLock(lockKey);
            }
          }
        }
      }
    }
  }

  if (globalGroupLines.size > 0) {
    await autoImportGlobal(globalGroupLines, allCfgs);
    cooldown = true;
  }

  return Response.json({ success: true, data: { updated, cooldown } });
}
