export function incrementName(name: string): string {
  const m = name.match(/^(.*?)(\d+)$/);
  if (!m) return name + "0001";
  return m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0");
}

export function buildPayload(cfg: Record<string, string>, keyStr: string) {
  const settings = JSON.stringify({ allow_service_tier: false, allow_inference_geo: false, allow_speed: false, claude_beta_query: false, upstream_model_update_check_enabled: false, upstream_model_update_auto_sync_enabled: false, upstream_model_update_ignored_models: [], upstream_model_update_last_detected_models: [], upstream_model_update_last_check_time: 0 });
  const setting = JSON.stringify({ force_format: false, thinking_to_content: false, proxy: cfg.proxyUrl || "", socks5_proxy_level: cfg.socks5Level || "medium", socks5_assignment_policy: "dynamic", socks5_rotation_interval_seconds: 300, pass_through_body_enabled: false, system_prompt: "", system_prompt_override: false, tls_fingerprint: "" });
  const groups = (cfg.groups || "default").split(",").map((g: string) => g.trim()).filter(Boolean);
  return {
    mode: "batch",
    channel: {
      type: parseInt(cfg.channelType) || 14, max_input_tokens: 0, other: "", param_override: "",
      models: cfg.models || "", auto_ban: parseInt(cfg.autoBan) || 1,
      groups, priority: parseInt(cfg.priority) || 0, weight: parseInt(cfg.weight) || 10,
      multi_key_mode: cfg.multiKeyMode || "random", settings, name: cfg.channelName || "",
      base_url: cfg.baseUrlChannel || "", model_mapping: cfg.modelMapping || "",
      test_model: cfg.testModel || "", key: keyStr, status_code_mapping: "",
      tag: cfg.tag || "", setting, group: groups[0] || "default"
    }
  };
}

export async function proxyFetch(targetUrl: string, opts: { cookie?: string; body?: unknown; method?: string; newApiUser?: string }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "New-API-User": opts.newApiUser || "3",
    "Cache-Control": "no-store",
  };
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  const method = (opts.method || "POST").toUpperCase();
  const fetchOpts: RequestInit = { method, headers };
  if (method !== "GET" && opts.body) fetchOpts.body = JSON.stringify(opts.body);
  const resp = await fetch(targetUrl, fetchOpts);
  return resp.json();
}

export function getCookie(cfg: Record<string, string>): string {
  if ((cfg.authType || "session") === "session") {
    const v = cfg.authValue || "";
    return v.startsWith("session=") ? v : "session=" + v;
  }
  return "";
}
