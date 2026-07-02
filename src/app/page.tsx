"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type Line = { id: number; label: string; config: Record<string, string>; autoEnabled: number; autoBatchSize: number; activeCount: number; recordCount: number };
type Rec = { id: number; lineId: number; name: string; keyCount: number; cachedQuota: number; allDisabledSince: number | null; frozen: number; lastRefresh: number | null; importedAt: number };
type LogEntry = { id: number; message: string; level: string; createdAt: number };

const FREEZE_AFTER = 300;
const fmtQ = (q: number) => "$" + (q / 500000).toFixed(2);
const fmtT = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleTimeString("zh-CN", { hour12: false }) : "-";
function incName(name: string) { const m = name.match(/^(.*?)(\d+)$/); if (!m) return name + "0001"; return m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0"); }
function countLines(text: string) { return text.split("\n").map(s => s.trim()).filter(Boolean).length; }

const PRESETS: [string, string][] = [
  ["Claude Opus", "claude-opus-4-6,claude-opus-4-7,claude-opus-4-8"],
  ["Claude Sonnet", "claude-sonnet-4-6,claude-sonnet-4-5-20241022"],
  ["Claude Haiku", "claude-haiku-4-5-20251001"],
  ["Claude All", "claude-opus-4-6,claude-opus-4-7,claude-opus-4-8,claude-sonnet-4-6,claude-sonnet-4-5-20241022,claude-haiku-4-5-20251001"],
  ["GPT", "gpt-4o,gpt-4o-mini,gpt-4.1,gpt-4.1-mini,gpt-4.1-nano"],
];

export default function Page() {
  const [lines, setLines] = useState<Line[]>([]);
  const [lid, setLid] = useState<number | null>(null);
  const [poolN, setPoolN] = useState(0);
  const [poolKeys, setPoolKeys] = useState<string[]>([]);
  const [showPool, setShowPool] = useState(false);
  const [newKeys, setNewKeys] = useState("");
  const [recs, setRecs] = useState<Rec[]>([]);
  const [recTotal, setRecTotal] = useState(0);
  const [recQuota, setRecQuota] = useState(0);
  const [recKeys, setRecKeys] = useState(0);
  const [pg, setPg] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [autoOn, setAutoOn] = useState(false);
  const [autoBatch, setAutoBatch] = useState(10);
  const [impCount, setImpCount] = useState(10);
  const [impBusy, setImpBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showAdv, setShowAdv] = useState(false);

  // Use refs for timer callback to avoid re-creating interval on every state change
  const lidRef = useRef(lid);
  const pgRef = useRef(pg);
  const pausedRef = useRef(paused);
  lidRef.current = lid;
  pgRef.current = pg;
  pausedRef.current = paused;

  const fPool = useCallback(async () => { const r = await fetch("/api/keys").then(r => r.json()); if (r.success) { setPoolN(r.data.total); setPoolKeys(r.data.keys); } }, []);
  const fLines = useCallback(async () => { const r = await fetch("/api/lines").then(r => r.json()); if (r.success) setLines(r.data); return r.data as Line[]; }, []);
  const fRecs = useCallback(async (id: number, p = 1) => { const r = await fetch(`/api/lines/${id}/records?page=${p}&pageSize=10`).then(r => r.json()); if (r.success) { setRecs(r.data.items); setRecTotal(r.data.total); setRecQuota(r.data.totalQuota); setRecKeys(r.data.totalKeys); } }, []);
  const fLogs = useCallback(async (id: number) => { const r = await fetch(`/api/lines/${id}/logs`).then(r => r.json()); if (r.success) setLogs(r.data); }, []);

  const loadLine = useCallback(async (id: number, lns: Line[]) => {
    const l = lns.find(x => x.id === id);
    if (l) { setCfg(l.config); setAutoOn(!!l.autoEnabled); setAutoBatch(l.autoBatchSize); }
    await fRecs(id, 1); setPg(1); await fLogs(id);
  }, [fRecs, fLogs]);

  // Initial load
  useEffect(() => { (async () => { await fPool(); const ls = await fLines(); if (ls.length) { setLid(ls[0].id); await loadLine(ls[0].id, ls); } })(); }, []);

  // Stable refresh function using refs — does NOT change identity on state updates
  const doRefresh = useCallback(async () => {
    await fetch("/api/refresh", { method: "POST" });
    const ls = await fLines();
    await fPool();
    const currentLid = lidRef.current;
    const currentPg = pgRef.current;
    if (currentLid) {
      await fRecs(currentLid, currentPg);
      await fLogs(currentLid);
      const l = ls.find((x: Line) => x.id === currentLid);
      if (l) { setCfg(l.config); setAutoOn(!!l.autoEnabled); }
    }
  }, [fLines, fPool, fRecs, fLogs]);

  // Single stable interval — only recreated when paused changes
  useEffect(() => {
    if (paused) return;
    const t = setInterval(doRefresh, 10000);
    return () => clearInterval(t);
  }, [paused, doRefresh]);

  const saveCfg = async (c: Record<string, string>) => { setCfg(c); if (lid) fetch(`/api/lines/${lid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: c }) }); };
  const upd = (k: string, v: string) => saveCfg({ ...cfg, [k]: v });

  const addKeys = async () => { const k = newKeys.split("\n").map(s => s.trim()).filter(Boolean); if (!k.length) return; await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: k }) }); setNewKeys(""); fPool(); };
  const clearPool = async () => { if (!confirm("确认清空密钥池？")) return; await fetch("/api/keys", { method: "DELETE" }); fPool(); };

  const addLine = async () => { const label = prompt("线路名称:", `线路${lines.length + 1}`); if (!label?.trim()) return; const r = await fetch("/api/lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label.trim() }) }).then(r => r.json()); if (r.success) { const ls = await fLines(); setLid(r.data.id); loadLine(r.data.id, ls); } };
  const renLine = async (id: number, old: string) => { const l = prompt("线路名称:", old); if (!l?.trim()) return; await fetch(`/api/lines/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: l.trim() }) }); fLines(); };
  const delLine = async (id: number) => { if (!confirm("确认删除？")) return; await fetch(`/api/lines/${id}`, { method: "DELETE" }); if (lid === id) setLid(null); const ls = await fLines(); if (ls.length && lid === id) { setLid(ls[0].id); loadLine(ls[0].id, ls); } };
  const delRec = async (rid: number) => { if (!lid) return; await fetch(`/api/lines/${lid}/records?recordId=${rid}`, { method: "DELETE" }); fRecs(lid, pg); fLines(); };
  const clrRecs = async () => { if (!lid || !confirm("确认清空？")) return; await fetch(`/api/lines/${lid}/records`, { method: "DELETE" }); fRecs(lid, 1); setPg(1); fLines(); };

  const doImport = async () => {
    if (!lid) return; setImpBusy(true);
    const r = await fetch(`/api/lines/${lid}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: impCount }) }).then(r => r.json());
    setImpBusy(false); fPool(); fRecs(lid, pg); fLogs(lid); fLines();
    if (r.success) setCfg(c => ({ ...c, channelName: r.data.nextName }));
  };

  const saveAuto = async (on: boolean, bs: number) => { setAutoOn(on); setAutoBatch(bs); if (lid) fetch(`/api/lines/${lid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: on, autoBatchSize: bs }) }); };
  const clrLogs = async () => { if (!lid) return; await fetch(`/api/lines/${lid}/logs`, { method: "DELETE" }); setLogs([]); };

  const totalPg = Math.ceil(recTotal / 10);
  const pendingKeyCount = countLines(newKeys);

  return (
    <div className="max-w-[960px] mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">渠道上号中枢</h1>

      {/* Key Pool */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>密钥池 (全局共享)</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">剩余子弹:</span>
              <Badge variant="secondary" className="text-base px-3 py-0.5">{poolN}</Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder={"sk-ant-api03-xxxx\n每行一个密钥"}
            value={newKeys}
            onChange={e => setNewKeys(e.target.value)}
            className="font-mono text-xs resize-none"
            style={{ height: "120px" }}
          />
          <div className="flex gap-2 items-center">
            <Button size="sm" onClick={addKeys} disabled={pendingKeyCount === 0}>
              追加到密钥池{pendingKeyCount > 0 && ` (${pendingKeyCount})`}
            </Button>
            <Button size="sm" variant="destructive" onClick={clearPool}>清空</Button>
            {pendingKeyCount > 0 && (
              <span className="text-xs text-muted-foreground">将加入 {pendingKeyCount} 个密钥，加入后池中共 {poolN + pendingKeyCount} 个</span>
            )}
            <Button size="sm" variant="ghost" onClick={() => setShowPool(!showPool)} className="ml-auto text-xs text-muted-foreground">{showPool ? "收起" : "查看池中密钥"}</Button>
          </div>
          {showPool && (
            <div className="bg-muted/30 rounded p-2 max-h-[150px] overflow-y-auto font-mono text-[11px] text-muted-foreground">
              {poolKeys.length === 0 ? <span className="text-muted-foreground/50">池中暂无密钥</span> : poolKeys.map((k, i) => <div key={i}>{i + 1}. {k}</div>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab Bar */}
      <div className="flex items-center border-b border-border">
        {lines.map(l => (
          <div key={l.id} className={`group flex items-center gap-1.5 px-4 py-2.5 text-sm cursor-pointer border-b-2 transition-colors ${l.id === lid ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => { setLid(l.id); loadLine(l.id, lines); }}>
            {l.label}
            {l.activeCount > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{l.activeCount}</Badge>}
            <span className="hidden group-hover:inline text-muted-foreground hover:text-foreground text-xs ml-1 cursor-pointer" onClick={e => { e.stopPropagation(); renLine(l.id, l.label); }}>&#9998;</span>
            {lines.length > 1 && <span className="hidden group-hover:inline text-muted-foreground hover:text-destructive text-xs cursor-pointer" onClick={e => { e.stopPropagation(); delLine(l.id); }}>&#10005;</span>}
          </div>
        ))}
        <button className="px-3 py-2.5 text-lg text-muted-foreground hover:text-primary" onClick={addLine}>+</button>
      </div>

      {lid && (
        <div className="space-y-4">
          {/* Monitor */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm flex items-center gap-2">消费监控 <Badge variant="secondary">{recTotal}</Badge></CardTitle>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto"><span className={`w-1.5 h-1.5 rounded-full ${paused ? "bg-yellow-500" : "bg-green-500"}`} />{paused ? "已暂停" : "每10s刷新"}</div>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setPaused(!paused)}>{paused ? "恢复" : "暂停"}</Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={doRefresh}>刷新</Button>
                <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={clrRecs}>清空</Button>
              </div>
            </CardHeader>
            <CardContent>
              {recs.length === 0 ? <p className="text-center text-muted-foreground text-sm py-6">暂无导入记录</p> : (<>
                <Table><TableHeader><TableRow><TableHead>渠道名称</TableHead><TableHead>密钥数</TableHead><TableHead>状态</TableHead><TableHead>总消耗</TableHead><TableHead>刷新时间</TableHead><TableHead className="w-8" /></TableRow></TableHeader>
                <TableBody>{recs.map(r => {
                  const now = Math.floor(Date.now() / 1000);
                  let st = "活跃", sc = "text-green-500";
                  if (r.frozen) { st = "已冻结"; sc = "text-muted-foreground"; }
                  else if (r.allDisabledSince) { st = `全禁用 (${Math.max(0, FREEZE_AFTER - (now - r.allDisabledSince))}s)`; sc = "text-yellow-500"; }
                  return (<TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.keyCount}</TableCell>
                    <TableCell className={`text-xs ${sc}`}>{st}</TableCell>
                    <TableCell className="font-mono font-semibold text-xs">{fmtQ(r.cachedQuota)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{fmtT(r.lastRefresh)}</TableCell>
                    <TableCell><button className="text-muted-foreground hover:text-destructive text-xs" onClick={() => delRec(r.id)}>&#10005;</button></TableCell>
                  </TableRow>);
                })}</TableBody></Table>
                <div className="flex justify-end pt-2 text-sm font-semibold"><span className="text-muted-foreground mr-2">全部 {recTotal} 组 · {recKeys} 个密钥 · 总计:</span><span className="font-mono">{fmtQ(recQuota)}</span></div>
                {totalPg > 1 && <div className="flex justify-center gap-1 pt-2">{Array.from({ length: totalPg }, (_, i) => (<Button key={i} size="sm" variant={pg === i + 1 ? "default" : "ghost"} className="h-7 w-7 p-0 text-xs" onClick={() => { setPg(i + 1); fRecs(lid, i + 1); }}>{i + 1}</Button>))}</div>}
              </>)}
            </CardContent>
          </Card>

          {/* Connection Config */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">连接配置</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-[2]"><Label className="text-xs">API 地址</Label><Input value={cfg.baseUrl || ""} onChange={e => upd("baseUrl", e.target.value)} /></div>
                <div className="w-[140px]"><Label className="text-xs">认证方式</Label>
                  <Select value={cfg.authType || "session"} onValueChange={v => v && upd("authType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="session">Session Cookie</SelectItem><SelectItem value="token">Access Token</SelectItem></SelectContent></Select>
                </div>
                <div className="w-[100px]"><Label className="text-xs">API-User</Label><Input value={cfg.newApiUser || "3"} onChange={e => upd("newApiUser", e.target.value)} /></div>
              </div>
              <div><Label className="text-xs">{cfg.authType === "token" ? "Access Token" : "Session Cookie"}</Label><Input value={cfg.authValue || ""} onChange={e => upd("authValue", e.target.value)} /></div>
            </CardContent>
          </Card>

          {/* Channel Config */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">渠道配置</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1"><Label className="text-xs">渠道名称</Label><Input value={cfg.channelName || ""} onChange={e => upd("channelName", e.target.value)} />{cfg.channelName && <p className="text-xs text-primary mt-1">下次 → {incName(cfg.channelName)}</p>}</div>
                <div className="w-[160px]"><Label className="text-xs">渠道类型</Label>
                  <Select value={cfg.channelType || "14"} onValueChange={v => v && upd("channelType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">OpenAI</SelectItem><SelectItem value="14">Anthropic</SelectItem><SelectItem value="3">Azure</SelectItem><SelectItem value="24">其他</SelectItem></SelectContent></Select>
                </div>
              </div>
              <div><Label className="text-xs">模型</Label>
                <div className="flex gap-1.5 flex-wrap mb-2">{PRESETS.map(([l, v]) => <Button key={l} size="sm" variant={cfg.models === v ? "default" : "outline"} className="h-6 text-xs px-2" onClick={() => upd("models", v)}>{l}</Button>)}</div>
                <Input value={cfg.models || ""} onChange={e => upd("models", e.target.value)} className="font-mono text-xs" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1"><Label className="text-xs">分组</Label><Input value={cfg.groups || ""} onChange={e => upd("groups", e.target.value)} /></div>
                <div className="flex-1"><Label className="text-xs">标签</Label><Input value={cfg.tag || ""} onChange={e => upd("tag", e.target.value)} /></div>
                <div className="w-20"><Label className="text-xs">优先级</Label><Input type="number" value={cfg.priority || "0"} onChange={e => upd("priority", e.target.value)} /></div>
                <div className="w-20"><Label className="text-xs">权重</Label><Input type="number" value={cfg.weight || "0"} onChange={e => upd("weight", e.target.value)} /></div>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdv(!showAdv)}>{showAdv ? "▾" : "▸"} 高级设置</button>
              {showAdv && <div className="space-y-3 pt-2">
                <div className="flex gap-3"><div className="flex-1"><Label className="text-xs">Base URL</Label><Input value={cfg.baseUrlChannel || ""} onChange={e => upd("baseUrlChannel", e.target.value)} /></div><div className="flex-1"><Label className="text-xs">模型映射</Label><Input value={cfg.modelMapping || ""} onChange={e => upd("modelMapping", e.target.value)} /></div></div>
                <div className="flex gap-3">
                  <div className="w-[140px]"><Label className="text-xs">多密钥模式</Label><Select value={cfg.multiKeyMode || "random"} onValueChange={v => v && upd("multiKeyMode", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="random">随机</SelectItem><SelectItem value="round_robin">轮询</SelectItem></SelectContent></Select></div>
                  <div className="w-[120px]"><Label className="text-xs">自动禁用</Label><Select value={cfg.autoBan || "1"} onValueChange={v => v && upd("autoBan", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">是</SelectItem><SelectItem value="0">否</SelectItem></SelectContent></Select></div>
                  <div className="flex-1"><Label className="text-xs">测试模型</Label><Input value={cfg.testModel || ""} onChange={e => upd("testModel", e.target.value)} /></div>
                </div>
                <div className="flex gap-3"><div className="flex-1"><Label className="text-xs">代理</Label><Input value={cfg.proxyUrl || ""} onChange={e => upd("proxyUrl", e.target.value)} placeholder="socks5://..." /></div>
                  <div className="w-[140px]"><Label className="text-xs">Socks5级别</Label><Select value={cfg.socks5Level || "medium"} onValueChange={v => v && upd("socks5Level", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">low</SelectItem><SelectItem value="medium">medium</SelectItem><SelectItem value="high">high</SelectItem></SelectContent></Select></div>
                </div>
              </div>}
            </CardContent>
          </Card>

          {/* Auto Reload */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">自动上弹</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Switch checked={autoOn} onCheckedChange={v => saveAuto(v, autoBatch)} />
                <span className="text-sm text-muted-foreground">批次全禁用时自动导入下一批</span>
                <span className={`text-xs ml-auto ${autoOn && poolN > 0 ? "text-green-500" : "text-muted-foreground"}`}>{!autoOn ? "未启用" : poolN === 0 ? "池空" : `池${poolN} · 每批${autoBatch}`}</span>
              </div>
              <div className="flex items-center gap-3 mt-3"><Label className="text-xs w-20">每批数量</Label><Input type="number" className="w-[120px]" value={autoBatch} onChange={e => saveAuto(autoOn, parseInt(e.target.value) || 10)} /></div>
            </CardContent>
          </Card>

          {/* Manual Import */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">手动导入</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="w-[120px]"><Label className="text-xs">取用数量</Label><Input type="number" value={impCount} onChange={e => setImpCount(parseInt(e.target.value) || 0)} /></div>
                <Button onClick={doImport} disabled={impBusy || poolN === 0} className="mt-5">{impBusy ? "导入中..." : "批量导入"}</Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{poolN === 0 ? "密钥池为空" : impCount > poolN ? `池中仅${poolN}个` : `取前${impCount}个，剩余${poolN - impCount}个`}</p>
            </CardContent>
          </Card>

          {/* Logs */}
          <Card>
            <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-sm">日志</CardTitle><Button size="sm" variant="ghost" className="text-xs h-7" onClick={clrLogs}>清空</Button></div></CardHeader>
            <CardContent>
              <div className="bg-muted/20 rounded border border-border p-3 font-mono text-xs max-h-[200px] overflow-y-auto space-y-0.5">
                {logs.length === 0 ? <p className="text-muted-foreground/50">等待操作...</p> : logs.map(l => (
                  <div key={l.id} className={l.level === "ok" ? "text-green-500" : l.level === "err" ? "text-red-500" : l.level === "warn" ? "text-yellow-500" : "text-blue-400"}>{l.message}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
