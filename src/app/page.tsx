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

type Rec = { id: number; lineId: number; name: string; keyCount: number; cachedQuota: number; allDisabledSince: number | null; frozen: number; disabledCount: number; lastRefresh: number | null; importedAt: number };
type Line = { id: number; label: string; config: Record<string, string>; autoEnabled: number; autoBatchSize: number; activeCount: number; recordCount: number; last5: Rec[]; totalKeys: number; todayKeys: number; totalQuota: number };
type LogEntry = { id: number; message: string; level: string; createdAt: number };
type Group = { id: number; name: string; sharedKeyBatchSize: number; lines: { id: number; label: string; totalQuota: number }[] };

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

  // Fixed slots
  type SlotInfo = { id: number; name: string; status: number; statusText: string; usedQuota: number; keyPreview: string };
  const [slotData, setSlotData] = useState<{ slots: SlotInfo[]; summary: { total: number; active: number; disabled: number; totalQuota: number } } | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const fSlots = useCallback(async (id: number) => {
    setSlotLoading(true);
    try { const r = await fetch(`/api/lines/${id}/slot-status`).then(r => r.json()); if (r.success) setSlotData(r.data); } catch {}
    setSlotLoading(false);
  }, []);

  // Dashboard
  const [showDashboard, setShowDashboard] = useState(true);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [gdBusy, setGdBusy] = useState(false);
  const [gdResults, setGdResults] = useState<Array<{ lineId?: number; label: string; success: boolean; error?: string; keyCount?: number }>>([]);
  const [groupImpCount, setGroupImpCount] = useState<Record<string, number>>({});
  const [lineRpm, setLineRpm] = useState<Record<number, { rpm: number; tpm: number; quota: number }>>({});
  const [groupList, setGroupList] = useState<Group[]>([]);

  const lidRef = useRef(lid);
  const pgRef = useRef(pg);
  lidRef.current = lid;
  pgRef.current = pg;

  const fPool = useCallback(async () => { const r = await fetch("/api/keys").then(r => r.json()); if (r.success) { setPoolN(r.data.total); setPoolKeys(r.data.keys); } }, []);
  const fLines = useCallback(async () => { const r = await fetch("/api/lines").then(r => r.json()); if (r.success) setLines(r.data); return r.data as Line[]; }, []);
  const fGroups = useCallback(async () => { const r = await fetch("/api/groups").then(r => r.json()); if (r.success) setGroupList(r.data); }, []);
  const fRecs = useCallback(async (id: number, p = 1) => { const r = await fetch(`/api/lines/${id}/records?page=${p}&pageSize=10`).then(r => r.json()); if (r.success) { setRecs(r.data.items); setRecTotal(r.data.total); setRecQuota(r.data.totalQuota); setRecKeys(r.data.totalKeys); } }, []);
  const fLogs = useCallback(async (id: number) => { const r = await fetch(`/api/lines/${id}/logs`).then(r => r.json()); if (r.success) setLogs(r.data); }, []);

  const loadLine = useCallback(async (id: number, lns: Line[]) => {
    const l = lns.find(x => x.id === id);
    if (l) { setCfg(l.config); setAutoOn(!!l.autoEnabled); setAutoBatch(l.autoBatchSize); }
    await fRecs(id, 1); setPg(1); await fLogs(id);
    if (l?.config?.importStrategy === "fixed_slots") fSlots(id);
  }, [fRecs, fLogs, fSlots]);

  useEffect(() => { (async () => { await fPool(); await fLines(); await fGroups(); })(); }, []);

  const cooldownRef = useRef(false);
  const doRefresh = useCallback(async () => {
    if (cooldownRef.current) return;
    const resp = await fetch("/api/refresh", { method: "POST" });
    const result = await resp.json().catch(() => ({}));
    if (result?.data?.cooldown) { cooldownRef.current = true; setTimeout(() => { cooldownRef.current = false; }, 30000); }
    const ls = await fLines();
    await fPool();
    await fGroups();
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

  // RPM polling
  useEffect(() => {
    if (!showDashboard || lines.length === 0) return;
    const fetchRpm = async () => {
      for (const l of lines) {
        try {
          const r = await fetch(`/api/lines/${l.id}/rpm`);
          if (r.ok) { const d = await r.json(); setLineRpm(prev => ({ ...prev, [l.id]: d })); }
        } catch { /* ignore */ }
      }
    };
    fetchRpm();
    const t = setInterval(fetchRpm, 30000);
    return () => clearInterval(t);
  }, [showDashboard, lines.length]);

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
          {/* Group Management */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">分组管理</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
              const name = prompt("分组名称:");
              if (!name?.trim()) return;
              await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
              fGroups(); fLines();
            }}>+ 新建分组</Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {groupList.map(g => {
              const memberIds = new Set(g.lines.map(gl => gl.id));
              const groupLinesData = lines.filter(l => memberIds.has(l.id));
              const groupTotalQuota = groupLinesData.reduce((s, l) => s + (l.totalQuota || 0), 0);
              const availableLines = lines.filter(l => !memberIds.has(l.id) && (l.config?.importMode || "independent") !== "global" && l.config?.hidden !== "1");

              return (
                <Card key={g.id}>
                  <CardContent className="pt-3 pb-3 space-y-2">
                    {/* Header */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600">{g.name}</span>
                      <span className="text-xs font-mono font-semibold ml-auto">{fmtQ(groupTotalQuota)}</span>
                      <button className="text-[10px] text-muted-foreground/50 hover:text-destructive" onClick={async () => {
                        if (!confirm(`确认删除分组「${g.name}」？`)) return;
                        await fetch("/api/groups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id }) });
                        fGroups(); fLines();
                      }}>×</button>
                    </div>

                    {/* Shared key batch size */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">每批共享key</span>
                      <input className="w-14 h-5 text-[10px] border rounded px-1 text-center" defaultValue={g.sharedKeyBatchSize}
                        onBlur={e => { const v = parseInt(e.target.value) || 10; fetch("/api/groups", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id, sharedKeyBatchSize: v }) }); fGroups(); }} />
                      <div className="flex gap-1 ml-auto">
                        <Button size="sm" className="h-5 text-[9px] px-2" disabled={gdBusy || poolN === 0} onClick={() => doGroupImport(g.name, g.sharedKeyBatchSize)}>上弹</Button>
                      </div>
                    </div>

                    {/* Member lines */}
                    <div className="space-y-1">
                      {groupLinesData.length === 0 && <p className="text-[10px] text-muted-foreground/50 py-1">暂无线路，请添加</p>}
                      {groupLinesData.map(l => (
                        <div key={l.id} className="flex items-center gap-1.5 text-[11px] group">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${l.activeCount > 0 ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                          <span className="truncate flex-1">{l.label}</span>
                          <span className="tabular-nums text-muted-foreground">{l.activeCount}</span>
                          <span className="tabular-nums font-mono">{fmtQ(l.totalQuota || 0)}</span>
                          <button className="text-[9px] text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100" onClick={async () => {
                            await fetch("/api/groups/toggle-line", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: g.id, lineId: l.id, checked: false }) });
                            fGroups(); fLines();
                          }}>移出</button>
                        </div>
                      ))}
                    </div>

                    {/* Add line selector */}
                    {availableLines.length > 0 && (
                      <Select value="" onValueChange={async v => {
                        if (!v) return;
                        await fetch("/api/groups/toggle-line", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: g.id, lineId: parseInt(v), checked: true }) });
                        fGroups(); fLines();
                      }}>
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="+ 添加线路..." /></SelectTrigger>
                        <SelectContent>
                          {availableLines.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* === Original Line Cards === */}
          {lines.filter(l => l.config?.hidden === "1").length > 0 && (
            <div className="flex justify-end">
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? "隐藏已隐藏" : `显示已隐藏 (${lines.filter(l => l.config?.hidden === "1").length})`}
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[...lines].sort((a, b) => (a.config?.pinned === "1" ? 0 : 1) - (b.config?.pinned === "1" ? 0 : 1)).filter(l => showHidden || l.config?.hidden !== "1").map(l => {
              const lCfg = l.config || {};
              const mode = lCfg.importMode || "independent";
              const isGlobal = mode === "global";
              const isHidden = lCfg.hidden === "1";
              const isPinned = lCfg.pinned === "1";
              const rpm = lineRpm[l.id];
              const groupBatch = parseInt(lCfg.globalGroupBatch) || 10;

              return (
                <Card key={l.id} className={`${isPinned ? "ring-1 ring-amber-400/40" : ""} ${isHidden ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm">{l.label}</span>
                        {isGlobal && <span className="text-[9px] px-1 rounded bg-blue-500/20 text-blue-600">{lCfg.globalGroup}</span>}
                        {l.autoEnabled ? <span className="text-[9px] px-1 rounded bg-green-500/10 text-green-600">自动</span> : null}
                      </div>
                      {lCfg.channelName && <p className="text-[11px] text-muted-foreground truncate">{lCfg.channelName}</p>}
                    </div>
                    {rpm && rpm.rpm > 0 && <span className="text-[11px] font-mono tabular-nums text-amber-600">{rpm.rpm}rpm</span>}
                    <Badge variant={l.activeCount > 0 ? "default" : "secondary"} className="text-[9px]">{l.activeCount}</Badge>
                    <div className="text-right text-[10px] tabular-nums text-muted-foreground leading-tight">
                      <div>今{l.todayKeys} / 总{l.totalKeys}</div>
                      <div className="font-mono font-semibold text-foreground">{fmtQ(l.totalQuota || 0)}</div>
                    </div>
                    <div className="flex gap-0.5">
                      <button onClick={e => { e.stopPropagation(); fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, pinned: isPinned ? "0" : "1" } }) }); fLines(); }} className={`text-[10px] px-1 rounded ${isPinned ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-400"}`} title="置顶">★</button>
                      <button onClick={e => { e.stopPropagation(); fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, hidden: isHidden ? "0" : "1" } }) }); fLines(); }} className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground" title={isHidden ? "显示" : "隐藏"}>{isHidden ? "👁" : "×"}</button>
                    </div>
                  </div>

                  <div className="px-3 pb-3 border-t space-y-2 pt-2">
                      {rpm && (
                        <div className="flex gap-4 text-xs">
                          <span>RPM: <strong className="tabular-nums text-amber-600">{rpm.rpm}</strong></span>
                          <span>TPM: <strong className="tabular-nums">{(rpm.tpm / 1000).toFixed(0)}k</strong></span>
                          <span>额度: <strong className="tabular-nums">{fmtQ(rpm.quota)}</strong></span>
                        </div>
                      )}

                      {(l.last5 || []).length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">最近5批</p>
                          <div className="space-y-0.5">
                            {(l.last5 || []).map((rec, i) => {
                              let st = "活跃", sc = "text-green-500";
                              if (rec.frozen) { st = "冻结"; sc = "text-muted-foreground"; }
                              else if (rec.allDisabledSince) { st = "禁用中"; sc = "text-yellow-500"; }
                              else if (rec.disabledCount > 0) { st = `${rec.disabledCount}/${rec.keyCount}死`; sc = "text-orange-500"; }
                              return (
                                <div key={i} className="flex items-center gap-2 text-[11px]">
                                  <span className={`w-1.5 h-1.5 rounded-full ${rec.frozen ? "bg-muted-foreground/30" : rec.allDisabledSince ? "bg-yellow-500" : rec.disabledCount > 0 ? "bg-orange-500" : "bg-green-500"}`} />
                                  <span className="font-mono truncate flex-1">{rec.name}</span>
                                  <span className="tabular-nums">{rec.keyCount}个</span>
                                  <span className="tabular-nums font-mono">{fmtQ(rec.cachedQuota)}</span>
                                  <span className={`${sc}`}>{st}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 border-t pt-2">
                        <span className="text-[10px] text-muted-foreground">投递:</span>
                        {["default", "overlap", "rotate", "fixed_slots"].map(s => (
                          <button key={s} className={`text-[10px] px-1.5 py-0.5 rounded ${(lCfg.importStrategy || "default") === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                            onClick={() => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, importStrategy: s } }) }); fLines(); }}>
                            {s === "default" ? "默认" : s === "overlap" ? "重叠" : s === "rotate" ? "换key" : "固定槽位"}
                          </button>
                        ))}
                        {(lCfg.importStrategy || "default") === "overlap" && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">×</span>
                            <input className="w-8 h-5 text-[10px] border rounded px-1 text-center" id={`om-${l.id}`} defaultValue={parseInt(lCfg.overlapMultiplier) || 2} />
                            <Button size="sm" variant="outline" className="h-5 text-[9px] px-1" onClick={() => {
                              const v = parseInt((document.getElementById(`om-${l.id}`) as HTMLInputElement)?.value) || 2;
                              fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, overlapMultiplier: String(v) } }) }); fLines();
                            }}>存</Button>
                          </div>
                        )}
                        {lCfg.importStrategy === "fixed_slots" && (
                          <div className="flex items-center gap-1">
                            <input className="w-8 h-5 text-[10px] border rounded px-1 text-center" id={`fs-${l.id}`} defaultValue={parseInt(lCfg.fixedSlotCount) || 10} />
                            <span className="text-[10px] text-muted-foreground">槽</span>
                            <Button size="sm" variant="outline" className="h-5 text-[9px] px-1" onClick={async () => {
                              const n = parseInt((document.getElementById(`fs-${l.id}`) as HTMLInputElement)?.value) || 10;
                              const r = await fetch(`/api/lines/${l.id}/init-slots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: n }) });
                              const d = await r.json();
                              alert(d.success ? `已创建 ${d.data?.created} 个槽位` : d.error);
                              fLines();
                            }}>初始化</Button>
                            {lCfg.fixedSlotIds && <span className="text-[9px] text-green-600">{JSON.parse(lCfg.fixedSlotIds || "[]").length}个</span>}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">触发:</span>
                        {(["dead_ratio", "quota_total", "quota_avg"] as const).map(m => (
                          <button key={m} className={`text-[10px] px-1.5 py-0.5 rounded ${(lCfg.triggerMode || "dead_ratio") === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                            onClick={() => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, triggerMode: m } }) }); fLines(); }}>
                            {m === "dead_ratio" ? "死亡比例" : m === "quota_total" ? "总额度" : "平均额度"}
                          </button>
                        ))}
                        {(lCfg.triggerMode || "dead_ratio") === "dead_ratio" && (
                          <div className="flex items-center gap-1">
                            <input className="w-10 h-5 text-[10px] border rounded px-1 text-center" id={`tdr-${l.id}`} defaultValue={Math.round((parseFloat(lCfg.triggerDeadRatio) || 0.67) * 100)} />
                            <span className="text-[10px] text-muted-foreground">%</span>
                            <Button size="sm" variant="outline" className="h-5 text-[9px] px-1" onClick={() => {
                              const v = Math.min(100, Math.max(1, parseInt((document.getElementById(`tdr-${l.id}`) as HTMLInputElement)?.value) || 67));
                              fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, triggerDeadRatio: String(v / 100) } }) }); fLines();
                            }}>存</Button>
                          </div>
                        )}
                        {(lCfg.triggerMode || "dead_ratio") === "quota_total" && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">≥$</span>
                            <input className="w-14 h-5 text-[10px] border rounded px-1 text-center" id={`tqt-${l.id}`} defaultValue={((parseInt(lCfg.triggerQuotaTotal) || 0) / 500000).toFixed(0)} />
                            <Button size="sm" variant="outline" className="h-5 text-[9px] px-1" onClick={() => {
                              const v = parseFloat((document.getElementById(`tqt-${l.id}`) as HTMLInputElement)?.value) || 0;
                              fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, triggerQuotaTotal: String(Math.round(v * 500000)) } }) }); fLines();
                            }}>存</Button>
                          </div>
                        )}
                        {(lCfg.triggerMode || "dead_ratio") === "quota_avg" && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">≥$</span>
                            <input className="w-14 h-5 text-[10px] border rounded px-1 text-center" id={`tqa-${l.id}`} defaultValue={((parseInt(lCfg.triggerQuotaAvg) || 0) / 500000).toFixed(0)} />
                            <span className="text-[10px] text-muted-foreground">/key</span>
                            <Button size="sm" variant="outline" className="h-5 text-[9px] px-1" onClick={() => {
                              const v = parseFloat((document.getElementById(`tqa-${l.id}`) as HTMLInputElement)?.value) || 0;
                              fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...lCfg, triggerQuotaAvg: String(Math.round(v * 500000)) } }) }); fLines();
                            }}>存</Button>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 flex-wrap items-end">
                        {isGlobal ? (
                          <>
                            <div className="flex items-center gap-1">
                              <Label className="text-[10px]">每批</Label>
                              <input className="w-12 h-6 text-xs border rounded px-1 text-center" id={`gb-${l.id}`} defaultValue={groupBatch} />
                              <Label className="text-[10px]">比例</Label>
                              <input className="w-10 h-6 text-xs border rounded px-1 text-center" id={`gr-${l.id}`} defaultValue={parseInt(lCfg.globalRatio) || 100} />
                              <span className="text-[10px] text-muted-foreground">%</span>
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => {
                                const batch = parseInt((document.getElementById(`gb-${l.id}`) as HTMLInputElement)?.value) || 10;
                                const ratio = Math.min(100, Math.max(0, parseInt((document.getElementById(`gr-${l.id}`) as HTMLInputElement)?.value) || 100));
                                const gLines2 = lines.filter(x => x.config?.globalGroup === lCfg.globalGroup && x.config?.importMode === "global");
                                for (const x of gLines2) fetch(`/api/lines/${x.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...x.config, globalGroupBatch: String(batch), globalRatio: String(ratio) }, autoBatchSize: batch }) });
                                fLines();
                              }}>保存</Button>
                            </div>
                            <Switch checked={!!l.autoEnabled} onCheckedChange={v => saveGroupAuto(lCfg.globalGroup || "", v, groupBatch)} />
                            <span className="text-[10px] text-muted-foreground">自动</span>
                            <div className="flex gap-1 ml-auto">
                              <input className="w-12 h-6 text-xs border rounded px-1 text-center" id={`gq-${l.id}`} defaultValue={groupBatch} />
                              <Button size="sm" className="h-6 text-[10px] px-2" disabled={gdBusy || poolN === 0} onClick={() => { const v = parseInt((document.getElementById(`gq-${l.id}`) as HTMLInputElement)?.value) || 10; doGroupImport(lCfg.globalGroup || "", v); }}>上弹</Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <Label className="text-[10px]">每批</Label>
                              <input className="w-12 h-6 text-xs border rounded px-1 text-center" id={`bs-${l.id}`} defaultValue={l.autoBatchSize || 10} />
                              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => {
                                const v = parseInt((document.getElementById(`bs-${l.id}`) as HTMLInputElement)?.value) || 10;
                                fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoBatchSize: v }) }); fLines();
                              }}>保存</Button>
                            </div>
                            <Switch checked={!!l.autoEnabled} onCheckedChange={v => { fetch(`/api/lines/${l.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoEnabled: v }) }); fLines(); }} />
                            <span className="text-[10px] text-muted-foreground">自动</span>
                            <div className="flex gap-1 ml-auto">
                              <input className="w-12 h-6 text-xs border rounded px-1 text-center" id={`qi-${l.id}`} defaultValue={l.autoBatchSize || 10} />
                              <Button size="sm" className="h-6 text-[10px] px-2" disabled={gdBusy || poolN === 0} onClick={() => { const v = parseInt((document.getElementById(`qi-${l.id}`) as HTMLInputElement)?.value) || 10; doQuickImport(l.id, v); }}>上弹</Button>
                            </div>
                          </>
                        )}
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setShowDashboard(false); setLid(l.id); loadLine(l.id, lines); }}>详情→</Button>
                      </div>
                  </div>
                </Card>
              );
            })}
          </div>
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

          {/* Monitor — Fixed Slots or Regular */}
          {cfg.importStrategy === "fixed_slots" ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm flex items-center gap-2">固定槽位监控 <Badge variant="secondary">{slotData?.summary.total || 0}</Badge></CardTitle>
                {slotData && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-green-500">{slotData.summary.active} 活跃</span>
                    <span className="text-red-500">{slotData.summary.disabled} 禁用</span>
                    <span className="font-mono font-semibold">{fmtQ(slotData.summary.totalQuota)}</span>
                  </div>
                )}
                <Button size="sm" variant="ghost" className="text-xs h-7 ml-auto" disabled={slotLoading} onClick={() => lid && fSlots(lid)}>{slotLoading ? "..." : "刷新"}</Button>
              </div>
            </CardHeader>
            <CardContent>
              {!slotData || slotData.slots.length === 0 ? <p className="text-center text-muted-foreground text-sm py-6">未初始化槽位</p> : (
                <Table><TableHeader><TableRow><TableHead className="w-16">ID</TableHead><TableHead>渠道名</TableHead><TableHead className="w-20">状态</TableHead><TableHead>Key</TableHead><TableHead className="w-24">消耗</TableHead></TableRow></TableHeader>
                <TableBody>{slotData.slots.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.id}</TableCell>
                    <TableCell className="text-xs">{s.name}</TableCell>
                    <TableCell><Badge variant={s.status === 1 ? "default" : s.status === 3 ? "destructive" : "secondary"} className="text-[10px]">{s.statusText}</Badge></TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[200px] truncate">{s.keyPreview}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{fmtQ(s.usedQuota)}</TableCell>
                  </TableRow>
                ))}</TableBody></Table>
              )}
            </CardContent>
          </Card>
          ) : (
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
                <Table><TableHeader><TableRow><TableHead>渠道名称</TableHead><TableHead>密钥数</TableHead><TableHead>禁用</TableHead><TableHead>状态</TableHead><TableHead>总消耗</TableHead><TableHead>刷新</TableHead><TableHead className="w-8" /></TableRow></TableHeader>
                <TableBody>{recs.map(r => {
                  let st = "活跃", sc = "text-green-500";
                  if (r.frozen) { st = "冻结"; sc = "text-muted-foreground"; }
                  else if (r.allDisabledSince) { st = `禁用(${Math.max(0, FREEZE_AFTER - (now - r.allDisabledSince))}s)`; sc = "text-yellow-500"; }
                  else if (r.disabledCount > 0) { st = "部分禁用"; sc = "text-orange-500"; }
                  const deadPct = r.keyCount > 0 ? Math.round(r.disabledCount / r.keyCount * 100) : 0;
                  return (<TableRow key={r.id}><TableCell className="font-medium">{r.name}</TableCell><TableCell className="font-mono text-xs">{r.keyCount}</TableCell><TableCell className={`font-mono text-xs ${deadPct >= 67 ? "text-red-500 font-semibold" : deadPct > 0 ? "text-orange-500" : "text-muted-foreground"}`}>{r.disabledCount}/{r.keyCount} ({deadPct}%)</TableCell><TableCell className={`text-xs ${sc}`}>{st}</TableCell><TableCell className="font-mono font-semibold text-xs">{fmtQ(r.cachedQuota)}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{fmtT(r.lastRefresh)}</TableCell><TableCell><button className="text-muted-foreground hover:text-destructive text-xs" onClick={() => delRec(r.id)}>&#10005;</button></TableCell></TableRow>);
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
          )}

          {/* Connection Config */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">连接配置</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-[2]"><Label className="text-xs">API 地址</Label><Input value={cfg.baseUrl || ""} onChange={e => upd("baseUrl", e.target.value)} /></div>
                <div className="w-[140px]"><Label className="text-xs">平台类型</Label>
                  <Select value={cfg.platformType || "newapi"} onValueChange={v => v && upd("platformType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newapi">New API</SelectItem><SelectItem value="naci">Naci Hub</SelectItem><SelectItem value="sub2api">Sub2API</SelectItem><SelectItem value="keyhub">KeyHub</SelectItem></SelectContent></Select>
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
            {cfg.importStrategy === "fixed_slots" ? (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">自动换key</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={autoOn} onCheckedChange={v => saveAuto(v, autoBatch)} />
                  <span className="text-sm text-muted-foreground">渠道被禁时自动从密钥池换key</span>
                  <span className={`text-xs ml-auto ${autoOn ? "text-green-500" : "text-muted-foreground"}`}>{autoOn ? `已启用 · 池中${poolN}` : "未启用"}</span>
                </div>
                <div className="flex items-center gap-3 border-t pt-3">
                  <Button size="sm" variant="outline" disabled={impBusy || poolN === 0} onClick={async () => {
                    if (!lid) return;
                    setImpBusy(true);
                    try {
                      const r = await fetch(`/api/lines/${lid}/replace-all-slots`, { method: "POST", headers: { "Content-Type": "application/json" } });
                      const d = await r.json();
                      alert(d.success ? `已换 ${d.data?.replaced}/${d.data?.total} 个渠道` : (d.error || "失败"));
                      fSlots(lid); fPool(); fLogs(lid);
                    } catch (e) { alert("请求失败"); }
                    setImpBusy(false);
                  }}>{impBusy ? "换key中..." : "一键全部换key"}</Button>
                  <span className="text-xs text-muted-foreground">从密钥池取 key 替换所有槽位</span>
                </div>
              </CardContent>
            </Card>
            ) : (<>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">自动上弹</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={autoOn} onCheckedChange={v => saveAuto(v, autoBatch)} />
                  <span className="text-sm text-muted-foreground">达到触发条件时自动导入</span>
                  <span className={`text-xs ml-auto ${autoOn && poolN > 0 ? "text-green-500" : "text-muted-foreground"}`}>{!autoOn ? "未启用" : poolN === 0 ? "池空" : `每批${autoBatch}`}</span>
                </div>
                <div className="flex items-center gap-3"><Label className="text-xs w-20">每批数量</Label><Input type="number" className="w-[120px]" value={autoBatch} onChange={e => saveAuto(autoOn, parseInt(e.target.value) || 10)} /></div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Label className="text-xs w-20">触发模式</Label>
                  <Select value={cfg.triggerMode || "dead_ratio"} onValueChange={v => v && upd("triggerMode", v)}>
                    <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dead_ratio">死亡比例</SelectItem>
                      <SelectItem value="quota_total">总消耗额度</SelectItem>
                      <SelectItem value="quota_avg">每key平均额度</SelectItem>
                    </SelectContent>
                  </Select>
                  {(cfg.triggerMode || "dead_ratio") === "dead_ratio" && (
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">阈值</Label>
                      <Input type="number" className="w-[80px] h-8" value={Math.round((parseFloat(cfg.triggerDeadRatio) || 0.67) * 100)} onChange={e => upd("triggerDeadRatio", String(Math.min(100, Math.max(1, parseInt(e.target.value) || 67)) / 100))} />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                  {(cfg.triggerMode || "dead_ratio") === "quota_total" && (
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">≥$</Label>
                      <Input type="number" className="w-[100px] h-8" value={((parseInt(cfg.triggerQuotaTotal) || 0) / 500000).toFixed(0)} onChange={e => upd("triggerQuotaTotal", String(Math.round((parseFloat(e.target.value) || 0) * 500000)))} />
                    </div>
                  )}
                  {(cfg.triggerMode || "dead_ratio") === "quota_avg" && (
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">≥$</Label>
                      <Input type="number" className="w-[100px] h-8" value={((parseInt(cfg.triggerQuotaAvg) || 0) / 500000).toFixed(0)} onChange={e => upd("triggerQuotaAvg", String(Math.round((parseFloat(e.target.value) || 0) * 500000)))} />
                      <span className="text-xs text-muted-foreground">/key</span>
                    </div>
                  )}
                </div>
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
