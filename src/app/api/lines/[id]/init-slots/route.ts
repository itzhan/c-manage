import { db } from "@/lib/db";
import { keys, lines } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { addLog, getAuthHeaders, getCookie, buildPayload } from "@/lib/channel";
import { type NextRequest } from "next/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const { count = 10 } = await req.json() as { count: number };

  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return Response.json({ success: false, error: "Line not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl || !cfg.authValue) {
    return Response.json({ success: false, error: "配置不完整" }, { status: 400 });
  }

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(count).all();
  if (poolKeys.length < count) {
    return Response.json({ success: false, error: `密钥池不足，需要 ${count} 个，只有 ${poolKeys.length} 个` }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const headers = getAuthHeaders(cfg);
  const channelName = cfg.channelName || "fixed-slot";
  let created = 0;

  // 逐个创建渠道，每个 1 个 key
  for (let i = 0; i < useKeys.length; i++) {
    const key = useKeys[i];
    const payload = buildPayload(cfg, "\n" + key);
    // 强制 single 模式
    (payload as any).mode = "single";
    try {
      const resp = await fetch(`${baseUrl}/api/channel/`, { method: "POST", headers, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (resp.ok && data.success !== false) {
        created++;
        addLog(lineId, `[固定槽位] 创建渠道 #${i + 1} ✓`, "ok");
      } else {
        addLog(lineId, `[固定槽位] 创建渠道 #${i + 1} 失败: ${data.message || ""}`, "err");
      }
    } catch (e: unknown) {
      addLog(lineId, `[固定槽位] 创建渠道 #${i + 1} 异常: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }

  // 创建完后搜索获取渠道 ID
  const cookie = getCookie(cfg);
  const searchHeaders: Record<string, string> = {
    "Content-Type": "application/json", "Accept": "application/json",
    "New-API-User": cfg.newApiUser || "3", "Cache-Control": "no-store",
  };
  if (cookie) searchHeaders["Cookie"] = cookie;

  const slotIds: number[] = [];
  try {
    const searchUrl = `${baseUrl}/api/channel/search?keyword=${encodeURIComponent(channelName)}&group=&model=&id_sort=false&tag_mode=false&p=1&page_size=200`;
    const resp = await fetch(searchUrl, { method: "GET", headers: searchHeaders });
    const data = await resp.json();
    const channels = (data.data?.items || []).filter((ch: any) => ch.name === channelName && ch.status === 1);
    // 取最新的 count 个
    const sorted = channels.sort((a: any, b: any) => b.id - a.id).slice(0, count);
    for (const ch of sorted) slotIds.push(ch.id);
  } catch (e: unknown) {
    addLog(lineId, `[固定槽位] 搜索渠道失败: ${e instanceof Error ? e.message : String(e)}`, "err");
  }

  // 保存槽位 ID 到 config
  cfg.fixedSlotIds = JSON.stringify(slotIds);
  cfg.fixedSlotCount = String(count);
  db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, lineId)).run();

  addLog(lineId, `[固定槽位] 初始化完成: 创建 ${created} 个, 获取到 ${slotIds.length} 个ID: [${slotIds.join(",")}]`, slotIds.length > 0 ? "ok" : "err");

  // 退回未成功的 key
  if (created < useKeys.length) {
    const failedKeys = useKeys.slice(created);
    for (const k of failedKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
  }

  return Response.json({ success: true, data: { created, slotIds } });
}
