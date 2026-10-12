import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, BarChart3 } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function StatsPanel() {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        axios.get(`${API}/history/stats`),
        axios.get(`${API}/history?limit=50`),
      ]);
      setStats(s.data);
      setItems(h.data.items || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onClear = async () => {
    try {
      await axios.delete(`${API}/history`);
    } catch {}
    load();
  };

  const maxDay = Math.max(1, ...(stats?.byDay || []).map((d) => d.sent + d.failed));

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
      data-testid="stats-panel"
    >
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <BarChart3 className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Historia i statystyki wysyłek</h2>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            data-testid="stats-refresh-btn"
            className="rounded-sm border border-primary/40 bg-primary/10 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} /> odśwież
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={!items.length}
            data-testid="stats-clear-btn"
            className="rounded-sm border border-destructive/40 bg-destructive/10 font-mono text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/20"
          >
            <Trash2 /> wyczyść
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="wysłane" value={stats?.totalSent ?? 0} tone="neon" testId="stats-total-sent" />
        <StatTile label="błędy" value={stats?.totalFailed ?? 0} tone="danger" testId="stats-total-failed" />
        <StatTile
          label="razem"
          value={(stats?.totalSent ?? 0) + (stats?.totalFailed ?? 0)}
          tone="muted"
          testId="stats-total-all"
        />
      </div>

      <section className="panel-shadow rounded-md border border-border bg-card/60 p-5">
        <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
          ostatnie 7 dni
        </h3>
        <div className="flex h-32 items-end gap-2" data-testid="stats-chart">
          {(stats?.byDay || []).map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-24 w-full flex-col justify-end gap-px">
                <div
                  style={{ height: `${(d.failed / maxDay) * 100}%` }}
                  className="w-full rounded-t-sm bg-destructive/70 transition-all"
                  title={`błędy: ${d.failed}`}
                />
                <div
                  style={{ height: `${(d.sent / maxDay) * 100}%` }}
                  className="w-full bg-primary/80 transition-all"
                  title={`wysłane: ${d.sent}`}
                />
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      {stats?.byCampaign?.length > 0 && (
        <section className="panel-shadow rounded-md border border-border bg-card/60 p-5">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
            wg kampanii
          </h3>
          <div className="space-y-2" data-testid="stats-by-campaign">
            {stats.byCampaign.map((c) => {
              const total = c.sent + c.failed;
              const pct = total ? Math.round((c.sent / total) * 100) : 0;
              return (
                <div key={c.name} className="flex items-center gap-3 font-mono text-xs">
                  <span className="w-32 truncate text-foreground">{c.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary/80" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-primary">{c.sent}✓</span>
                  <span className="text-destructive">{c.failed}✗</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="scanlines overflow-hidden rounded-md border border-border bg-background/80">
        <ul
          aria-live="polite"
          data-testid="stats-history-list"
          className="log-scroll max-h-[420px] overflow-auto p-4 font-mono text-xs leading-relaxed"
        >
          {items.length === 0 && (
            <li className="text-muted-foreground">
              Brak zapisanych wysyłek. Historia zapisuje się automatycznie przy każdej wysyłce.
            </li>
          )}
          {items.map((it, i) => (
            <li key={i} className={`break-words [overflow-wrap:anywhere] ${it.ok ? "text-primary/90" : "text-destructive/90"}`}>
              [{new Date(it.timestamp).toLocaleString()}] {it.ok ? "✓" : "✗"} [{it.campaign}] kanał {it.channelId.slice(-6)}
              {" · "}
              {it.message.slice(0, 90)}
              {!it.ok && it.error ? ` · ${String(it.error).slice(0, 60)}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </motion.div>
  );
}

function StatTile({ label, value, tone, testId }) {
  const colors =
    tone === "neon"
      ? "border-primary/30 bg-primary/5 text-primary"
      : tone === "danger"
        ? "border-destructive/30 bg-destructive/5 text-destructive"
        : "border-border bg-secondary/40 text-foreground";
  return (
    <div data-testid={testId} className={`rounded-md border px-4 py-3 ${colors}`}>
      <div className="font-mono text-2xl font-bold leading-none">{String(value).padStart(3, "0")}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
