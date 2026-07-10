import { db } from "@/lib/db";
import { groups, lines } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const { groupId, lineId, checked } = await req.json() as { groupId: number; lineId: number; checked: boolean };

  const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) return Response.json({ success: false, error: "Group not found" }, { status: 404 });

  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return Response.json({ success: false, error: "Line not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);

  if (checked) {
    if (cfg.importMode === "global" && cfg.globalGroup && cfg.globalGroup !== group.name) {
      return Response.json({ success: false, error: `该线路已属于分组「${cfg.globalGroup}」，请先移出` }, { status: 400 });
    }
    cfg.importMode = "global";
    cfg.globalGroup = group.name;
    cfg.globalGroupBatch = String(group.sharedKeyBatchSize);
  } else {
    if (cfg.globalGroup === group.name) {
      cfg.importMode = "independent";
      cfg.globalGroup = "";
    }
  }

  db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, lineId)).run();
  return Response.json({ success: true });
}
