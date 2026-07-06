import { db } from "@/lib/db";
import { lines } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCookie } from "@/lib/channel";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const line = db.select().from(lines).where(eq(lines.id, parseInt(id))).get();
  if (!line) return Response.json({ error: "not found" }, { status: 404 });

  const cfg = JSON.parse(line.config);
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl || !cfg.authValue) return Response.json({ rpm: 0, tpm: 0, quota: 0 });

  // Only works for newapi platforms
  if (cfg.platformType && cfg.platformType !== "newapi") return Response.json({ rpm: 0, tpm: 0, quota: 0 });

  const now = Math.floor(Date.now() / 1000);
  const group = (cfg.groups || "").split(",")[0].trim();
  const url = `${baseUrl}/api/log/stat?type=0&username=&token_name=&model_name=&start_timestamp=${now - 3600}&end_timestamp=${now}&channel=&group=${encodeURIComponent(group)}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "New-API-User": cfg.newApiUser || "3",
    "Cache-Control": "no-store",
  };
  const cookie = getCookie(cfg);
  if (cookie) headers["Cookie"] = cookie;

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    const data = await resp.json();
    if (data.success !== false && data.data) {
      return Response.json({
        rpm: data.data.rpm || 0,
        tpm: data.data.tpm || 0,
        quota: data.data.quota || 0,
      });
    }
  } catch { /* ignore */ }
  return Response.json({ rpm: 0, tpm: 0, quota: 0 });
}
