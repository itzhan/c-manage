import { db } from "@/lib/db";
import { lines, records, keys, dispatchLocks } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { addLog, executeImport, saveChannelSlots, createRecordAndAdvanceName, getCookie } from "@/lib/channel";

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
    for (const line of gLines) {
      const unfrozen = db.select().from(records).where(eq(records.lineId, line.id)).all().filter(r => !r.frozen);
      const latest = unfrozen[unfrozen.length - 1];
      if (latest) {
        totalChannels += latest.keyCount;
        totalDisabled += latest.disabledCount;
        totalQuota += latest.cachedQuota;
      }
    }

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

    // Phase 2: Trigger check — only on the latest non-frozen record
    if (line.autoEnabled) {
      const unfrozen = db.select().from(records).where(eq(records.lineId, line.id)).all().filter(r => !r.frozen);
      const latest = unfrozen[unfrozen.length - 1];

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
