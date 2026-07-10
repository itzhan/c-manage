import { db } from "@/lib/db";
import { keys, lines, dispatchLocks } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { addLog, getAuthHeaders } from "@/lib/channel";
import { type NextRequest } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);

  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return Response.json({ success: false, error: "Line not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);
  const slotIds: number[] = JSON.parse(cfg.fixedSlotIds || "[]");
  if (slotIds.length === 0) {
    return Response.json({ success: false, error: "未初始化槽位" }, { status: 400 });
  }

  // 加全局锁，防止和自动 refresh 冲突
  const lockKey = `line:${lineId}:replace-all`;
  const now = Math.floor(Date.now() / 1000);
  const existing = db.select().from(dispatchLocks).where(eq(dispatchLocks.lockKey, lockKey)).get();
  if (existing && now - existing.lockedAt < 120) {
    return Response.json({ success: false, error: "正在换key中，请稍后" }, { status: 409 });
  }
  if (existing) {
    db.update(dispatchLocks).set({ lockedAt: now }).where(eq(dispatchLocks.lockKey, lockKey)).run();
  } else {
    db.insert(dispatchLocks).values({ lockKey, lockedAt: now }).run();
  }

  // 给每个槽位加锁，阻止自动 refresh 干扰
  for (const chId of slotIds) {
    const slotLock = `slot:${lineId}:${chId}`;
    const ex = db.select().from(dispatchLocks).where(eq(dispatchLocks.lockKey, slotLock)).get();
    if (ex) db.update(dispatchLocks).set({ lockedAt: now }).where(eq(dispatchLocks.lockKey, slotLock)).run();
    else db.insert(dispatchLocks).values({ lockKey: slotLock, lockedAt: now }).run();
  }

  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const headers = getAuthHeaders(cfg);

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(slotIds.length).all();
  if (poolKeys.length < slotIds.length) {
    db.delete(dispatchLocks).where(eq(dispatchLocks.lockKey, lockKey)).run();
    return Response.json({ success: false, error: `密钥池不足，需要 ${slotIds.length} 个，只有 ${poolKeys.length} 个` }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  addLog(lineId, `[一键换key] 开始换 ${slotIds.length} 个渠道...`, "info");

  let replaced = 0;

  // 全部并发，每个渠道独立，失败重试1次
  const tasks = slotIds.map(async (chId, i) => {
    const newKey = useKeys[i];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(`${baseUrl}/api/channel/`, {
          method: "PUT", headers,
          body: JSON.stringify({ id: chId, key: "\n" + newKey, status: 1 }),
        });
        if (resp.ok) {
          replaced++;
          addLog(lineId, `[一键换key] 渠道 ${chId} ✓`, "ok");
          return;
        }
        if (attempt === 1) {
          db.insert(keys).values({ key: newKey }).run();
          addLog(lineId, `[一键换key] 渠道 ${chId} 失败: ${resp.status}`, "err");
        }
      } catch (e: unknown) {
        if (attempt === 1) {
          db.insert(keys).values({ key: newKey }).run();
          addLog(lineId, `[一键换key] 渠道 ${chId} 异常: ${e instanceof Error ? e.message : String(e)}`, "err");
        }
      }
    }
  });

  await Promise.all(tasks);

  // 释放锁
  db.delete(dispatchLocks).where(eq(dispatchLocks.lockKey, lockKey)).run();
  for (const chId of slotIds) {
    db.delete(dispatchLocks).where(eq(dispatchLocks.lockKey, `slot:${lineId}:${chId}`)).run();
  }

  addLog(lineId, `[一键换key] 完成: ${replaced}/${slotIds.length}`, replaced > 0 ? "ok" : "err");
  return Response.json({ success: true, data: { replaced, total: slotIds.length } });
}
