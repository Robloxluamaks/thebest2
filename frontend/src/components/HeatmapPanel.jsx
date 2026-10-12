import { useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

// Green neon scale based on intensity 0..1
function cellStyle(v, peak) {
  if (!v) return { background: "hsl(var(--muted) / 0.35)" };
  const t = Math.min(1, v / (peak || 1));
  const alpha = 0.18 + t * 0.82;
  return { background: `hsl(var(--primary) / ${alpha.toFixed(2)})` };
}

export function HeatmapPanel({ refreshKey }) {
  const [data, setData] = useState({ grid: [], peak: 0, total: 0 });

  useEffect(() => {
    axios
      .get(`${API}/history/heatmap`)
      .then((r) => setData(r.data))
      .catch(() => {});
  }, [refreshKey]);

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <section className="panel-shadow rounded-md border border-border bg-card/60 p-5" data-testid="heatmap-panel">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
          heatmapa aktywności · godzina × dzień
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">{data.total} wysłanych</span>
      </div>

      {data.total === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          Brak danych — heatmapa wypełni się po pierwszych udanych wysyłkach.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="flex">
              <div className="w-8 shrink-0" />
              {hours.map((h) => (
                <div key={h} className="flex-1 text-center font-mono text-[8px] text-muted-foreground">
                  {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                </div>
              ))}
            </div>
            {DOW.map((label, dow) => (
              <div key={label} className="mt-1 flex items-center" data-testid={`heatmap-row-${dow}`}>
                <div className="w-8 shrink-0 font-mono text-[9px] uppercase text-muted-foreground">{label}</div>
                {hours.map((h) => {
                  const v = data.grid?.[dow]?.[h] || 0;
                  return (
                    <div key={h} className="flex-1 px-px">
                      <div
                        className="h-4 rounded-[2px] transition-colors"
                        style={cellStyle(v, data.peak)}
                        title={`${label} ${String(h).padStart(2, "0")}:00 — ${v} wysłanych`}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="mt-3 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
              <span>mniej</span>
              {[0.15, 0.4, 0.65, 0.9].map((a) => (
                <span key={a} className="h-3 w-5 rounded-[2px]" style={{ background: `hsl(var(--primary) / ${a})` }} />
              ))}
              <span>więcej · szczyt {data.peak}/h</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
