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

type Rec = { id: number; lineId: number; name: string; keyCount: number; cachedQuota: number; allDisabledSince: number | null; frozen: number; lastRefresh: number | null; importedAt: number };
type Line = { id: number; label: string; config: Record<string, string>; autoEnabled: number; autoBatchSize: number; activeCount: number; recordCount: number; last5: Rec[]; totalKeys: number; todayKeys: number };
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

  // Dashboard
  const [showDashboard, setShowDashboard] = useState(true);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [gdBusy, setGdBusy] = useState(false);
  const [gdResults, setGdResults] = useState<Array<{ lineId?: number; label: string; success: boolean; error?: string; keyCount?: number }>>([]);
  const [groupImpCount, setGroupImpCount] = useState<Record<string, number>>({});

  const lidRef = useRef(lid);
  const pgRef = useRef(pg);
  lidRef.current = lid;
  pgRef.current = pg;

  const fPool = useCallback(async () => { const r = await fetch("/api/keys").then(r => r.json()); if (r.success) { setPoolN(r.data.total); setPoolKeys(r.data.keys); } }, []);
  const fLines = useCallback(async () => { const r = await fetch("/api/lines").then(r => r.json()); if (r.success) setLines(r.data); return r.data as Line[]; }, []);
  const fRecs = useCallback(async (id: number, p = 1) => { const r = await fetch(`/api/lines/${id}/records?page=${p}&pageSize=10`).then(r => r.json()); if (r.success) { setRecs(r.data.items); setRecTotal(r.data.total); setRecQuota(r.data.totalQuota); setRecKeys(r.data.totalKeys); } }, []);
  const fLogs = useCallback(async (id: number) => { const r = await fetch(`/api/lines/${id}/logs`).then(r => r.json()); if (r.success) setLogs(r.data); }, []);

  const loadLine = useCallback(async (id: number, lns: Line[]) => {
    const l = lns.find(x => x.id === id);
    if (l) { setCfg(l.config); setAutoOn(!!l.autoEnabled); setAutoBatch(l.autoBatchSize); }
    await fRecs(id, 1); setPg(1); await fLogs(id);
  }, [fRecs, fLogs]);

  useEffect(() => { (async () => { await fPool(); await fLines(); })(); }, []);

  const cooldownRef = useRef(false);
  const doRefresh = useCallback(async () => {
    if (cooldownRef.current) return;
    const resp = await fetch("/api/refresh", { method: "POST" });
    const result = await resp.json().catch(() => ({}));
    if (result?.data?.cooldown) { cooldownRef.current = true; setTimeout(() => { cooldownRef.current = false; }, 30000); }
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

  useEffect(() => {
    if (paused) return;
    const t = setInterval(doRefresh, 10000);
    return () => clearInterval(t);
  }, [paused, doRefresh]);

  const saveCfg = async (c: Record<string, string>) => { setCfg(c); if (lid) fetch(`/api/lines/${lid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: c }) }); };
  const upd = (k: string, v: string) => saveCfg({ ...cfg, [k]: v });

  const addKeys = async () => { const k = newKeys.split("\n").map(s => s.trim()).filter(Boolean); if (!k.length) return; await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: k }) }); setNewKeys(""); fPool(); };
  const clearPool = async () => { if (!confirm("确认清空密钥池？")) return; await fetch("/api/keys", { method: "DELETE" }); fPool(); };

  const addLine = async () => { const label = prompt("线路名称:", `线路${lines.length + 1}`); if (!label?.trim()) return; const r = await fetch("/api/lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label.trim() }) }).then(r => r.json()); if (r.success) { const ls = await fLines(); setShowDashboard(false); setLid(r.data.id); loadLine(r.data.id, ls); } };
  const renLine = async (id: number, old: string) => { const l = prompt("线路名称:", old); if (!l?.trim()) return; await fetch(`/api/lines/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: l.trim() }) }); fLines(); };
  const delLine = async (id: number) => { if (!confirm("确认删除？")) return; await fetch(`/api/lines/${id}`, { method: "DELETE" }); if (lid === id) setLid(null); const ls = await fLines(); if (ls.length && lid === id) { setLid(ls[0].id); loadLine(ls[0].id, ls); } };
  const delRec = async (rid: number) => { if (!lid) return; await fetch(`/api/lines/${lid}/records?recordId=${rid}`, { method: "DELETE" }); fRecs(lid, pg); fLines(); };
  const clrRecs = async () => { if (!lid || !confirm("确认清空？")) return; await fetch(`/api/lines/${lid}/records`, { method: "DELETE" }); fRecs(lid, 1); setPg(1); fLines(); };

  const [impResults, setImpResults] = useState<Array<{ label: string; success: boolean; name?: string; error?: string }>>([]);

  const doLineImport = async () => {
    if (!lid) return;
    setImpBusy(true); setImpResults([]);
    const r = await fetch(`/api/lines/${lid}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: impCount }) }).then(r => r.json());
    setImpBusy(false);
    if (r.success) setImpResults([{ label: lines.find(l => l.id === lid)?.label || "", success: true, name: r.data?.name }]);
    else setImpResults([{ label: lines.find(l => l.id === lid)?.label || "", success: false, error: r.error }]);
    fPool(); const ls = await fLines();
    if (lid) { fRecs(lid, pg); fLogs(lid); const l = ls.find((x: Line) => x.id === lid); if (l) setCfg(l.config); }
  };

  // Group import
  const doGroupImport = async (group: string, count: number) => {
    setGdBusy(true); setGdResults([]);
    const gLines = lines.filter(l => (l.config?.globalGroup || "") === group && l.config?.importMode === "global");
    const lineRatios: Record<string, number> = {};
    for (const l of gLines) lineRatios[String(l.id)] = parseInt(l.config?.globalRatio) || 100;
    const r = await fetch("/api/import-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count, mode: "global", lineRatios }) }).then(r => r.json());
    if (r.success) setGdResults(r.data.results);
    setGdBusy(false);
    fPool(); fLines();
  };

  // Single line quick import from dashboard
  const doQuickImport = async (lineId: number, count: number) => {
    setGdBusy(true);
    await fetch(`/api/lines/${lineId}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }) });
    setGdBusy(false);
    fPool(); fLines();
  };

  const saveAuto = async (on: boolean, bs: number) => { setAutoOn(on); setAutoBatch(bs); if (lid) fetch(`/api/lines/${lid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: on, autoBatchSize: bs }) }); };
  const saveGroupAuto = async (group: string, on: boolean, bs: number) => {
    const gLines = lines.filter(l => (l.config?.globalGroup || "") === group && l.config?.importMode === "global");
    for (const l of gLines) await fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: on, autoBatchSize: bs }) });
    fLines();
  };

  const clrLogs = async () => { if (!lid) return; await fetch(`/api/lines/${lid}/logs`, { method: "DELETE" }); setLogs([]); };

  const totalPg = Math.ceil(recTotal / 10);
  const pendingKeyCount = countLines(newKeys);
  const isIndependent = (cfg.importMode || "independent") === "independent";

  // Group lines for dashboard
  const groupedLines = new Map<string, Line[]>();
  const independentLines: Line[] = [];
  for (const l of lines) {
    if (l.config?.importMode === "global" && l.config?.globalGroup) {
      const g = l.config.globalGroup;
      if (!groupedLines.has(g)) groupedLines.set(g, []);
      groupedLines.get(g)!.push(l);
    } else {
      independentLines.push(l);
    }
  }
  const allGroups = Array.from(new Set(lines.filter(l => l.config?.importMode === "global" && l.config?.globalGroup).map(l => l.config.globalGroup)));

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className="w-[200px] flex-shrink-0 border-r border-border bg-muted/20 flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-sm font-semibold">渠道上号中枢</h1>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-xs text-muted-foreground">子弹:</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0">{poolN}</Badge>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <button
            className={`w-full text-left px-4 py-2 text-sm transition-colors ${showDashboard ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
            onClick={() => { setShowDashboard(true); setLid(null); }}
          >资源调度</button>
          <div className="px-4 py-1.5"><span className="text-[10px] text-muted-foreground uppercase tracking-wider">线路</span></div>
          {lines.map(l => {
            const lCfg = l.config || {};
            const mode = lCfg.importMode || "independent";
            return (
              <button key={l.id}
                className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between ${!showDashboard && l.id === lid ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                onClick={() => { setShowDashboard(false); setLid(l.id); loadLine(l.id, lines); }}
              >
                <span className="truncate">{l.label}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  {mode === "global" && <span className="text-[9px] px-1 rounded bg-blue-500/20 text-blue-600">{lCfg.globalGroup || "组"}</span>}
                  {l.activeCount > 0 && <Badge variant="secondary" className="text-[10px] px-1 py-0">{l.activeCount}</Badge>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="p-2 border-t border-border">
          <button className="w-full text-sm text-muted-foreground hover:text-primary py-1.5 rounded hover:bg-muted/40 transition-colors" onClick={addLine}>+ 添加线路</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[900px] space-y-4">

      {/* Key Pool */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>密钥池</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`w-1.5 h-1.5 rounded-full ${paused ? "bg-yellow-500" : "bg-green-500"}`} />{paused ? "已暂停" : "10s刷新"}</div>
              <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setPaused(!paused)}>{paused ? "恢复" : "暂停"}</Button>
              <Badge variant="secondary" className="text-base px-3 py-0.5">{poolN}</Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea placeholder={"sk-ant-api03-xxxx\n每行一个密钥"} value={newKeys} onChange={e => setNewKeys(e.target.value)} className="font-mono text-xs resize-none" style={{ height: "100px" }} />
          <div className="flex gap-2 items-center">
            <Button size="sm" onClick={addKeys} disabled={pendingKeyCount === 0}>追加{pendingKeyCount > 0 && ` (${pendingKeyCount})`}</Button>
            <Button size="sm" variant="destructive" onClick={clearPool}>清空</Button>
            {pendingKeyCount > 0 && <span className="text-xs text-muted-foreground">加入后共 {poolN + pendingKeyCount}</span>}
            <Button size="sm" variant="ghost" onClick={() => setShowPool(!showPool)} className="ml-auto text-xs text-muted-foreground">{showPool ? "收起" : "查看密钥"}</Button>
          </div>
          {showPool && (
            <div className="bg-muted/30 rounded p-2 max-h-[120px] overflow-y-auto font-mono text-[11px] text-muted-foreground">
              {poolKeys.length === 0 ? <span className="text-muted-foreground/50">空</span> : poolKeys.map((k, i) => <div key={i}>{i + 1}. {k}</div>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Dashboard === */}
      {showDashboard && (
        <div className="space-y-4">
          {/* Grouped pools - each group is a card */}
          {Array.from(groupedLines.entries()).map(([group, gLines]) => {
            const groupBatch = parseInt(gLines[0]?.config?.globalGroupBatch) || 10;
            const groupAutoOn = gLines.some(l => l.autoEnabled);
            const gImpCount = groupImpCount[group] ?? groupBatch;
            return (
              <Card key={group}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 text-xs font-semibold">{group}</span>
                      <Badge variant="secondary" className="text-[10px]">{gLines.length} 线路</Badge>
                      <span className="text-xs text-muted-foreground">今日 {gLines.reduce((s, l) => s + l.todayKeys, 0)} · 总计 {gLines.reduce((s, l) => s + l.totalKeys, 0)}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Switch checked={groupAutoOn} onCheckedChange={v => saveGroupAuto(group, v, groupBatch)} />
                      <span className="text-xs text-muted-foreground">自动</span>
                      <Label className="text-xs">每批</Label>
                      <Input type="number" className="w-14 h-6 text-xs" value={groupBatch}
                        onChange={e => { const v = parseInt(e.target.value) || 1; for (const l of gLines) fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...l.config, globalGroupBatch: String(v) }, autoBatchSize: v }) }); fLines(); }} />
                      <Input type="number" className="w-14 h-6 text-xs" value={gImpCount}
                        onChange={e => setGroupImpCount(p => ({ ...p, [group]: parseInt(e.target.value) || 1 }))} />
                      <Button size="sm" className="h-6 text-xs px-2" disabled={gdBusy || poolN === 0}
                        onClick={() => doGroupImport(group, gImpCount)}>
                        {gdBusy ? "..." : "上弹"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {gLines.map(l => {
                    const lCfg = l.config || {};
                    const ratio = parseInt(lCfg.globalRatio) || 100;
                    const expanded = expandedLine === l.id;
                    const r = gdResults.find(x => x.lineId === l.id);
                    return (
                      <div key={l.id} className={`border rounded-md transition-all ${expanded ? "bg-muted/20" : "hover:bg-muted/10"}`}>
                        <div className="flex items-center gap-3 px-3 py-2 cursor-pointer" onClick={() => setExpandedLine(expanded ? null : l.id)}>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm">{l.label}</span>
                            {lCfg.channelName && <span className="text-xs text-muted-foreground ml-1.5">{lCfg.channelName}</span>}
                            {r && <span className={`text-xs ml-1.5 ${r.success ? "text-green-500" : "text-red-500"}`}>{r.success ? `✓${r.keyCount}` : r.error}</span>}
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{ratio}%</span>
                          <Badge variant={l.activeCount > 0 ? "default" : "secondary"} className="text-[10px]">{l.activeCount}活跃</Badge>
                          <div className="flex gap-0.5">{(l.last5 || []).map((rec, i) => {
                            let color = "bg-green-500"; if (rec.frozen) color = "bg-muted-foreground/30"; else if (rec.allDisabledSince) color = "bg-yellow-500";
                            return <span key={i} title={`${rec.name}: ${rec.keyCount}个`} className={`inline-block w-4 h-4 rounded text-[8px] text-white flex items-center justify-center ${color}`}>{rec.keyCount}</span>;
                          })}</div>
                          <span className="text-[10px] tabular-nums text-muted-foreground w-16 text-right">今{l.todayKeys}/总{l.totalKeys}</span>
                        </div>
                        {expanded && (
                          <div className="px-3 pb-3 pt-1 border-t space-y-2">
                            <div className="flex gap-3 flex-wrap items-end">
                              <div><Label className="text-[10px]">比例(%)</Label><Input type="number" min={0} max={100} className="w-16 h-7 text-xs" value={ratio} onChange={e => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, globalRatio: String(Math.min(100, Math.max(0, parseInt(e.target.value) || 0))) } }) }); fLines(); }} /></div>
                              <div><Label className="text-[10px]">渠道名</Label><Input className="w-40 h-7 text-xs" value={lCfg.channelName || ""} onChange={e => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, channelName: e.target.value } }) }); fLines(); }} /></div>
                              <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={lCfg.fixedName === "1"} onChange={e => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, fixedName: e.target.checked ? "1" : "0" } }) }); fLines(); }} className="w-3 h-3" /><span className="text-[10px] text-muted-foreground">固定名称</span></label>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowDashboard(false); setLid(l.id); loadLine(l.id, lines); }}>详情 →</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}

          {/* Independent pools - each line is a card */}
          {independentLines.length > 0 && <h3 className="text-sm font-medium text-muted-foreground pt-2">单独线路</h3>}
          <div className="grid grid-cols-1 gap-3">
            {independentLines.map(l => {
              const lCfg = l.config || {};
              const expanded = expandedLine === l.id;
              return (
                <Card key={l.id} className={expanded ? "ring-1 ring-primary/30" : ""}>
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpandedLine(expanded ? null : l.id)}>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{l.label}</span>
                      {lCfg.channelName && <span className="text-xs text-muted-foreground ml-1.5">{lCfg.channelName}</span>}
                      {l.autoEnabled ? <span className="text-[9px] ml-1.5 px-1 rounded bg-green-500/10 text-green-600">自动</span> : null}
                    </div>
                    <Badge variant={l.activeCount > 0 ? "default" : "secondary"} className="text-[10px]">{l.activeCount}活跃</Badge>
                    <div className="flex gap-0.5">{(l.last5 || []).map((rec, i) => {
                      let color = "bg-green-500"; if (rec.frozen) color = "bg-muted-foreground/30"; else if (rec.allDisabledSince) color = "bg-yellow-500";
                      return <span key={i} title={`${rec.name}: ${rec.keyCount}个`} className={`inline-block w-4 h-4 rounded text-[8px] text-white flex items-center justify-center ${color}`}>{rec.keyCount}</span>;
                    })}</div>
                    <span className="text-[10px] tabular-nums text-muted-foreground">今{l.todayKeys}/总{l.totalKeys}</span>
                  </div>
                  {expanded && (
                    <div className="px-4 pb-3 pt-1 border-t space-y-3">
                      <div className="flex gap-3 flex-wrap items-end">
                        <div><Label className="text-[10px]">每批数量</Label><Input type="number" className="w-16 h-7 text-xs" value={l.autoBatchSize || 10} onChange={e => { const v = parseInt(e.target.value) || 10; fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoBatchSize: v }) }); fLines(); }} /></div>
                        <div><Label className="text-[10px]">立即上弹</Label>
                          <div className="flex gap-1"><Input type="number" className="w-16 h-7 text-xs" id={`qi-${l.id}`} defaultValue={l.autoBatchSize || 10} /><Button size="sm" className="h-7 text-xs px-2" disabled={gdBusy || poolN === 0} onClick={() => { const v = parseInt((document.getElementById(`qi-${l.id}`) as HTMLInputElement)?.value) || 10; doQuickImport(l.id, v); }}>上弹</Button></div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={!!l.autoEnabled} onCheckedChange={v => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: v }) }); fLines(); }} />
                          <span className="text-[10px] text-muted-foreground">自动上弹</span>
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowDashboard(false); setLid(l.id); loadLine(l.id, lines); }}>详情 →</Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Group management */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">分组管理</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {lines.map(l => {
                  const lCfg = l.config || {};
                  const mode = lCfg.importMode || "independent";
                  return (
                    <div key={l.id} className="flex items-center gap-2 py-1">
                      <span className="text-sm flex-1 truncate">{l.label}</span>
                      <Select value={mode} onValueChange={v => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, importMode: v } }) }); fLines(); }}>
                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="independent">单独</SelectItem><SelectItem value="global">分组</SelectItem></SelectContent>
                      </Select>
                      {mode === "global" ? (
                        <Select value={lCfg.globalGroup || ""} onValueChange={v => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, globalGroup: v } }) }); fLines(); }}>
                          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="选择分组" /></SelectTrigger>
                          <SelectContent>
                            {allGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                            <SelectItem value="__new__">+ 新分组</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : <div className="w-32" />}
                      {mode === "global" && lCfg.globalGroup === "__new__" && (
                        <Input className="h-7 w-28 text-xs" placeholder="分组名" onBlur={e => { if (e.target.value.trim()) { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, globalGroup: e.target.value.trim() } }) }); fLines(); } }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === Line Detail === */}
      {!showDashboard && lid && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{lines.find(l => l.id === lid)?.label}</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { const l = lines.find(x => x.id === lid); if (l) renLine(l.id, l.label); }}>重命名</Button>
              {lines.length > 1 && <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={() => delLine(lid)}>删除</Button>}
            </div>
          </div>

          {/* Monitor */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm flex items-center gap-2">消费监控 <Badge variant="secondary">{recTotal}</Badge></CardTitle>
                <Button size="sm" variant="ghost" className="text-xs h-7 ml-auto" onClick={doRefresh}>刷新</Button>
                <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={clrRecs}>清空</Button>
              </div>
            </CardHeader>
            <CardContent>
              {recs.length === 0 ? <p className="text-center text-muted-foreground text-sm py-6">暂无记录</p> : (<>
                <Table><TableHeader><TableRow><TableHead>渠道名称</TableHead><TableHead>密钥数</TableHead><TableHead>状态</TableHead><TableHead>总消耗</TableHead><TableHead>刷新</TableHead><TableHead className="w-8" /></TableRow></TableHeader>
                <TableBody>{recs.map(r => {
                  let st = "活跃", sc = "text-green-500";
                  if (r.frozen) { st = "冻结"; sc = "text-muted-foreground"; }
                  else if (r.allDisabledSince) { st = `禁用(${Math.max(0, FREEZE_AFTER - (now - r.allDisabledSince))}s)`; sc = "text-yellow-500"; }
                  return (<TableRow key={r.id}><TableCell className="font-medium">{r.name}</TableCell><TableCell className="font-mono text-xs">{r.keyCount}</TableCell><TableCell className={`text-xs ${sc}`}>{st}</TableCell><TableCell className="font-mono font-semibold text-xs">{fmtQ(r.cachedQuota)}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{fmtT(r.lastRefresh)}</TableCell><TableCell><button className="text-muted-foreground hover:text-destructive text-xs" onClick={() => delRec(r.id)}>&#10005;</button></TableCell></TableRow>);
                })}</TableBody></Table>
                <div className="flex justify-end pt-2 text-sm font-semibold"><span className="text-muted-foreground mr-2">{recTotal} 组 · {recKeys} 密钥 ·</span><span className="font-mono">{fmtQ(recQuota)}</span></div>
                {totalPg > 1 && <div className="flex items-center justify-center gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pg <= 1} onClick={() => { setPg(pg - 1); fRecs(lid, pg - 1); }}>上一页</Button>
                  <span className="text-xs text-muted-foreground tabular-nums">{pg}/{totalPg}</span>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pg >= totalPg} onClick={() => { setPg(pg + 1); fRecs(lid, pg + 1); }}>下一页</Button>
                </div>}
              </>)}
            </CardContent>
          </Card>

          {/* Connection Config */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">连接配置</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-[2]"><Label className="text-xs">API 地址</Label><Input value={cfg.baseUrl || ""} onChange={e => upd("baseUrl", e.target.value)} /></div>
                <div className="w-[140px]"><Label className="text-xs">平台类型</Label>
                  <Select value={cfg.platformType || "newapi"} onValueChange={v => v && upd("platformType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newapi">New API</SelectItem><SelectItem value="naci">Naci Hub</SelectItem><SelectItem value="sub2api">Sub2API</SelectItem></SelectContent></Select>
                </div>
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
                <div className="flex-1"><Label className="text-xs">渠道名称</Label><Input value={cfg.channelName || ""} onChange={e => upd("channelName", e.target.value)} />
                  <div className="flex items-center gap-2 mt-1">
                    {cfg.fixedName === "1" ? <p className="text-xs text-muted-foreground">固定</p> : cfg.channelName && <p className="text-xs text-primary">下次 → {incName(cfg.channelName)}</p>}
                    <label className="flex items-center gap-1 ml-auto cursor-pointer"><input type="checkbox" checked={cfg.fixedName === "1"} onChange={e => upd("fixedName", e.target.checked ? "1" : "0")} className="w-3.5 h-3.5 rounded" /><span className="text-xs text-muted-foreground">固定名称</span></label>
                  </div>
                </div>
                <div className="w-[140px]"><Label className="text-xs">投递方式</Label>
                  <Select value={cfg.importMode || "independent"} onValueChange={v => v && upd("importMode", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="independent">单独</SelectItem><SelectItem value="global">分组</SelectItem></SelectContent></Select>
                </div>
                <div className="w-[160px]"><Label className="text-xs">渠道类型</Label>
                  <Select value={cfg.channelType || "14"} onValueChange={v => v && upd("channelType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">OpenAI</SelectItem><SelectItem value="14">Anthropic</SelectItem><SelectItem value="3">Azure</SelectItem><SelectItem value="24">其他</SelectItem></SelectContent></Select>
                </div>
              </div>
              {!isIndependent && (
                <div className="flex items-center gap-3 rounded-md bg-blue-500/5 border border-blue-500/20 px-3 py-2 flex-wrap">
                  <span className="text-xs text-blue-600">分组</span>
                  <Input className="w-28 h-7 text-xs" value={cfg.globalGroup || ""} onChange={e => upd("globalGroup", e.target.value)} placeholder="分组名" />
                  <span className="text-xs text-blue-600 ml-2">比例</span>
                  <Input type="number" min={0} max={100} className="w-20 h-7 text-xs" value={cfg.globalRatio || "100"} onChange={e => upd("globalRatio", e.target.value)} />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              )}
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
                {cfg.platformType === "naci" && <>
                  <div className="flex gap-3"><div className="flex-1"><Label className="text-xs">Site IDs</Label><Input value={cfg.naciSiteIds || "[21,13,6]"} onChange={e => upd("naciSiteIds", e.target.value)} /></div><div className="w-[120px]"><Label className="text-xs">Provider ID</Label><Input value={cfg.naciProviderId || "3"} onChange={e => upd("naciProviderId", e.target.value)} /></div></div>
                  <div><Label className="text-xs">Site Groups</Label><Input value={cfg.naciSiteGroups || "{}"} onChange={e => upd("naciSiteGroups", e.target.value)} /></div>
                </>}
                {cfg.platformType === "sub2api" && <>
                  <div className="flex gap-3">
                    <div className="flex-1"><Label className="text-xs">Site IDs (JSON)</Label><Input value={cfg.sub2apiSiteIds || "[]"} onChange={e => upd("sub2apiSiteIds", e.target.value)} placeholder="[30,32,33]" /></div>
                    <div className="w-[140px]"><Label className="text-xs">Key Type</Label><Input value={cfg.sub2apiKeyType || "anthropic"} onChange={e => upd("sub2apiKeyType", e.target.value)} /></div>
                  </div>
                </>}
              </div>}
            </CardContent>
          </Card>

          {/* Independent: Auto + Import */}
          {isIndependent && (<>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">自动上弹</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Switch checked={autoOn} onCheckedChange={v => saveAuto(v, autoBatch)} />
                  <span className="text-sm text-muted-foreground">批次全禁用时自动导入</span>
                  <span className={`text-xs ml-auto ${autoOn && poolN > 0 ? "text-green-500" : "text-muted-foreground"}`}>{!autoOn ? "未启用" : poolN === 0 ? "池空" : `每批${autoBatch}`}</span>
                </div>
                <div className="flex items-center gap-3 mt-3"><Label className="text-xs w-20">每批数量</Label><Input type="number" className="w-[120px]" value={autoBatch} onChange={e => saveAuto(autoOn, parseInt(e.target.value) || 10)} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">手动导入</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-[120px]"><Label className="text-xs">数量</Label><Input type="number" value={impCount} onChange={e => setImpCount(parseInt(e.target.value) || 0)} /></div>
                  <Button onClick={doLineImport} disabled={impBusy || poolN === 0} className="mt-5">{impBusy ? "导入中..." : "导入"}</Button>
                </div>
                {impResults.length > 0 && impResults.map((r, i) => (
                  <div key={i} className={`text-xs ${r.success ? "text-green-500" : "text-red-500"}`}>{r.label}: {r.success ? `成功 → ${r.name}` : `失败 — ${r.error}`}</div>
                ))}
              </CardContent>
            </Card>
          </>)}

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
      </div>
    </div>
  );
}
