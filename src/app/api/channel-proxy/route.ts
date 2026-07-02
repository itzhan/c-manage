export async function POST(req: Request) {
  const { targetUrl, cookie, body, method, newApiUser } = await req.json();
  if (!targetUrl) return Response.json({ success: false, error: "Missing targetUrl" }, { status: 400 });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "New-API-User": newApiUser || "3",
    "Cache-Control": "no-store",
  };
  if (cookie) headers["Cookie"] = cookie;

  const m = (method || "POST").toUpperCase();
  const opts: RequestInit = { method: m, headers };
  if (m !== "GET" && body) opts.body = JSON.stringify(body);

  const resp = await fetch(targetUrl, opts);
  const data = await resp.json();
  return Response.json(data, { status: resp.status });
}
