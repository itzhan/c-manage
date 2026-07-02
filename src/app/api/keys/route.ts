import { db } from "@/lib/db";
import { keys } from "@/lib/schema";
import { count } from "drizzle-orm";

export async function GET() {
  const rows = db.select().from(keys).all();
  return Response.json({ success: true, data: { keys: rows.map(r => r.key), total: rows.length } });
}

export async function POST(req: Request) {
  const { keys: newKeys } = await req.json() as { keys: string[] };
  if (!newKeys?.length) return Response.json({ success: false, error: "No keys" }, { status: 400 });
  let added = 0;
  for (const k of newKeys) {
    const trimmed = k.trim();
    if (!trimmed) continue;
    try { db.insert(keys).values({ key: trimmed }).run(); added++; } catch { /* duplicate */ }
  }
  const [{ value: total }] = db.select({ value: count() }).from(keys).all();
  return Response.json({ success: true, data: { added, total } });
}

export async function DELETE() {
  const [{ value: deleted }] = db.select({ value: count() }).from(keys).all();
  db.delete(keys).run();
  return Response.json({ success: true, data: { deleted } });
}
