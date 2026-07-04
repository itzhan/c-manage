import { db } from "@/lib/db";
import { keys, lines, records, logs } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { buildPayload, buildNaciPayload, buildSub2apiPayload, getImportEndpoint, getAuthHeaders, incrementName } from "@/lib/channel";
import { type NextRequest } from "next/server";

function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
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

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(requestCount).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  addLog(lineId, `开始导入: ${useKeys.length} 个密钥 → 「${name || baseUrl}」`, "info");

  const endpoint = getImportEndpoint(cfg);
  const headers = getAuthHeaders(cfg);

  try {
    let ok = false;

    if (cfg.platformType === "sub2api") {
      // Sub2api: send each key individually
      let success = 0, failed = 0;
      for (const key of useKeys) {
        const payload = buildSub2apiPayload(cfg, key);
        try {
          const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
          const data = await resp.json();
          if (resp.ok && !data.error) { success++; }
          else { failed++; addLog(lineId, `key失败: ${data.error || data.message || resp.statusText}`, "warn"); }
        } catch (e: unknown) {
          failed++;
        }
      }
      addLog(lineId, `Sub2API 导入完成: 成功${success} 失败${failed}`, success > 0 ? "ok" : "err");
      ok = success > 0;
      if (failed > 0 && success === 0) {
        for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
        addLog(lineId, "全部失败，密钥已退回池中", "warn");
      }
    } else {
      // New API / Naci: batch
      const keyStr = "\n" + useKeys.join("\n");
      const payload = cfg.platformType === "naci" ? buildNaciPayload(cfg, keyStr) : buildPayload(cfg, keyStr);
      const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (resp.ok && data.success !== false) {
        addLog(lineId, `导入成功！${data.message || ""}`, "ok");
        ok = true;
      } else {
        addLog(lineId, `导入失败: ${data.message || resp.statusText}`, "err");
        for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
        addLog(lineId, "密钥已退回池中", "warn");
      }
    }

    if (ok) {
      db.insert(records).values({ lineId, name: name || cfg.baseUrl, keyCount: useKeys.length }).run();
      let nextName = name;
      if (cfg.fixedName !== "1" && name) {
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
