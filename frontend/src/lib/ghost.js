// Wspólne helpery GHOST.SEND: spintax, zmienne, harmonogram, formatowanie, alerty.

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

const DAYS_PL = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];

export function resolveVars(text, counter = 1) {
  const now = new Date();
  return text
    .split("{data}").join(now.toLocaleDateString("pl-PL"))
    .split("{czas}").join(now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }))
    .split("{dzien}").join(DAYS_PL[now.getDay()])
    .split("{licznik}").join(String(counter))
    .replace(/\{losowa:(\d+)-(\d+)\}/g, (m, a, b) => {
      const lo = Number(a);
      const hi = Number(b);
      return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
    });
}

export function hasVars(text) {
  return /\{(data|czas|dzien|licznik)\}|\{losowa:\d+-\d+\}/.test(text);
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

// Dwu-tonowy alarm WebAudio — bez zewnętrznych plików dźwiękowych.
export function playAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.frequency.setValueAtTime(622, ctx.currentTime + 0.16);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.32);
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch {}
}
