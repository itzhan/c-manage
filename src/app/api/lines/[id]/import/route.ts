import { db } from "@/lib/db";
import { keys, lines, records, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, incrementName, getCookie } from "@/lib/channel";
import { type NextRequest } from "next/server";

function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const { count: requestCount } = await req.json() as { count: number };

  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return Response.json({ success: false, error: "Line not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const authValue = cfg.authValue || "";
  const name = cfg.channelName || "";
  if (!baseUrl || !authValue || !name) {
    return Response.json({ success: false, error: "连接配置不完整" }, { status: 400 });
  }

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(requestCount).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  const keyStr = "\n" + useKeys.join("\n");

  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  addLog(lineId, `开始导入: ${useKeys.length} 个密钥 → 渠道「${name}」`, "info");

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
      addLog(lineId, `导入成功！${data.message || ""}`, "ok");
      db.insert(records).values({ lineId, name, keyCount: useKeys.length }).run();
      const nextName = incrementName(name);
      cfg.channelName = nextName;
      db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, lineId)).run();
      addLog(lineId, `渠道名称已自动递增 → ${nextName}`, "info");

      const remaining = db.select().from(keys).all().length;
      return Response.json({ success: true, data: { name, keysUsed: useKeys.length, keysRemaining: remaining, nextName } });
    } else {
      addLog(lineId, `导入失败: ${data.message || resp.statusText}`, "err");
      for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
      addLog(lineId, "密钥已退回池中", "warn");
      return Response.json({ success: false, error: data.message || "Import failed" });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(lineId, `请求失败: ${msg}`, "err");
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    addLog(lineId, "密钥已退回池中", "warn");
    return Response.json({ success: false, error: msg });
  }
}
