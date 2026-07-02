import { db } from "@/lib/db";
import { logs } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { type NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const rows = db.select().from(logs).where(eq(logs.lineId, lineId)).orderBy(desc(logs.id)).limit(200).all();
  return Response.json({ success: true, data: rows.reverse() });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.delete(logs).where(eq(logs.lineId, parseInt(id))).run();
  return Response.json({ success: true });
}
