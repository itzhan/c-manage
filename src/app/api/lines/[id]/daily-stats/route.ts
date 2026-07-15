import { db } from "@/lib/db";
import { records } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);

  const allRecs = db.select().from(records).where(eq(records.lineId, lineId)).all();

  const byDay = new Map<string, { date: string; totalKeys: number; totalQuota: number; disabledKeys: number; zeroQuotaKeys: number; batches: number }>();

  for (const r of allRecs) {
    const date = new Date(r.importedAt * 1000).toISOString().slice(0, 10);
    let day = byDay.get(date);
    if (!day) {
      day = { date, totalKeys: 0, totalQuota: 0, disabledKeys: 0, zeroQuotaKeys: 0, batches: 0 };
      byDay.set(date, day);
    }
    day.totalKeys += r.keyCount;
    day.totalQuota += r.cachedQuota;
    day.disabledKeys += r.disabledCount;
    if (r.cachedQuota === 0 && r.keyCount > 0) {
      day.zeroQuotaKeys += r.keyCount;
    }
    day.batches++;
  }

  const days = Array.from(byDay.values()).sort((a, b) => b.date.localeCompare(a.date));

  return Response.json({ success: true, data: days });
}
