import { db } from "@/lib/db";
import { lines, records } from "@/lib/schema";
import { eq, count, and, sum, desc, gte } from "drizzle-orm";

export async function GET() {
  const allLines = db.select().from(lines).orderBy(lines.sortOrder, lines.id).all();
  const todayStart = Math.floor(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() / 1000);

  const result = allLines.map(l => {
    const [{ value: total }] = db.select({ value: count() }).from(records).where(eq(records.lineId, l.id)).all();
    const [{ value: active }] = db.select({ value: count() }).from(records).where(and(eq(records.lineId, l.id), eq(records.frozen, 0))).all();

    const last5 = db.select().from(records).where(eq(records.lineId, l.id)).orderBy(desc(records.id)).limit(5).all();

    const [{ value: totalKeys }] = db.select({ value: sum(records.keyCount) }).from(records).where(eq(records.lineId, l.id)).all();
    const [{ value: todayKeys }] = db.select({ value: sum(records.keyCount) }).from(records).where(and(eq(records.lineId, l.id), gte(records.importedAt, todayStart))).all();

    return { ...l, config: JSON.parse(l.config), recordCount: total, activeCount: active, last5, totalKeys: totalKeys ?? 0, todayKeys: todayKeys ?? 0 };
  });
  return Response.json({ success: true, data: result });
}

export async function POST(req: Request) {
  const { label } = await req.json() as { label: string };
  if (!label?.trim()) return Response.json({ success: false, error: "Label required" }, { status: 400 });
  const result = db.insert(lines).values({ label: label.trim() }).returning().get();
  return Response.json({ success: true, data: { ...result, config: JSON.parse(result.config) } });
}
