import { db as ormDb } from "@/lib/db";
import { lines } from "@/lib/schema";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";

const rawDb = (ormDb as any).$client as Database.Database;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slots = rawDb.prepare("SELECT * FROM channel_slots WHERE line_id = ? ORDER BY id").all(parseInt(id));
  return Response.json({ success: true, data: slots });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { slotId?: number };
  if (body.slotId) {
    rawDb.prepare("DELETE FROM channel_slots WHERE id = ? AND line_id = ?").run(body.slotId, parseInt(id));
  } else {
    rawDb.prepare("DELETE FROM channel_slots WHERE line_id = ?").run(parseInt(id));
  }
  return Response.json({ success: true });
}
