import { db } from "@/lib/db";
import { logs, records, lines } from "@/lib/schema";
import { eq } from "drizzle-orm";

export function addLog(lineId: number, message: string, level = "info") {
  db.insert(logs).values({ lineId, message, level }).run();
}

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
      groups, priority: cfg.priority !== undefined ? parseInt(cfg.priority) : 0, weight: cfg.weight !== undefined ? parseInt(cfg.weight) : 10,
      multi_key_mode: cfg.multiKeyMode || "random", settings, name: cfg.channelName || "",
      base_url: cfg.baseUrlChannel || "", model_mapping: cfg.modelMapping || "",
      test_model: cfg.testModel || "", key: keyStr, status_code_mapping: "",
      tag: cfg.tag || "", setting, group: groups[0] || "default"
    }
  };
}

export function buildNaciPayload(cfg: Record<string, string>, keyStr: string) {
  const siteIds = JSON.parse(cfg.naciSiteIds || "[21,13,6]");
  const siteGroupOverrides = JSON.parse(cfg.naciSiteGroups || "{}");
  const channelJson: Record<string, unknown> = {
    name: cfg.channelName || "",
    model_series: "",
    type: parseInt(cfg.channelType) || 14,
    key: keyStr.trim(),
    openai_organization: "",
    max_input_tokens: 0,
    base_url: cfg.baseUrlChannel || "",
    other: "",
    model_mapping: cfg.modelMapping || "",
    param_override: "",
    header_override: "",
    status_code_mapping: "",
    models: cfg.models || "",
    provider_id: parseInt(cfg.naciProviderId || "3"),
    auto_ban: parseInt(cfg.autoBan) || 1,
    test_model: cfg.testModel || "",
    priority: cfg.priority !== undefined ? parseInt(cfg.priority) : 7,
    weight: cfg.weight !== undefined ? parseInt(cfg.weight) : 1,
    tag: cfg.tag || "",
    settings: JSON.stringify({ allow_service_tier: false }),
    group: (cfg.groups || "anthropic").split(",")[0].trim(),
    status: 2,
    setting: JSON.stringify({ proxy: "", concurrency_protection_enabled: false, max_concurrency: 500, concurrency_protection_threshold: 60, ramp_up_minutes: 5, ramp_recovery_threshold: 54, ramp_reach_threshold: 90, ramp_up_confirm_windows: 1, ramp_down_load_threshold: 10, ramp_down_unhealthy_windows: 2 }),
    remark: "",
    other_info: "",
    channel_info: {},
    azure_responses_version: "",
    doubao_asset_ak_sk: "",
    doubao_asset_host: "",
    doubao_asset_project_name: "",
    platform_channel_type: cfg.naciPlatformType || "anthropic_claude",
    ramp_down_load_threshold: 10,
    ramp_down_unhealthy_windows: 2,
    ramp_reach_threshold: 90,
    ramp_recovery_threshold: 54,
    ramp_up_confirm_windows: 1,
  };
  return {
    name: cfg.channelName || "",
    description: "",
    channel_json: JSON.stringify(channelJson, null, 2),
    last_selected_site_ids_json: JSON.stringify(siteIds),
    owner_user_id: cfg.naciOwnerUserId ? parseInt(cfg.naciOwnerUserId) : null,
    site_group_overrides: siteGroupOverrides,
    site_publish_settings: {},
  };
}

export function buildSub2apiPayload(cfg: Record<string, string>, key: string) {
  const siteIds = JSON.parse(cfg.sub2apiSiteIds || "[]");
  return {
    key: key.trim(),
    alias: cfg.channelName || "",
    key_type: cfg.sub2apiKeyType || "anthropic",
    site_ids: siteIds,
    tag_suffix: cfg.tag || "",
    aws_v: "",
    proxy_ids: [],
    channel_name: "",
  };
}

export function buildKeyhubPayload(cfg: Record<string, string>, key: string) {
  const models = (cfg.models || "").split(",").map(m => m.trim()).filter(Boolean);
  return {
    categoryCode: cfg.keyhubCategoryCode || "anthropic",
    endpointUrl: "https://api.anthropic.com",
    rawText: key.trim(),
    keyType: cfg.keyhubKeyType || "fast",
    modelScope: cfg.keyhubModelScope || "limited",
    models,
    expectedTpm: 0,
    note: cfg.channelName || "",
  };
}

export function buildZhongzhuanPayload(cfg: Record<string, string>, keys: string[]) {
  const models = (cfg.models || "").split(",").map(m => m.trim()).filter(Boolean);
  return {
    category: cfg.zhongzhuanCategory || "anthropic",
    items: keys.map(k => ({ key: k.trim(), base_url: "", remark: "", proxy: "" })),
    models,
    tag: cfg.channelName || cfg.tag || "",
    remark: "",
    proxy: "",
    standby: false,
  };
}

export function buildKeymanPayload(cfg: Record<string, string>, key: string) {
  return {
    name: cfg.channelName || "",
    type: parseInt(cfg.channelType) || 14,
    key: key.trim(),
    models: cfg.models || "",
    group: cfg.groups || "",
    quota: "",
  };
}

export function getImportEndpoint(cfg: Record<string, string>): string {
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (cfg.platformType === "naci") return baseUrl + "/api/admin-hub/channels/";
  if (cfg.platformType === "sub2api") return baseUrl + "/api/user/api-keys";
  if (cfg.platformType === "keyhub") return baseUrl + "/keyhub/api/keys/import";
  if (cfg.platformType === "zhongzhuan") return baseUrl + "/api/channels/batch";
  if (cfg.platformType === "keyman") return baseUrl + "/api/channels";
  return baseUrl + "/api/channel/";
}

export function getAuthHeaders(cfg: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Cache-Control": "no-store",
  };
  if (cfg.platformType === "sub2api") {
    headers["Authorization"] = cfg.authValue || "";
  } else if (cfg.platformType === "keyhub") {
    headers["Cookie"] = cfg.authValue || "";
  } else if (cfg.platformType === "zhongzhuan") {
    headers["Authorization"] = `Bearer ${cfg.authValue || ""}`;
  } else if (cfg.platformType === "keyman") {
    headers["Cookie"] = `km_session=${cfg.authValue || ""}`;
  } else {
    headers["New-API-User"] = cfg.newApiUser || "3";
    const cookie = getCookie(cfg);
    if (cookie) headers["Cookie"] = cookie;
  }
  return headers;
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

async function importBatch(cfg: Record<string, string>, headers: Record<string, string>, endpoint: string, keyStr: string, importKeys: string[], lineId: number): Promise<{ ok: boolean; channelIds: number[] }> {
  const channelIds: number[] = [];

  if (cfg.platformType === "sub2api") {
    let success = 0;
    for (const key of importKeys) {
      try {
        const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildSub2apiPayload(cfg, key)) });
        const data = await resp.json();
        if (resp.ok && !data.error) success++;
      } catch { /* skip */ }
    }
    return { ok: success > 0, channelIds };
  }

  if (cfg.platformType === "keyman") {
    let success = 0;
    for (const key of importKeys) {
      try {
        const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildKeymanPayload(cfg, key)) });
        const data = await resp.json();
        if (resp.ok && data.success !== false) {
          success++;
          if (data.data?.channel_id) channelIds.push(data.data.channel_id);
        }
        addLog(lineId, `[Keyman] ${resp.status} ${key.slice(-8)}: ${data.success ? '✓' : data.message || 'fail'}`, resp.ok ? "ok" : "err");
      } catch (e: unknown) {
        addLog(lineId, `[Keyman] 异常: ${e instanceof Error ? e.message : String(e)}`, "err");
      }
    }
    return { ok: success > 0, channelIds };
  }

  if (cfg.platformType === "keyhub") {
    let success = 0;
    for (const key of importKeys) {
      try {
        const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildKeyhubPayload(cfg, key)) });
        const data = await resp.json();
        if (resp.ok && !data.error) success++;
      } catch { /* skip */ }
    }
    return { ok: success > 0, channelIds };
  }

  if (cfg.platformType === "zhongzhuan") {
    const payload = buildZhongzhuanPayload(cfg, importKeys);
    try {
      const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await resp.text();
      addLog(lineId, `[中转站] ${resp.status} ${text.substring(0, 200)}`, resp.ok ? "info" : "err");
      const data = JSON.parse(text);
      if (resp.ok && data.success !== false) {
        const results = data.data?.results || [];
        for (const r of results) { if (r.channel_id) channelIds.push(r.channel_id); }
        return { ok: (data.data?.success || 0) > 0, channelIds };
      }
    } catch (e: unknown) {
      addLog(lineId, `[中转站] 请求异常: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
    return { ok: false, channelIds };
  }

  // New API / Naci
  const payload = cfg.platformType === "naci" ? buildNaciPayload(cfg, keyStr) : buildPayload(cfg, keyStr);
  const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const data = await resp.json();

  if (resp.ok && data.success !== false) {
    if (data.data?.channel?.id) channelIds.push(data.data.channel.id);
    if (data.data?.channels) {
      for (const ch of data.data.channels) { if (ch.id) channelIds.push(ch.id); }
    }
    return { ok: true, channelIds };
  }
  return { ok: false, channelIds };
}

async function rotateKeys(cfg: Record<string, string>, headers: Record<string, string>, useKeys: string[], lineId: number): Promise<boolean> {
  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");

  // 找到最新的冻结批次，用它的渠道名去搜索远程渠道
  const frozenRecs = db.select().from(records).where(eq(records.lineId, lineId)).all().filter(r => r.frozen);
  const latestFrozen = frozenRecs[frozenRecs.length - 1];
  if (!latestFrozen) {
    addLog(lineId, "[换key] 没有冻结批次，跳过", "warn");
    return false;
  }

  const channelName = latestFrozen.name;
  addLog(lineId, `[换key] 搜索冻结渠道「${channelName}」...`, "info");

  // 搜索远程渠道
  try {
    const searchUrl = `${baseUrl}/api/channel/search?keyword=${encodeURIComponent(channelName)}&group=&model=&id_sort=false&tag_mode=false&p=1&page_size=100`;
    const searchResp = await fetch(searchUrl, { method: "GET", headers });
    const searchData = await searchResp.json();
    const channels = (searchData.data?.items || []).filter((ch: any) => ch.name === channelName);

    if (channels.length === 0) {
      addLog(lineId, `[换key] 未找到渠道「${channelName}」`, "warn");
      return false;
    }

    const keyStr = "\n" + useKeys.join("\n");
    let success = 0;

    for (const ch of channels) {
      try {
        const resp = await fetch(`${baseUrl}/api/channel/`, {
          method: "PUT", headers,
          body: JSON.stringify({ id: ch.id, key: keyStr, status: 1 }),
        });
        if (resp.ok) {
          success++;
          addLog(lineId, `[换key] 渠道 ${ch.id}「${channelName}」已换key+启用`, "ok");
        } else {
          addLog(lineId, `[换key] 渠道 ${ch.id} 更新失败: ${resp.status}`, "err");
        }
      } catch (e: unknown) {
        addLog(lineId, `[换key] 渠道 ${ch.id} 请求失败: ${e instanceof Error ? e.message : String(e)}`, "err");
      }
    }

    // 解冻由 refresh 处理，这里只负责换 key

    addLog(lineId, `[换key] 完成: ${success}/${channels.length} 渠道已更新`, success > 0 ? "ok" : "err");
    return success > 0;
  } catch (e: unknown) {
    addLog(lineId, `[换key] 搜索失败: ${e instanceof Error ? e.message : String(e)}`, "err");
    return false;
  }
}

export async function executeImport(cfg: Record<string, string>, useKeys: string[], lineId: number): Promise<{ ok: boolean; channelIds: number[] }> {
  const strategy = cfg.importStrategy || "default";
  const endpoint = getImportEndpoint(cfg);
  const headers = getAuthHeaders(cfg);

  if (strategy === "rotate") {
    const ok = await rotateKeys(cfg, headers, useKeys, lineId);
    return { ok, channelIds: [] };
  }

  let importKeys = useKeys;
  if (strategy === "overlap") {
    const multiplier = parseInt(cfg.overlapMultiplier) || 2;
    importKeys = [];
    for (let m = 0; m < multiplier; m++) importKeys.push(...useKeys);
    addLog(lineId, `[重叠] ${useKeys.length} key × ${multiplier} = ${importKeys.length} 渠道`, "info");
  }

  const keyStr = "\n" + importKeys.join("\n");
  return importBatch(cfg, headers, endpoint, keyStr, importKeys, lineId);
}

export function saveChannelSlots(lineId: number, channelIds: number[], name: string) {
  if (channelIds.length === 0) return;
  try {
    const insertSlot = (db as any).prepare("INSERT INTO channel_slots (line_id, remote_channel_id, name, created_at) VALUES (?, ?, ?, unixepoch())");
    for (const cid of channelIds) insertSlot.run(lineId, cid, name);
    addLog(lineId, `[记录] 保存 ${channelIds.length} 个渠道ID`, "info");
  } catch { /* channel_slots table issue */ }
}

export function createRecordAndAdvanceName(lineId: number, cfg: Record<string, string>, useKeys: string[], strategy: string): string {
  const name = cfg.channelName || cfg.baseUrl || "";
  let keyCount = useKeys.length;
  if (strategy === "overlap") keyCount *= parseInt(cfg.overlapMultiplier) || 2;
  db.insert(records).values({ lineId, name, keyCount }).run();
  if (strategy !== "rotate" && cfg.fixedName !== "1" && cfg.channelName) {
    const nextName = incrementName(cfg.channelName);
    cfg.channelName = nextName;
    db.update(lines).set({ config: JSON.stringify(cfg) }).where(eq(lines.id, lineId)).run();
    addLog(lineId, `名称递增 → ${nextName}`, "info");
    return nextName;
  }
  return name;
}
