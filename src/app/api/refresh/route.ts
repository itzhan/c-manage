import { db } from "@/lib/db";
import { lines, records, keys, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, incrementName, getCookie } from "@/lib/channel";

const FREEZE_AFTER = 5 * 60;

function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
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

async function autoImportAllLines(batchSize: number) {
  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(batchSize).all();
  if (!poolKeys.length) return;

  const useKeys = poolKeys.map(k => k.key);
  const keyStr = "\n" + useKeys.join("\n");
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const allLines = db.select().from(lines).all();
  let anySuccess = false;

  for (const line of allLines) {
    const cfg = JSON.parse(line.config) as Record<string, string>;
    const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    const name = cfg.channelName || "";
    if (!baseUrl || !cfg.authValue || !name) {
      addLog(line.id, `[自动全线] 跳过: 配置不完整`, "warn");
      continue;
    }

    addLog(line.id, `[自动全线] 导入 ${useKeys.length} 个密钥 → 渠道「${name}」`, "info");

    const cookie = getCookie(cfg);
    const payload = buildPayload(cfg, keyStr);
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "Accept": "application/json",
      "New-API-User": cfg.newApiUser || "3", "Cache-Control": "no-store",
    };
    if (cookie) headers["Cookie"] = cookie;

    try {
      const resp = await fetch(baseUrl + "/api/channel/", { method: "POST", headers, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (resp.ok && data.success !== false) {
        addLog(line.id, `[自动全线] 成功！`, "ok");
        db.insert(records).values({ lineId: line.id, name, keyCount: useKeys.length }).run();
        if (cfg.fixedName === "1") {
          addLog(line.id, `[自动全线] 渠道名称固定，不递增`, "info");
        } else {
          const nextName = incrementName(name);
          cfg.channelName = nextName;
          db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, line.id)).run();
          addLog(line.id, `[自动全线] 名称递增 → ${nextName}`, "info");
        }
        anySuccess = true;
      } else {
        addLog(line.id, `[自动全线] 失败: ${data.message || ""}`, "err");
      }
    } catch (e: unknown) {
      addLog(line.id, `[自动全线] 请求失败: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }

  if (!anySuccess) {
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    for (const line of allLines) addLog(line.id, `[自动全线] 所有线路均失败，密钥已退回池中`, "warn");
  }
}

export async function POST() {
  const allLines = db.select().from(lines).all();
  const now = Math.floor(Date.now() / 1000);
  let updated = 0;
  let cooldown = false;
  let needAutoImport = false;
  let autoImportBatchSize = 10;

  for (const line of allLines) {
    const cfg = JSON.parse(line.config);
    const recs = db.select().from(records).where(eq(records.lineId, line.id)).all();

    for (const r of recs) {
      if (r.frozen) continue;
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

    // 检测是否需要自动上弹（任意一条线路开启了且最新批次全灭）
    if (line.autoEnabled) {
      const unfrozen = db.select().from(records).where(eq(records.lineId, line.id)).all().filter(r => !r.frozen);
      const latest = unfrozen.length > 0 ? unfrozen[unfrozen.length - 1] : null;
      if (latest?.allDisabledSince) {
        db.update(records).set({ frozen: 1 }).where(eq(records.id, latest.id)).run();
        needAutoImport = true;
        autoImportBatchSize = Math.max(autoImportBatchSize, line.autoBatchSize);
      }
    }
  }

  if (needAutoImport) {
    await autoImportAllLines(autoImportBatchSize);
    cooldown = true;
  }

  return Response.json({ success: true, data: { updated, cooldown } });
}
