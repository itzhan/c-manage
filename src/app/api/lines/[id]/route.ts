import { db } from "@/lib/db";
import { lines, records, logs } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label;
  if (body.config !== undefined) updates.config = typeof body.config === "string" ? body.config : JSON.stringify(body.config);
  if (body.autoEnabled !== undefined) updates.autoEnabled = body.autoEnabled ? 1 : 0;
  if (body.autoBatchSize !== undefined) updates.autoBatchSize = body.autoBatchSize;
  if (!Object.keys(updates).length) return Response.json({ success: false, error: "Nothing to update" }, { status: 400 });
  db.update(lines).set(updates).where(eq(lines.id, lineId)).run();
  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  return Response.json({ success: true, data: line ? { ...line, config: JSON.parse(line.config) } : null });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  db.delete(logs).where(eq(logs.lineId, lineId)).run();
  db.delete(records).where(eq(records.lineId, lineId)).run();
  db.delete(lines).where(eq(lines.id, lineId)).run();
  return Response.json({ success: true });
}
