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

  // Global dispatch tab
  const [showGlobal, setShowGlobal] = useState(false);
  const [gdBatch, setGdBatch] = useState(10);
  const [gdBusy, setGdBusy] = useState(false);
  const [gdResults, setGdResults] = useState<Array<{ lineId?: number; label: string; success: boolean; name?: string; error?: string; keyCount?: number }>>([]);
  const [gdAutoOn, setGdAutoOn] = useState(false);
  const [gdAutoBatch, setGdAutoBatch] = useState(10);

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

  useEffect(() => { (async () => { await fPool(); const ls = await fLines(); if (ls.length) { setShowGlobal(true); } })(); }, []);

  const cooldownRef = useRef(false);
  const doRefresh = useCallback(async () => {
    if (cooldownRef.current) return;
    const resp = await fetch("/api/refresh", { method: "POST" });
    const result = await resp.json().catch(() => ({}));
    if (result?.data?.cooldown) {
      cooldownRef.current = true;
      setTimeout(() => { cooldownRef.current = false; }, 30000);
    }
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

  const addLine = async () => { const label = prompt("线路名称:", `线路${lines.length + 1}`); if (!label?.trim()) return; const r = await fetch("/api/lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label.trim() }) }).then(r => r.json()); if (r.success) { const ls = await fLines(); setShowGlobal(false); setLid(r.data.id); loadLine(r.data.id, ls); } };
  const renLine = async (id: number, old: string) => { const l = prompt("线路名称:", old); if (!l?.trim()) return; await fetch(`/api/lines/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: l.trim() }) }); fLines(); };
  const delLine = async (id: number) => { if (!confirm("确认删除？")) return; await fetch(`/api/lines/${id}`, { method: "DELETE" }); if (lid === id) setLid(null); const ls = await fLines(); if (ls.length && lid === id) { setLid(ls[0].id); loadLine(ls[0].id, ls); } };
  const delRec = async (rid: number) => { if (!lid) return; await fetch(`/api/lines/${lid}/records?recordId=${rid}`, { method: "DELETE" }); fRecs(lid, pg); fLines(); };
  const clrRecs = async () => { if (!lid || !confirm("确认清空？")) return; await fetch(`/api/lines/${lid}/records`, { method: "DELETE" }); fRecs(lid, 1); setPg(1); fLines(); };

  const [impResults, setImpResults] = useState<Array<{ label: string; success: boolean; name?: string; error?: string }>>([]);

  // Single-line import (for independent lines)
  const doLineImport = async () => {
    if (!lid) return;
    setImpBusy(true); setImpResults([]);
    const r = await fetch(`/api/lines/${lid}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: impCount }) }).then(r => r.json());
    setImpBusy(false);
    if (r.success) setImpResults([{ label: lines.find(l => l.id === lid)?.label || "", success: true, name: r.data?.name }]);
    else setImpResults([{ label: lines.find(l => l.id === lid)?.label || "", success: false, error: r.error }]);
    fPool(); fLines();
    if (lid) { fRecs(lid, pg); fLogs(lid); }
    if (r.success) {
      const ls = await fLines();
      const l = ls.find((x: Line) => x.id === lid);
      if (l) setCfg(l.config);
    }
  };

  // Global import
  const doGlobalImport = async () => {
    setGdBusy(true); setGdResults([]);
    const globalLines = lines.filter(l => (l.config?.importMode || "independent") === "global");
    const lineRatios: Record<string, number> = {};
    for (const l of globalLines) {
      lineRatios[String(l.id)] = parseInt(l.config?.globalRatio) || 100;
    }
    const r = await fetch("/api/import-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: gdBatch, mode: "global", lineRatios }) }).then(r => r.json());
    setGdBusy(false);
    if (r.success) setGdResults(r.data.results);
    fPool(); fLines();
  };

  const saveAuto = async (on: boolean, bs: number) => { setAutoOn(on); setAutoBatch(bs); if (lid) fetch(`/api/lines/${lid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: on, autoBatchSize: bs }) }); };

  // Save global auto settings to all global lines
  const saveGlobalAuto = async (on: boolean, bs: number) => {
    setGdAutoOn(on); setGdAutoBatch(bs);
    const globalLines = lines.filter(l => (l.config?.importMode || "independent") === "global");
    for (const l of globalLines) {
      await fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: on, autoBatchSize: bs }) });
    }
    fLines();
  };

  // Sync gdAutoOn from lines
  useEffect(() => {
    const globalLines = lines.filter(l => (l.config?.importMode || "independent") === "global");
    if (globalLines.length > 0) {
      setGdAutoOn(globalLines.some(l => l.autoEnabled));
      setGdAutoBatch(globalLines[0]?.autoBatchSize || 10);
    }
  }, [lines]);

  const clrLogs = async () => { if (!lid) return; await fetch(`/api/lines/${lid}/logs`, { method: "DELETE" }); setLogs([]); };

  const totalPg = Math.ceil(recTotal / 10);
  const pendingKeyCount = countLines(newKeys);
  const globalLines = lines.filter(l => (l.config?.importMode || "independent") === "global");
  const isIndependent = (cfg.importMode || "independent") === "independent";

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
            className={`w-full text-left px-4 py-2 text-sm transition-colors ${showGlobal ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
            onClick={() => { setShowGlobal(true); setLid(null); }}
          >全局调度 <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">{globalLines.length}</Badge></button>
          <div className="px-4 py-1.5"><span className="text-[10px] text-muted-foreground uppercase tracking-wider">线路</span></div>
          {lines.map(l => {
            const lCfg = l.config || {};
            const mode = lCfg.importMode || "independent";
            return (
              <button key={l.id}
                className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between ${!showGlobal && l.id === lid ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                onClick={() => { setShowGlobal(false); setLid(l.id); loadLine(l.id, lines); }}
              >
                <span className="truncate">{l.label}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className={`text-[9px] px-1 rounded ${mode === "global" ? "bg-blue-500/20 text-blue-600" : "bg-muted text-muted-foreground"}`}>{mode === "global" ? "全局" : "单独"}</span>
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
      <div className="max-w-[800px] space-y-4">

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

      {/* Global Dispatch Panel */}
      {showGlobal && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">全局调度</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Auto reload for global */}
              <div className="flex items-center gap-3 border-b border-border pb-3">
                <Switch checked={gdAutoOn} onCheckedChange={v => saveGlobalAuto(v, gdAutoBatch)} />
                <span className="text-sm text-muted-foreground">全局自动上弹</span>
                <div className="flex items-center gap-2 ml-auto">
                  <Label className="text-xs">每批</Label>
                  <Input type="number" className="w-[80px] h-7 text-xs" value={gdAutoBatch} onChange={e => saveGlobalAuto(gdAutoOn, parseInt(e.target.value) || 10)} />
                </div>
                <span className={`text-xs ${gdAutoOn && poolN > 0 ? "text-green-500" : "text-muted-foreground"}`}>{!gdAutoOn ? "未启用" : poolN === 0 ? "池空" : "运行中"}</span>
              </div>

              {/* Manual import */}
              <div className="flex items-center gap-3">
                <div className="w-[140px]">
                  <Label className="text-xs">手动导入数量</Label>
                  <Input type="number" min={1} value={gdBatch} onChange={e => setGdBatch(parseInt(e.target.value) || 1)} />
                </div>
                <div className="mt-5">
                  <Button onClick={doGlobalImport} disabled={gdBusy || poolN === 0 || globalLines.length === 0}>
                    {gdBusy ? "导入中..." : `全局导入 (池: ${poolN})`}
                  </Button>
                </div>
              </div>

              {globalLines.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">暂无全局模式的线路，请在线路配置中将投递方式设为「全局」</p>
              ) : (() => {
                const groups = new Map<string, Line[]>();
                for (const l of globalLines) {
                  const g = l.config?.globalGroup || "默认";
                  if (!groups.has(g)) groups.set(g, []);
                  groups.get(g)!.push(l);
                }
                return Array.from(groups.entries()).map(([group, gLines]) => (
                  <div key={group} className="border rounded-md overflow-hidden">
                    <div className="bg-muted/30 px-3 py-2 text-xs font-medium flex items-center gap-2 border-b">
                      <span>{group}</span>
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">{gLines.length}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>线路</TableHead>
                          <TableHead className="w-[100px]">比例</TableHead>
                          <TableHead className="w-[80px]">数量</TableHead>
                          <TableHead className="w-[80px]">状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gLines.map(l => {
                          const lCfg = l.config || {};
                          const ratio = parseInt(lCfg.globalRatio) || 100;
                          const n = Math.round(gdBatch * ratio / 100);
                          const result = gdResults.find(r => r.lineId === l.id);
                          return (
                            <TableRow key={l.id}>
                              <TableCell>
                                <div>
                                  <span className="font-medium text-sm">{l.label}</span>
                                  {lCfg.channelName && <span className="text-xs text-muted-foreground ml-2">{lCfg.channelName}</span>}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <Input type="number" min={0} max={100} className="w-16 h-7 text-xs" value={ratio}
                                    onChange={e => {
                                      const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                      fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, globalRatio: String(v) } }) });
                                      fLines();
                                    }} />
                                  <span className="text-xs text-muted-foreground">%</span>
                                </div>
                              </TableCell>
                              <TableCell><span className="tabular-nums text-sm font-mono">{n}</span></TableCell>
                              <TableCell>
                                {result ? (
                                  <span className={`text-xs ${result.success ? "text-green-500" : "text-red-500"}`}>
                                    {result.success ? `✓ ${result.keyCount}个` : result.error}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{ratio === 0 ? "跳过" : "待导入"}</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ));
              })()}

              <p className="text-xs text-muted-foreground">
                比例 100% = 全部 key · 0% = 跳过 · 小于 100% 随机选取并四舍五入
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {!showGlobal && lid && (
        <div className="space-y-4">
          {/* Line Header */}
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
                {totalPg > 1 && <div className="flex items-center justify-center gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pg <= 1} onClick={() => { setPg(pg - 1); fRecs(lid, pg - 1); }}>上一页</Button>
                  <span className="text-xs text-muted-foreground tabular-nums">{pg} / {totalPg}</span>
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
                  <Select value={cfg.platformType || "newapi"} onValueChange={v => v && upd("platformType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newapi">New API</SelectItem><SelectItem value="naci">Naci Hub</SelectItem></SelectContent></Select>
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
                    {cfg.fixedName === "1"
                      ? <p className="text-xs text-muted-foreground">名称固定，不递增</p>
                      : cfg.channelName && <p className="text-xs text-primary">下次 → {incName(cfg.channelName)}</p>}
                    <label className="flex items-center gap-1 ml-auto cursor-pointer">
                      <input type="checkbox" checked={cfg.fixedName === "1"} onChange={e => upd("fixedName", e.target.checked ? "1" : "0")} className="w-3.5 h-3.5 rounded" />
                      <span className="text-xs text-muted-foreground">固定名称</span>
                    </label>
                  </div>
                </div>
                <div className="w-[140px]"><Label className="text-xs">投递方式</Label>
                  <Select value={cfg.importMode || "independent"} onValueChange={v => v && upd("importMode", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="independent">单独</SelectItem><SelectItem value="global">全局</SelectItem></SelectContent></Select>
                  {!isIndependent && <p className="text-xs text-blue-500 mt-1">由全局调度管理</p>}
                </div>
                <div className="w-[160px]"><Label className="text-xs">渠道类型</Label>
                  <Select value={cfg.channelType || "14"} onValueChange={v => v && upd("channelType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">OpenAI</SelectItem><SelectItem value="14">Anthropic</SelectItem><SelectItem value="3">Azure</SelectItem><SelectItem value="24">其他</SelectItem></SelectContent></Select>
                </div>
              </div>
              {!isIndependent && (
                <div className="flex items-center gap-3 rounded-md bg-blue-500/5 border border-blue-500/20 px-3 py-2 flex-wrap">
                  <span className="text-xs text-blue-600">分组</span>
                  <Input className="w-28 h-7 text-xs" value={cfg.globalGroup || "默认"} onChange={e => upd("globalGroup", e.target.value)} placeholder="默认" />
                  <span className="text-xs text-blue-600 ml-2">比例</span>
                  <Input type="number" min={0} max={100} className="w-20 h-7 text-xs" value={cfg.globalRatio || "100"} onChange={e => upd("globalRatio", e.target.value)} />
                  <span className="text-xs text-muted-foreground">%  · 每批 {gdBatch} 个中取 {Math.round(gdBatch * (parseInt(cfg.globalRatio) || 100) / 100)} 个</span>
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
                  <div className="flex gap-3">
                    <div className="flex-1"><Label className="text-xs">Site IDs (JSON)</Label><Input value={cfg.naciSiteIds || "[21,13,6]"} onChange={e => upd("naciSiteIds", e.target.value)} placeholder="[21,13,6]" /></div>
                    <div className="w-[120px]"><Label className="text-xs">Provider ID</Label><Input value={cfg.naciProviderId || "3"} onChange={e => upd("naciProviderId", e.target.value)} /></div>
                  </div>
                  <div><Label className="text-xs">Site Group Overrides (JSON)</Label><Input value={cfg.naciSiteGroups || "{}"} onChange={e => upd("naciSiteGroups", e.target.value)} placeholder='{"6":["anthropic","default"],"13":["anthropic"]}' /></div>
                </>}
              </div>}
            </CardContent>
          </Card>

          {/* Independent: Auto Reload + Import */}
          {isIndependent && (<>
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

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">手动导入</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-[120px]"><Label className="text-xs">数量</Label><Input type="number" value={impCount} onChange={e => setImpCount(parseInt(e.target.value) || 0)} /></div>
                  <Button onClick={doLineImport} disabled={impBusy || poolN === 0} className="mt-5">{impBusy ? "导入中..." : "导入"}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{poolN === 0 ? "密钥池为空" : impCount > poolN ? `池中仅${poolN}个，将全部取用` : `取前${impCount}个，剩余${poolN - impCount}个`}</p>
                {impResults.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {impResults.map((r, i) => (
                      <div key={i} className={`text-xs ${r.success ? "text-green-500" : "text-red-500"}`}>
                        {r.label}: {r.success ? `成功 → ${r.name}` : `失败 — ${r.error}`}
                      </div>
                    ))}
                  </div>
                )}
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
