import { db } from "@/lib/db";
import { lines } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCookie } from "@/lib/channel";
import { type NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);

  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return Response.json({ success: false, error: "Line not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);
  const slotIds: number[] = JSON.parse(cfg.fixedSlotIds || "[]");
  if (slotIds.length === 0) {
    return Response.json({ success: true, data: { slots: [], summary: { total: 0, active: 0, disabled: 0, totalQuota: 0 } } });
  }

  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const cookie = getCookie(cfg);
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "New-API-User": cfg.newApiUser || "3",
    "Cache-Control": "no-store",
  };
  if (cookie) headers["Cookie"] = cookie;

  const slots: Array<{ id: number; name: string; status: number; statusText: string; usedQuota: number; keyPreview: string }> = [];

  for (const chId of slotIds) {
    try {
      const resp = await fetch(`${baseUrl}/api/channel/${chId}`, { headers });
      const data = await resp.json();
      const ch = data.data || data;
      const statusMap: Record<number, string> = { 1: "启用", 2: "测试", 3: "禁用" };
      const keyRaw = ch.key || "";
      const keyPreview = keyRaw.length > 20 ? `${keyRaw.substring(0, 15)}...${keyRaw.slice(-4)}` : keyRaw || "-";
      slots.push({
        id: ch.id,
        name: ch.name || "",
        status: ch.status,
        statusText: statusMap[ch.status] || String(ch.status),
        usedQuota: ch.used_quota || 0,
        keyPreview,
      });
    } catch {
      slots.push({ id: chId, name: "?", status: -1, statusText: "连接失败", usedQuota: 0, keyPreview: "-" });
    }
  }

  const active = slots.filter(s => s.status === 1).length;
  const disabled = slots.filter(s => s.status === 3).length;
  const totalQuota = slots.reduce((s, sl) => s + sl.usedQuota, 0);

  return Response.json({ success: true, data: { slots, summary: { total: slots.length, active, disabled, totalQuota } } });
}
