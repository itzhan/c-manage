import { db } from "@/lib/db";
import { records } from "@/lib/schema";
import { eq, count, desc } from "drizzle-orm";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "10");
  const offset = (page - 1) * pageSize;
  const rows = db.select().from(records).where(eq(records.lineId, lineId)).orderBy(desc(records.importedAt)).limit(pageSize).offset(offset).all();
  const [{ value: total }] = db.select({ value: count() }).from(records).where(eq(records.lineId, lineId)).all();
  const all = db.select().from(records).where(eq(records.lineId, lineId)).all();
  const totalQuota = all.reduce((s, r) => s + r.cachedQuota, 0);
  const totalKeys = all.reduce((s, r) => s + r.keyCount, 0);
  return Response.json({ success: true, data: { items: rows, total, totalQuota, totalKeys, page, pageSize } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const { name, keyCount } = await req.json();
  const row = db.insert(records).values({ lineId, name, keyCount }).returning().get();
  return Response.json({ success: true, data: row });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const url = new URL(req.url);
  const recordId = url.searchParams.get("recordId");
  if (recordId) {
    db.delete(records).where(eq(records.id, parseInt(recordId))).run();
  } else {
    db.delete(records).where(eq(records.lineId, lineId)).run();
  }
  return Response.json({ success: true });
}
