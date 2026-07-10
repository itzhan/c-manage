import { db } from "@/lib/db";
import { groups, lines, records } from "@/lib/schema";
import { eq, sum } from "drizzle-orm";

export async function GET() {
  const allGroups = db.select().from(groups).all();
  const allLines = db.select().from(lines).all();

  const result = allGroups.map(g => {
    const groupLines = allLines
      .filter(l => {
        const cfg = JSON.parse(l.config);
        return cfg.importMode === "global" && cfg.globalGroup === g.name;
      })
      .map(l => {
        const [{ value: totalQuota }] = db.select({ value: sum(records.cachedQuota) }).from(records).where(eq(records.lineId, l.id)).all();
        return { id: l.id, label: l.label, totalQuota: totalQuota ?? 0 };
      });

    return { ...g, lines: groupLines };
  });

  return Response.json({ success: true, data: result });
}

export async function POST(req: Request) {
  const { name, sharedKeyBatchSize } = await req.json() as { name: string; sharedKeyBatchSize?: number };
  if (!name?.trim()) return Response.json({ success: false, error: "名称不能为空" }, { status: 400 });

  const existing = db.select().from(groups).where(eq(groups.name, name.trim())).get();
  if (existing) return Response.json({ success: false, error: "分组已存在" }, { status: 400 });

  const row = db.insert(groups).values({ name: name.trim(), sharedKeyBatchSize: sharedKeyBatchSize || 10 }).returning().get();
  return Response.json({ success: true, data: row });
}

export async function PUT(req: Request) {
  const { id, name, sharedKeyBatchSize } = await req.json() as { id: number; name?: string; sharedKeyBatchSize?: number };
  if (!id) return Response.json({ success: false, error: "ID required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sharedKeyBatchSize !== undefined) updates.sharedKeyBatchSize = sharedKeyBatchSize;

  db.update(groups).set(updates).where(eq(groups.id, id)).run();

  if (sharedKeyBatchSize !== undefined) {
    const group = db.select().from(groups).where(eq(groups.id, id)).get();
    if (group) {
      const allLines = db.select().from(lines).all();
      for (const l of allLines) {
        const cfg = JSON.parse(l.config);
        if (cfg.importMode === "global" && cfg.globalGroup === group.name) {
          cfg.globalGroupBatch = String(sharedKeyBatchSize);
          db.update(lines).set({ config: JSON.stringify(cfg), autoBatchSize: sharedKeyBatchSize }).where(eq(lines.id, l.id)).run();
        }
      }
    }
  }

  return Response.json({ success: true });
}

export async function DELETE(req: Request) {
  const { id } = await req.json() as { id: number };
  const group = db.select().from(groups).where(eq(groups.id, id)).get();
  if (!group) return Response.json({ success: false, error: "Not found" }, { status: 404 });

  const allLines = db.select().from(lines).all();
  for (const l of allLines) {
    const cfg = JSON.parse(l.config);
    if (cfg.importMode === "global" && cfg.globalGroup === group.name) {
      cfg.importMode = "independent";
      cfg.globalGroup = "";
      db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, l.id)).run();
    }
  }

  db.delete(groups).where(eq(groups.id, id)).run();
  return Response.json({ success: true });
}
