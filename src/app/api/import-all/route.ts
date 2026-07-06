import { db } from "@/lib/db";
import { keys, lines, records, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, buildNaciPayload, buildSub2apiPayload, buildKeyhubPayload, getImportEndpoint, getAuthHeaders, incrementName } from "@/lib/channel";

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

export async function POST(req: Request) {
  const body = (await req.json()) as { count: number; mode?: string; lineRatios?: Record<string, number> };
  const { count, mode, lineRatios } = body;
  if (!count || count <= 0) {
    return Response.json({ success: false, error: "count must be > 0" }, { status: 400 });
  }

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(count).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const allLines = db.select().from(lines).all();
  const results: Array<{ lineId: number; label: string; success: boolean; name?: string; error?: string; keyCount?: number }> = [];
  let anySuccess = false;

  for (const line of allLines) {
    const cfg = JSON.parse(line.config) as Record<string, string>;
    const lineMode = cfg.importMode || "independent";

    // Determine if this line should participate
    if (mode === "global") {
      // Global dispatch: only global-mode lines
      if (lineMode !== "global") continue;
    } else if (mode === "independent") {
      // Single-line import (called from line detail)
      if (line.id !== parseInt(String(lineRatios?.targetLineId || "0"))) continue;
    } else {
      // Legacy: respect importDisabled
      if (cfg.importDisabled === "1") {
        results.push({ lineId: line.id, label: line.label, success: false, error: "已禁用", keyCount: 0 });
        continue;
      }
    }

    // Check ratio from request params, then fall back to config
    const ratio = lineRatios?.[String(line.id)];
    if (ratio === 0) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "已跳过", keyCount: 0 });
      continue;
    }

    const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    const name = cfg.channelName || "";

    if (!baseUrl || !cfg.authValue || !name) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "配置不完整", keyCount: 0 });
      addLog(line.id, `[导入] 跳过: 配置不完整`, "warn");
      continue;
    }

    // Determine how many keys this line gets
    let lineKeys: string[];
    if (ratio !== undefined && ratio < 100) {
      const n = Math.round(useKeys.length * ratio / 100);
      lineKeys = n >= useKeys.length ? useKeys : shuffle(useKeys).slice(0, Math.max(1, n));
    } else {
      const globalRatio = parseInt(cfg.globalRatio) || 100;
      if (mode === "global" && globalRatio < 100) {
        const n = Math.round(useKeys.length * globalRatio / 100);
        lineKeys = shuffle(useKeys).slice(0, Math.max(1, n));
      } else {
        lineKeys = useKeys;
      }
    }

    if (lineKeys.length === 0) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "计算后数量为0", keyCount: 0 });
      continue;
    }

    addLog(line.id, `[导入] 导入 ${lineKeys.length} 个密钥 → 「${name || baseUrl}」`, "info");

    const endpoint = getImportEndpoint(cfg);
    const headers = getAuthHeaders(cfg);

    try {
      let importOk = false;

      if (cfg.platformType === "sub2api") {
        let success = 0;
        for (const key of lineKeys) {
          const p = buildSub2apiPayload(cfg, key);
          try { const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(p) }); const d = await r.json(); if (r.ok && !d.error) success++; } catch { /* skip */ }
        }
        importOk = success > 0;
        addLog(line.id, `[导入] Sub2API: 成功${success}/${lineKeys.length}`, success > 0 ? "ok" : "err");
      }

      if (cfg.platformType === "keyhub") {
        let success = 0;
        for (const key of lineKeys) {
          const p = buildKeyhubPayload(cfg, key);
          try { const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(p) }); const d = await r.json(); if (r.ok && !d.error) success++; } catch { /* skip */ }
        }
        importOk = success > 0;
        addLog(line.id, `[导入] KeyHub: 成功${success}/${lineKeys.length}`, success > 0 ? "ok" : "err");
      }

      if (cfg.platformType !== "sub2api" && cfg.platformType !== "keyhub") {
        const lineKeyStr = "\n" + lineKeys.join("\n");
        const payload = cfg.platformType === "naci" ? buildNaciPayload(cfg, lineKeyStr) : buildPayload(cfg, lineKeyStr);
        const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
        const data = await resp.json();
        if (resp.ok && data.success !== false) {
          addLog(line.id, `[导入] 成功！`, "ok");
          importOk = true;
        } else {
          addLog(line.id, `[导入] 失败: ${data.message || ""}`, "err");
        }
      }

      if (importOk) {
        db.insert(records).values({ lineId: line.id, name: name || baseUrl, keyCount: lineKeys.length }).run();
        if (cfg.fixedName !== "1" && name) {
          const nextName = incrementName(name);
          cfg.channelName = nextName;
          db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, line.id)).run();
          addLog(line.id, `[导入] 名称递增 → ${nextName}`, "info");
        }
        results.push({ lineId: line.id, label: line.label, success: true, name: name || baseUrl, keyCount: lineKeys.length });
        anySuccess = true;
      } else {
        results.push({ lineId: line.id, label: line.label, success: false, error: "导入失败", keyCount: lineKeys.length });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(line.id, `[导入] 请求失败: ${msg}`, "err");
      results.push({ lineId: line.id, label: line.label, success: false, error: msg, keyCount: lineKeys.length });
    }
  }

  if (!anySuccess) {
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
  }

  const remaining = db.select().from(keys).all().length;
  return Response.json({ success: true, data: { keysUsed: useKeys.length, remaining, results } });
}
