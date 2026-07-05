import { db } from "@/lib/db";
import { lines, records, keys, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, buildNaciPayload, buildSub2apiPayload, getImportEndpoint, getAuthHeaders, incrementName, getCookie } from "@/lib/channel";

const FREEZE_AFTER = 5 * 60;
const BILLING_GRACE = 3 * 60;

function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

async function importToLine(line: any, cfg: Record<string, string>, useKeys: string[]) {
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const name = cfg.channelName || "";
  if (!baseUrl || !cfg.authValue || !name) return false;

  const endpoint = getImportEndpoint(cfg);
  const headers = getAuthHeaders(cfg);

  try {
    let ok = false;
    if (cfg.platformType === "sub2api") {
      let success = 0;
      for (const key of useKeys) {
        const payload = buildSub2apiPayload(cfg, key);
        try {
          const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
          const data = await resp.json();
          if (resp.ok && !data.error) success++;
        } catch { /* skip */ }
      }
      ok = success > 0;
      addLog(line.id, `[自动上弹] Sub2API: 成功${success}/${useKeys.length}`, success > 0 ? "ok" : "err");
    } else {
      const lineKeyStr = "\n" + useKeys.join("\n");
      const payload = cfg.platformType === "naci" ? buildNaciPayload(cfg, lineKeyStr) : buildPayload(cfg, lineKeyStr);
      const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (resp.ok && data.success !== false) {
        addLog(line.id, `[自动上弹] 成功！导入 ${useKeys.length} 个密钥 → 渠道「${name}」`, "ok");
        ok = true;
      } else {
        addLog(line.id, `[自动上弹] 失败: ${data.message || ""}`, "err");
      }
    }

    if (ok) {
      db.insert(records).values({ lineId: line.id, name: name || cfg.baseUrl, keyCount: useKeys.length }).run();
      if (cfg.fixedName !== "1" && name) {
        const nextName = incrementName(name);
        cfg.channelName = nextName;
        db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, line.id)).run();
        addLog(line.id, `[自动上弹] 名称递增 → ${nextName}`, "info");
      }
      return true;
    }
  } catch (e: unknown) {
    addLog(line.id, `[自动上弹] 请求失败: ${e instanceof Error ? e.message : String(e)}`, "err");
  }
  return false;
}

// Independent line auto-import: only imports to this single line
async function autoImportIndependent(line: any, batchSize: number) {
  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(batchSize).all();
  if (!poolKeys.length) return;
  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const cfg = JSON.parse(line.config) as Record<string, string>;
  addLog(line.id, `[自动上弹-单独] 导入 ${useKeys.length} 个密钥`, "info");
  const ok = await importToLine(line, cfg, useKeys);
  if (!ok) {
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    addLog(line.id, `[自动上弹-单独] 失败，密钥已退回池中`, "warn");
  }
}

// Global auto-import: per group, take groupBatchSize keys and distribute by ratio
async function autoImportGlobal() {
  const globalLines = db.select().from(lines).all().filter(l => {
    const c = JSON.parse(l.config);
    return c.importMode === "global";
  });

  // Group lines
  const groups = new Map<string, any[]>();
  for (const line of globalLines) {
    const cfg = JSON.parse(line.config);
    const g = cfg.globalGroup || "默认";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(line);
  }

  for (const [group, gLines] of groups) {
    const firstCfg = JSON.parse(gLines[0].config);
    const groupBatch = parseInt(firstCfg.globalGroupBatch) || 10;

    const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(groupBatch).all();
    if (!poolKeys.length) continue;
    const useKeys = poolKeys.map(k => k.key);
    for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

    let anySuccess = false;
    for (const line of gLines) {
      const cfg = JSON.parse(line.config) as Record<string, string>;
      const ratio = parseInt(cfg.globalRatio) || 100;
      if (ratio <= 0) continue;
      const n = Math.round(useKeys.length * ratio / 100);
      const lineKeys = ratio >= 100 ? useKeys : shuffle(useKeys).slice(0, Math.max(1, n));

      addLog(line.id, `[自动上弹-全局/${group}] 导入 ${lineKeys.length} 个密钥 (${ratio}%)`, "info");
      if (await importToLine(line, cfg, lineKeys)) anySuccess = true;
    }

    if (!anySuccess) {
      for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
      for (const line of gLines) addLog(line.id, `[自动上弹-全局/${group}] 所有线路均失败，密钥已退回池中`, "warn");
    }
  }
}

export async function POST() {
  const allLines = db.select().from(lines).all();
  const now = Math.floor(Date.now() / 1000);
  let updated = 0;
  let cooldown = false;

  let needGlobalImport = false;

  for (const line of allLines) {
    const cfg = JSON.parse(line.config);
    const isGlobal = cfg.importMode === "global";
    const recs = db.select().from(records).where(eq(records.lineId, line.id)).all();

    for (const r of recs) {
      // Frozen records: still query billing for 3 min grace period
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
      const allDisabled = channels.length > 0 && channels.every(ch => ch.status === 3);
      const upd: Record<string, unknown> = { cachedQuota: totalQuota, keyCount: channels.length, lastRefresh: now };
      if (allDisabled) {
        if (!r.allDisabledSince) upd.allDisabledSince = now;
        else if (now - r.allDisabledSince >= FREEZE_AFTER) upd.frozen = 1;
      } else {
        upd.allDisabledSince = null;
      }
      db.update(records).set(upd).where(eq(records.id, r.id)).run();
      updated++;
    }

    // Auto-import: trigger immediately when latest batch is all disabled (don't wait for freeze)
    if (line.autoEnabled) {
      const unfrozen = db.select().from(records).where(eq(records.lineId, line.id)).all().filter(r => !r.frozen);
      const latest = unfrozen.length > 0 ? unfrozen[unfrozen.length - 1] : null;
      if (latest?.allDisabledSince) {
        db.update(records).set({ frozen: 1 }).where(eq(records.id, latest.id)).run();

        if (isGlobal) {
          needGlobalImport = true;
        } else {
          await autoImportIndependent(line, line.autoBatchSize || 10);
          cooldown = true;
        }
      }
    }
  }

  if (needGlobalImport) {
    await autoImportGlobal();
    cooldown = true;
  }

  return Response.json({ success: true, data: { updated, cooldown } });
}
