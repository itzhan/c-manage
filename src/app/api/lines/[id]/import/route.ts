import { db } from "@/lib/db";
import { keys, lines, records, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, buildNaciPayload, buildSub2apiPayload, buildKeyhubPayload, getImportEndpoint, getAuthHeaders, incrementName } from "@/lib/channel";
import { type NextRequest } from "next/server";

function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
}

async function importBatch(cfg: Record<string, string>, headers: Record<string, string>, endpoint: string, keyStr: string, useKeys: string[], lineId: number): Promise<{ ok: boolean; channelIds: number[] }> {
  const channelIds: number[] = [];

  if (cfg.platformType === "sub2api") {
    let success = 0;
    for (const key of useKeys) {
      try {
        const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildSub2apiPayload(cfg, key)) });
        const data = await resp.json();
        if (resp.ok && !data.error) success++;
      } catch { /* skip */ }
    }
    return { ok: success > 0, channelIds };
  }

  if (cfg.platformType === "keyhub") {
    let success = 0;
    for (const key of useKeys) {
      try {
        const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildKeyhubPayload(cfg, key)) });
        const data = await resp.json();
        if (resp.ok && !data.error) success++;
      } catch { /* skip */ }
    }
    return { ok: success > 0, channelIds };
  }

  // New API / Naci: batch — capture channel IDs from response
  const payload = cfg.platformType === "naci" ? buildNaciPayload(cfg, keyStr) : buildPayload(cfg, keyStr);
  const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const data = await resp.json();

  if (resp.ok && data.success !== false) {
    // Try to extract channel IDs from response
    if (data.data?.channel?.id) channelIds.push(data.data.channel.id);
    if (data.data?.channels) {
      for (const ch of data.data.channels) {
        if (ch.id) channelIds.push(ch.id);
      }
    }
    return { ok: true, channelIds };
  }
  return { ok: false, channelIds };
}

async function rotateKeys(cfg: Record<string, string>, headers: Record<string, string>, useKeys: string[], lineId: number): Promise<boolean> {
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const slots = (db as any).prepare("SELECT * FROM channel_slots WHERE line_id = ? AND status = 'active' ORDER BY id").all(lineId) as any[];

  if (slots.length === 0) {
    addLog(lineId, "[换key] 无固定渠道，请先用默认模式创建", "warn");
    return false;
  }

  const keyStr = "\n" + useKeys.join("\n");
  let success = 0;

  for (const slot of slots) {
    // PUT update key
    const updateBody = {
      id: slot.remote_channel_id,
      key: keyStr,
      status: 1,
    };
    try {
      const resp = await fetch(`${baseUrl}/api/channel/`, {
        method: "PUT", headers,
        body: JSON.stringify(updateBody),
      });
      if (resp.ok) {
        success++;
        addLog(lineId, `[换key] 渠道 ${slot.name} (${slot.remote_channel_id}) 已更新`, "ok");
        // Enable channel
        await fetch(`${baseUrl}/api/channel/`, {
          method: "PUT", headers,
          body: JSON.stringify({ id: slot.remote_channel_id, status: 1 }),
        });
      } else {
        addLog(lineId, `[换key] 渠道 ${slot.remote_channel_id} 更新失败: ${resp.statusText}`, "err");
      }
    } catch (e: unknown) {
      addLog(lineId, `[换key] 渠道 ${slot.remote_channel_id} 请求失败`, "err");
    }
  }

  addLog(lineId, `[换key] 完成: ${success}/${slots.length} 渠道已更新`, success > 0 ? "ok" : "err");
  return success > 0;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineId = parseInt(id);
  const { count: requestCount } = await req.json() as { count: number };

  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return Response.json({ success: false, error: "Line not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  const authValue = cfg.authValue || "";
  const name = cfg.channelName || "";
  if (!baseUrl || !authValue) {
    return Response.json({ success: false, error: "连接配置不完整" }, { status: 400 });
  }

  const strategy = cfg.importStrategy || "default";
  const overlapMultiplier = parseInt(cfg.overlapMultiplier) || 2;

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(requestCount).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const endpoint = getImportEndpoint(cfg);
  const headers = getAuthHeaders(cfg);

  addLog(lineId, `开始导入 (${strategy}): ${useKeys.length} 个密钥 → 「${name || baseUrl}」`, "info");

  try {
    let ok = false;

    if (strategy === "rotate") {
      // Mode 2: Rotate keys in existing channels
      ok = await rotateKeys(cfg, headers, useKeys, lineId);
      if (!ok) {
        for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
        addLog(lineId, "换key失败，密钥已退回池中", "warn");
      }
    } else {
      // Mode default or overlap
      let importKeys = useKeys;
      if (strategy === "overlap") {
        // Duplicate keys N times
        importKeys = [];
        for (let m = 0; m < overlapMultiplier; m++) {
          importKeys.push(...useKeys);
        }
        addLog(lineId, `[重叠] ${useKeys.length} key × ${overlapMultiplier} = ${importKeys.length} 渠道`, "info");
      }

      const keyStr = "\n" + importKeys.join("\n");
      const result = await importBatch(cfg, headers, endpoint, keyStr, importKeys, lineId);
      ok = result.ok;

      if (ok) {
        // Save channel IDs as slots (for future rotate)
        if (result.channelIds.length > 0) {
          const insertSlot = (db as any).prepare("INSERT INTO channel_slots (line_id, remote_channel_id, name, created_at) VALUES (?, ?, ?, unixepoch())");
          for (const cid of result.channelIds) {
            insertSlot.run(lineId, cid, name);
          }
          addLog(lineId, `[记录] 保存 ${result.channelIds.length} 个渠道ID`, "info");
        }
      } else {
        for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
        addLog(lineId, "导入失败，密钥已退回池中", "warn");
      }
    }

    if (ok) {
      db.insert(records).values({ lineId, name: name || cfg.baseUrl, keyCount: useKeys.length }).run();
      let nextName = name;
      if (strategy !== "rotate" && cfg.fixedName !== "1" && name) {
        nextName = incrementName(name);
        cfg.channelName = nextName;
        db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, lineId)).run();
        addLog(lineId, `名称递增 → ${nextName}`, "info");
      }
      const remaining = db.select().from(keys).all().length;
      return Response.json({ success: true, data: { name, keysUsed: useKeys.length, keysRemaining: remaining, nextName } });
    }

    return Response.json({ success: false, error: "Import failed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog(lineId, `请求失败: ${msg}`, "err");
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
    addLog(lineId, "密钥已退回池中", "warn");
    return Response.json({ success: false, error: msg });
  }
}
