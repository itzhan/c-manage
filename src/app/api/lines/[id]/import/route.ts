import { db } from "@/lib/db";
import { keys, lines, records } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { addLog, executeImport, saveChannelSlots, createRecordAndAdvanceName } from "@/lib/channel";
import { type NextRequest } from "next/server";

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
  if (!baseUrl || !authValue) {
    return Response.json({ success: false, error: "连接配置不完整" }, { status: 400 });
  }

  const strategy = cfg.importStrategy || "default";

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(requestCount).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  addLog(lineId, `开始导入 (${strategy}): ${useKeys.length} 个密钥 → 「${name || baseUrl}」`, "info");

  try {
    const result = await executeImport(cfg, useKeys, lineId);

    if (result.ok) {
      saveChannelSlots(lineId, result.channelIds, name);
      const nextName = createRecordAndAdvanceName(lineId, cfg, useKeys, strategy);
      const remaining = db.select().from(keys).all().length;
      return Response.json({ success: true, data: { name, keysUsed: useKeys.length, keysRemaining: remaining, nextName } });
    }

    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    addLog(lineId, "导入失败，密钥已退回池中", "warn");
    return Response.json({ success: false, error: "Import failed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(lineId, `请求失败: ${msg}`, "err");
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    addLog(lineId, "密钥已退回池中", "warn");
    return Response.json({ success: false, error: msg });
  }
}
