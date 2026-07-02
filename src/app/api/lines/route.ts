import { db } from "@/lib/db";
import { lines, records } from "@/lib/schema";
import { eq, count, and } from "drizzle-orm";

export async function GET() {
  const allLines = db.select().from(lines).orderBy(lines.sortOrder, lines.id).all();
  const result = allLines.map(l => {
    const [{ value: total }] = db.select({ value: count() }).from(records).where(eq(records.lineId, l.id)).all();
    const [{ value: active }] = db.select({ value: count() }).from(records).where(and(eq(records.lineId, l.id), eq(records.frozen, 0))).all();
    return { ...l, config: JSON.parse(l.config), recordCount: total, activeCount: active };
  });
  return Response.json({ success: true, data: result });
}

export async function POST(req: Request) {
  const { label } = await req.json() as { label: string };
  if (!label?.trim()) return Response.json({ success: false, error: "Label required" }, { status: 400 });
  const result = db.insert(lines).values({ label: label.trim() }).returning().get();
  return Response.json({ success: true, data: { ...result, config: JSON.parse(result.config) } });
}
