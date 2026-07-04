import { db } from "@/lib/db";
import { keys, lines, records, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, incrementName, getCookie } from "@/lib/channel";

function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
}

export async function POST(req: Request) {
  const { count } = (await req.json()) as { count: number };
  if (!count || count <= 0) {
    return Response.json({ success: false, error: "count must be > 0" }, { status: 400 });
  }

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(count).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  const keyStr = "\n" + useKeys.join("\n");

  // 先从池中取出
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const allLines = db.select().from(lines).all();
  const results: Array<{ lineId: number; label: string; success: boolean; name?: string; error?: string }> = [];
  let anySuccess = false;

  for (const line of allLines) {
    const cfg = JSON.parse(line.config) as Record<string, string>;
    const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    const name = cfg.channelName || "";

    if (!baseUrl || !cfg.authValue || !name) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "配置不完整" });
      addLog(line.id, `[全线导入] 跳过: 配置不完整`, "warn");
      continue;
    }

    addLog(line.id, `[全线导入] 导入 ${useKeys.length} 个密钥 → 渠道「${name}」`, "info");

    const cookie = getCookie(cfg);
    const payload = buildPayload(cfg, keyStr);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "New-API-User": cfg.newApiUser || "3",
      "Cache-Control": "no-store",
    };
    if (cookie) headers["Cookie"] = cookie;

    try {
      const resp = await fetch(baseUrl + "/api/channel/", { method: "POST", headers, body: JSON.stringify(payload) });
      const data = await resp.json();

      if (resp.ok && data.success !== false) {
        addLog(line.id, `[全线导入] 成功！`, "ok");
        db.insert(records).values({ lineId: line.id, name, keyCount: useKeys.length }).run();
        if (cfg.fixedName === "1") {
          addLog(line.id, `[全线导入] 渠道名称固定，不递增`, "info");
        } else {
          const nextName = incrementName(name);
          cfg.channelName = nextName;
          db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, line.id)).run();
          addLog(line.id, `[全线导入] 名称递增 → ${nextName}`, "info");
        }
        results.push({ lineId: line.id, label: line.label, success: true, name });
        anySuccess = true;
      } else {
        addLog(line.id, `[全线导入] 失败: ${data.message || ""}`, "err");
        results.push({ lineId: line.id, label: line.label, success: false, error: data.message || "远端返回失败" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(line.id, `[全线导入] 请求失败: ${msg}`, "err");
      results.push({ lineId: line.id, label: line.label, success: false, error: msg });
    }
  }

  // 如果全部失败，把 key 退回池
  if (!anySuccess) {
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    for (const line of allLines) {
      addLog(line.id, `[全线导入] 所有线路均失败，密钥已退回池中`, "warn");
    }
  }

  const remaining = db.select().from(keys).all().length;
  return Response.json({ success: true, data: { keysUsed: useKeys.length, remaining, results } });
}
