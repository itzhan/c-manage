import { db } from "@/lib/db";
import { keys, lines } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { addLog, executeImport, saveChannelSlots, createRecordAndAdvanceName } from "@/lib/channel";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: Request) {
  const body = (await req.json()) as { count: number; mode?: string; lineRatios?: Record<string, number> };
  const { count, mode, lineRatios } = body;
  if (!count || count <= 0) {
    return Response.json({ success: false, error: "count must be > 0" }, { status: 400 });
  }

  const poolKeys = db.select().from(keys).orderBy(asc(keys.id)).limit(count).all();
  if (!poolKeys.length) {
    return Response.json({ success: false, error: "密钥池为空" }, { status: 400 });
  }

  const useKeys = poolKeys.map(k => k.key);
  for (const k of poolKeys) db.delete(keys).where(eq(keys.id, k.id)).run();

  const allLines = db.select().from(lines).all();
  const results: Array<{ lineId: number; label: string; success: boolean; name?: string; error?: string; keyCount?: number }> = [];
  let anySuccess = false;

  for (const line of allLines) {
    const cfg = JSON.parse(line.config) as Record<string, string>;
    const lineMode = cfg.importMode || "independent";

    if (mode === "global") {
      if (lineMode !== "global") continue;
    } else if (mode === "independent") {
      if (line.id !== parseInt(String(lineRatios?.targetLineId || "0"))) continue;
    } else {
      if (cfg.importDisabled === "1") {
        results.push({ lineId: line.id, label: line.label, success: false, error: "已禁用", keyCount: 0 });
        continue;
      }
    }

    const ratio = lineRatios?.[String(line.id)];
    if (ratio === 0) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "已跳过", keyCount: 0 });
      continue;
    }

    const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    const name = cfg.channelName || "";

    if (!baseUrl || !cfg.authValue || !name) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "配置不完整", keyCount: 0 });
      addLog(line.id, `[导入] 跳过: 配置不完整`, "warn");
      continue;
    }

    let lineKeys: string[];
    if (ratio !== undefined && ratio < 100) {
      const n = Math.round(useKeys.length * ratio / 100);
      lineKeys = n >= useKeys.length ? useKeys : shuffle(useKeys).slice(0, Math.max(1, n));
    } else {
      const globalRatio = parseInt(cfg.globalRatio) || 100;
      if (mode === "global" && globalRatio < 100) {
        const n = Math.round(useKeys.length * globalRatio / 100);
        lineKeys = shuffle(useKeys).slice(0, Math.max(1, n));
      } else {
        lineKeys = useKeys;
      }
    }

    if (lineKeys.length === 0) {
      results.push({ lineId: line.id, label: line.label, success: false, error: "计算后数量为0", keyCount: 0 });
      continue;
    }

    const strategy = cfg.importStrategy || "default";
    addLog(line.id, `[导入] 导入密钥 → 「${name || baseUrl}」 (${strategy})`, "info");

    try {
      const result = await executeImport(cfg, lineKeys, line.id);
      if (result.ok) {
        saveChannelSlots(line.id, result.channelIds, name);
        createRecordAndAdvanceName(line.id, cfg, lineKeys, strategy);
        results.push({ lineId: line.id, label: line.label, success: true, name: name || baseUrl, keyCount: lineKeys.length });
        anySuccess = true;
      } else {
        results.push({ lineId: line.id, label: line.label, success: false, error: "导入失败", keyCount: lineKeys.length });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(line.id, `[导入] 请求失败: ${msg}`, "err");
      results.push({ lineId: line.id, label: line.label, success: false, error: msg, keyCount: lineKeys.length });
    }
  }

  if (!anySuccess) {
    for (const k of useKeys) { try { db.insert(keys).values({ key: k }).run(); } catch { /* dup */ } }
  }

  const remaining = db.select().from(keys).all().length;
  return Response.json({ success: true, data: { keysUsed: useKeys.length, remaining, results } });
}
