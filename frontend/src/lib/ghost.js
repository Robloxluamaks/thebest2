// Wspólne helpery GHOST.SEND: spintax, harmonogram, formatowanie.

export function resolveSpintax(text) {
  let out = text;
  let guard = 0;
  while (/\{[^{}]*\}/.test(out) && guard++ < 50) {
    out = out.replace(/\{([^{}]*)\}/g, (m, inner) => {
      const parts = inner.split("|");
      if (parts.length < 2) return m;
      return parts[Math.floor(Math.random() * parts.length)];
    });
  }
  return out;
}

export function hasSpintax(text) {
  return /\{[^{}]*\|[^{}]*\}/.test(text);
}

export const DAY_LABELS = [
  ["Pn", 1],
  ["Wt", 2],
  ["Śr", 3],
  ["Cz", 4],
  ["Pt", 5],
  ["So", 6],
  ["Nd", 0],
];

export function nextRunInMs(schedule) {
  if (!schedule || schedule.mode === "now") return 0;
  const [hh, mm] = (schedule.time || "09:00").split(":").map(Number);
  const now = new Date();
  if (schedule.mode === "at") {
    const t = new Date(now);
    t.setHours(hh, mm, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return t - now;
  }
  const days = (schedule.days && schedule.days.length ? schedule.days : [1, 2, 3, 4, 5]).slice();
  for (let add = 0; add < 8; add++) {
    const t = new Date(now);
    t.setDate(t.getDate() + add);
    t.setHours(hh, mm, 0, 0);
    if (days.includes(t.getDay()) && t > now) return t - now;
  }
  return 24 * 3600 * 1000;
}

export function scheduleLabel(schedule) {
  if (!schedule || schedule.mode === "now") return "start: natychmiast";
  if (schedule.mode === "at") return `start: ${schedule.time || "09:00"}`;
  const days = DAY_LABELS.filter(([, v]) => (schedule.days || []).includes(v))
    .map(([l]) => l)
    .join(",");
  return `start: ${days || "—"} ${schedule.time || "09:00"}`;
}

export function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
