import { db } from "@/lib/db";
import { keys, lines, records } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const data = await req.json() as {
    keys?: string[];
    lines?: Array<{
      label: string;
      config: Record<string, string>;
      autoEnabled?: boolean;
      autoBatchSize?: number;
      records?: Array<{
        name: string;
        keyCount: number;
        cachedQuota?: number;
        allDisabledSince?: number | null;
        frozen?: boolean;
        lastRefresh?: number | null;
        importedAt?: number;
      }>;
    }>;
  };

  const result = { keysAdded: 0, linesAdded: 0, linesMerged: 0, recordsAdded: 0 };

  if (data.keys?.length) {
    for (const k of data.keys) {
      const trimmed = k.trim();
      if (!trimmed) continue;
      try { db.insert(keys).values({ key: trimmed }).run(); result.keysAdded++; } catch { /* dup */ }
    }
  }

  if (data.lines?.length) {
    for (const ln of data.lines) {
      const existing = db.select().from(lines).all().find(l => l.label === ln.label);

      let lineId: number;
      if (existing) {
        db.update(lines).set({
          config: JSON.stringify(ln.config),
          autoEnabled: ln.autoEnabled ? 1 : 0,
          autoBatchSize: ln.autoBatchSize || 10,
        }).where(eq(lines.id, existing.id)).run();
        lineId = existing.id;
        result.linesMerged++;
      } else {
        const row = db.insert(lines).values({
          label: ln.label,
          config: JSON.stringify(ln.config),
          autoEnabled: ln.autoEnabled ? 1 : 0,
          autoBatchSize: ln.autoBatchSize || 10,
        }).returning().get();
        lineId = row.id;
        result.linesAdded++;
      }

      if (ln.records?.length) {
        const existingRecs = db.select().from(records).where(eq(records.lineId, lineId)).all();
        const existingNames = new Set(existingRecs.map(r => r.name));

        for (const rec of ln.records) {
          if (existingNames.has(rec.name)) {
            const er = existingRecs.find(r => r.name === rec.name)!;
            db.update(records).set({
              keyCount: rec.keyCount,
              cachedQuota: rec.cachedQuota || 0,
              allDisabledSince: rec.allDisabledSince || null,
              frozen: rec.frozen ? 1 : 0,
              lastRefresh: rec.lastRefresh || null,
            }).where(eq(records.id, er.id)).run();
          } else {
            db.insert(records).values({
              lineId,
              name: rec.name,
              keyCount: rec.keyCount,
              cachedQuota: rec.cachedQuota || 0,
              allDisabledSince: rec.allDisabledSince || null,
              frozen: rec.frozen ? 1 : 0,
              lastRefresh: rec.lastRefresh || null,
              importedAt: rec.importedAt || Math.floor(Date.now() / 1000),
            }).run();
            result.recordsAdded++;
          }
        }
      }
    }
  }

  return Response.json({ success: true, data: result });
}
