import { useEffect, useRef, useState } from "react";
import axios from "axios";
import Lenis from "lenis";
import { AnimatePresence, motion } from "framer-motion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CampaignPreview } from "@/components/CampaignPreview";
import { StatsPanel } from "@/components/StatsPanel";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { AutoDmPanel } from "@/components/AutoDmPanel";
import { DAY_LABELS, fmtDur, nextRunInMs, playAlertSound, resolveSpintax, resolveVars } from "@/lib/ghost";
import { Layers, Eye, BarChart3, FolderOpen, Terminal, Trash2, MoonStar, MessageSquareReply, BellRing, CopyPlus, BadgeCheck } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const newTarget = () => ({
  id: Math.random().toString(36).slice(2, 9),
  name: "kampania",
  channelId: "",
  message: "",
  delaySec: 60,
  loop: true,
  maxPerDay: 0,
  schedule: { mode: "now", time: "21:00", days: [1, 2, 3, 4, 5] },
  embed: { enabled: false, title: "", description: "", color: "#5af169", imageUrl: "" },
});

const embedHasContent = (e) =>
  !!(e?.enabled && (e.title.trim() || e.description.trim() || e.imageUrl.trim()));

function jitter(base, jitterPct) {
  const delta = base * (jitterPct / 100);
  return Math.max(0, Math.round(base + Math.random() * delta));
}

// Normal (Gaussian) distribution — human pacing clusters around the mean
// instead of being perfectly uniform.
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function humanDelayMs(baseMs, jitterPct) {
  const j = Math.abs(gauss()) * (jitterPct / 100) * baseMs;
  return Math.round(baseMs + Math.min(j, baseMs * 0.6));
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

// Returns ms to wait when the current time falls inside the quiet-hours window.
function quietWaitMs(q) {
  if (!q?.enabled) return 0;
  const [fh, fm] = (q.from || "01:00").split(":").map(Number);
  const [th, tm] = (q.to || "07:00").split(":").map(Number);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  const inWindow = from <= to ? mins >= from && mins < to : mins >= from || mins < to;
  if (!inWindow) return 0;
  const end = new Date(now);
  end.setHours(th, tm, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end - now;
}

const STEALTH = {
  low: {
    label: "Szybki",
    blurb: "Minimalne opóźnienia, stały rytm wysyłki. Najwyższe ryzyko przy tokenach użytkownika.",
    typing: false,
    humanTyping: false,
    burst: false,
    jitterPct: 8,
    coffee: null,
    warmup: false,
  },
  balanced: {
    label: "Zbalansowany",
    blurb: "Wskaźnik pisania + naturalne (gaussowskie) opóźnienia. USER: stały odcisk klienta i przerwy kawowe.",
    typing: true,
    humanTyping: false,
    burst: false,
    jitterPct: 12,
    coffee: { every: [12, 20], pause: [120, 300] },
    warmup: false,
  },
  max: {
    label: "Max Stealth",
    blurb: "Pisanie z pauzami jak człowiek, rozgrzewka tempa, dłuższe przerwy kawowe. Najwolniej = najbezpieczniej.",
    typing: true,
    humanTyping: true,
    burst: true,
    jitterPct: 15,
    coffee: { every: [8, 14], pause: [180, 480] },
    warmup: true,
  },
};

function humanTypingMs(text) {
  const base = 400 + text.length * (180 + Math.random() * 120);
  const variance = base * (0.15 + Math.random() * 0.25);
  return Math.min(14000, Math.round(base + (Math.random() * 2 - 1) * variance));
}

const PROFILES_KEY = "ghost-send:profiles";
const SESSION_KEY = "ghost-send:session";
const ENTERED_KEY = "ghost-send:entered";
const QUIET_KEY = "ghost-send:quiet";
const ALERTS_KEY = "ghost-send:alerts";
const DAILY_KEY = "ghost-send:daily";

const readDaily = () => {
  const today = new Date().toDateString();
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY) || "{}");
    if (d.date !== today) return { date: today, counts: {} };
    return { date: d.date, counts: d.counts || {} };
  } catch {
    return { date: today, counts: {} };
  }
};

const bumpDaily = (tag) => {
  const d = readDaily();
  d.counts[tag] = (d.counts[tag] || 0) + 1;
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(d));
  } catch {}
};

const TICKER = [
  "kampanie równoległe",
  "tryb stealth",
  "podgląd na żywo",
  "warianty spintax",
  "harmonogram wysyłek",
  "historia wysyłek",
  "auto-odpowiedzi dm",
  "alerty webhook",
  "godziny ciszy",
  "przerwy kawowe",
  "embody",
  "limity dzienne",
];

export default function App() {
  const [entered, setEntered] = useState(() => {
    try {
      return sessionStorage.getItem(ENTERED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [activeTab, setActiveTab] = useState("campaigns");
  const [token, setToken] = useState("");
  const [isBot, setIsBot] = useState(true);
  const [targets, setTargets] = useState([newTarget()]);
  const [stealth, setStealth] = useState("balanced");
  const [emojiMap, setEmojiMap] = useState({});
  const [emojisLoading, setEmojisLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const waitAbortersRef = useRef(new Set());
  const [log, setLog] = useState([]);
  const [stats, setStats] = useState({ sent: 0, failed: 0 });
  const [quiet, setQuiet] = useState({ enabled: false, from: "01:00", to: "07:00" });
  const [alerts, setAlerts] = useState({ sound: true, webhook: "" });
  const [identity, setIdentity] = useState(null);
  const [checking, setChecking] = useState(false);

  const [profiles, setProfiles] = useState({});
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [includeToken, setIncludeToken] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    let raf;
    const loop = (t) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) setProfiles(JSON.parse(raw));
      const last = localStorage.getItem(SESSION_KEY);
      if (last) applyConfig(JSON.parse(last));
      const q = localStorage.getItem(QUIET_KEY);
      if (q) setQuiet({ enabled: false, from: "01:00", to: "07:00", ...JSON.parse(q) });
      const a = localStorage.getItem(ALERTS_KEY);
      if (a) setAlerts({ sound: true, webhook: "", ...JSON.parse(a) });
    } catch {}
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const snap = { isBot, stealth, targets, savedToken: null };
      localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
    } catch {}
  }, [isBot, stealth, targets]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(QUIET_KEY, JSON.stringify(quiet));
    } catch {}
  }, [quiet]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    } catch {}
  }, [alerts]);

  const handleEnter = () => {
    try {
      sessionStorage.setItem(ENTERED_KEY, "1");
    } catch {}
    setEntered(true);
  };

  const applyConfig = (c) => {
    if (typeof c.isBot === "boolean") setIsBot(c.isBot);
    if (c.stealth) setStealth(c.stealth);
    if (Array.isArray(c.targets) && c.targets.length) {
      setTargets(
        c.targets.map((t) => ({
          ...newTarget(),
          ...t,
          schedule: { ...newTarget().schedule, ...(t.schedule || {}) },
          embed: { ...newTarget().embed, ...(t.embed || {}) },
          id: Math.random().toString(36).slice(2, 9),
        }))
      );
    }
    if (typeof c.savedToken === "string" && c.savedToken) setToken(c.savedToken);
  };

  const persistProfiles = (next) => {
    setProfiles(next);
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
    } catch {}
  };

  const onSaveProfile = () => {
    const name = profileName.trim();
    if (!name) {
      append("✗ podaj nazwę profilu");
      return;
    }
    const cfg = {
      isBot,
      stealth,
      targets,
      savedToken: includeToken && token ? token : null,
    };
    persistProfiles({ ...profiles, [name]: cfg });
    setSelectedProfile(name);
    append(`✓ zapisano profil "${name}"${includeToken ? " (z tokenem)" : ""}`);
  };

  const onLoadProfile = () => {
    const cfg = profiles[selectedProfile];
    if (!cfg) {
      append("✗ nie wybrano profilu");
      return;
    }
    applyConfig(cfg);
    append(`✓ wczytano profil "${selectedProfile}"`);
  };

  const onDeleteProfile = () => {
    if (!selectedProfile || !profiles[selectedProfile]) return;
    const next = { ...profiles };
    delete next[selectedProfile];
    persistProfiles(next);
    append(`■ usunięto profil "${selectedProfile}"`);
    setSelectedProfile("");
  };

  const onExportProfiles = () => {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghost-send-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    append(`⇡ wyeksportowano ${Object.keys(profiles).length} profil(i)`);
  };

  const onImportProfiles = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        const parsed = JSON.parse(txt);
        persistProfiles({ ...profiles, ...parsed });
        append(`⇣ zaimportowano ${Object.keys(parsed).length} profil(i)`);
      } catch {
        append("✗ nieprawidłowy plik konfiguracji");
      }
    });
    e.target.value = "";
  };

  const wait = async (ms) => {
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        waitAbortersRef.current.delete(abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(t);
        waitAbortersRef.current.delete(abort);
        resolve();
      };
      waitAbortersRef.current.add(abort);
    });
  };

  const abortAll = () => {
    stopRef.current = true;
    for (const a of Array.from(waitAbortersRef.current)) a();
    append("■ ZATRZYMANO NA ŻĄDANIE");
  };

  const append = (line) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 200));

  const fireAlert = (campaign, status, error) => {
    if (alerts.sound) playAlertSound();
    const url = alerts.webhook?.trim();
    if (url) {
      axios
        .post(`${API}/alert/relay`, {
          url,
          payload: {
            event: "campaign_stopped",
            app: "GHOST.SEND",
            campaign,
            status,
            error: String(error).slice(0, 200),
            time: new Date().toISOString(),
          },
        })
        .then((r) =>
          append(r.data?.ok ? "⇡ alert webhook wysłany" : `✗ webhook odpowiedział ${r.data?.status ?? "?"}`)
        )
        .catch(() => append("✗ alert webhook nie dotarł"));
    }
  };

  const updateTarget = (id, patch) =>
    setTargets((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addTarget = () => setTargets((ts) => [...ts, newTarget()]);
  const removeTarget = (id) =>
    setTargets((ts) => (ts.length > 1 ? ts.filter((t) => t.id !== id) : ts));
  const duplicateTarget = (id) =>
    setTargets((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      if (i < 0) return ts;
      const src = ts[i];
      const copy = {
        ...src,
        id: Math.random().toString(36).slice(2, 9),
        name: `${src.name} kopia`,
        schedule: { ...src.schedule, days: [...src.schedule.days] },
        embed: { ...src.embed },
      };
      return [...ts.slice(0, i + 1), copy, ...ts.slice(i + 1)];
    });

  const recordHistory = (tag, channelId, message, ok, status, error) => {
    axios
      .post(`${API}/history`, {
        campaign: tag,
        channelId,
        message: message.slice(0, 500),
        ok,
        status,
        error: error ? String(error).slice(0, 200) : null,
      })
      .catch(() => {});
  };

  const onCheckToken = async () => {
    if (!token.trim()) {
      append("✗ WYMAGANY TOKEN");
      return;
    }
    setChecking(true);
    try {
      const res = (await axios.post(`${API}/discord/me`, { token, isBot })).data;
      if (res.ok) {
        setIdentity(res.username);
        append(`✓ token OK — zalogowano jako ${res.username}${res.bot ? " (bot)" : ""}`);
      } else {
        setIdentity(null);
        append(`✗ token → ${res.status}: ${String(res.error).slice(0, 80)}`);
      }
    } catch (err) {
      setIdentity(null);
      append(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setChecking(false);
    }
  };

  const onLoadEmojis = async () => {
    if (!token.trim()) {
      append("✗ WYMAGANY TOKEN aby pobrać emoji");
      return;
    }
    setEmojisLoading(true);
    append("⇣ skanowanie serwerów w poszukiwaniu emoji...");
    try {
      const res = (await axios.post(`${API}/discord/emojis`, { token, isBot })).data;
      if (res.ok) {
        setEmojiMap(res.map);
        append(`✓ załadowano ${res.emojiCount} emoji z ${res.guildCount} serwera(ów)`);
      } else {
        append(`✗ skanowanie emoji → ${res.status}: ${String(res.error).slice(0, 80)}`);
      }
    } catch (err) {
      append(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEmojisLoading(false);
    }
  };

  const runCampaign = async (t, seed) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const preset = STEALTH[stealth];
    const userMode = !isBot;
    const userBurst = userMode && preset.burst;
    let sentCount = 0;
    let sendIdx = 0;
    let nextCoffee = preset.coffee ? randInt(preset.coffee.every[0], preset.coffee.every[1]) : Infinity;
    do {
      if (stopRef.current) break;
      const qMs = quietWaitMs(quiet);
      if (qMs > 0) {
        append(`☾ [${tag}] godziny ciszy — pauza ${fmtDur(qMs)} (symulacja snu)`);
        await wait(qMs);
        if (stopRef.current) break;
      }
      if (t.maxPerDay > 0) {
        const d = readDaily();
        if ((d.counts[tag] || 0) >= t.maxPerDay) {
          const now = new Date();
          const mid = new Date(now);
          mid.setHours(24, 0, 0, 0);
          append(`⏸ [${tag}] limit dzienny ${t.maxPerDay}/dzień — pauza do północy (${fmtDur(mid - now)})`);
          await wait(mid - now);
          if (stopRef.current) break;
        }
      }
      const content = resolveVars(resolveSpintax(t.message), sendIdx + 1);
      const tMs = preset.humanTyping ? humanTypingMs(content || t.embed.description) : 1500;
      if (preset.typing)
        append(`✎ [${tag}] pisanie (~${(tMs / 1000).toFixed(1)}s)${userBurst ? " · z pauzami" : ""}`);
      try {
        const res = (
          await axios.post(`${API}/discord/send`, {
            token,
            channelId: t.channelId,
            message: content,
            isBot,
            typing: preset.typing,
            typingMs: tMs,
            typingBurst: userBurst,
            profileSeed: userMode ? seed : undefined,
            emojiMap: Object.keys(emojiMap).length ? emojiMap : undefined,
            embed: embedHasContent(t.embed)
              ? {
                  title: resolveVars(resolveSpintax(t.embed.title), sendIdx + 1),
                  description: resolveVars(resolveSpintax(t.embed.description), sendIdx + 1),
                  color: t.embed.color,
                  imageUrl: t.embed.imageUrl,
                }
              : undefined,
          })
        ).data;
        if (res.ok) {
          setStats((s) => ({ ...s, sent: s.sent + 1 }));
          append(`✓ [${tag}] wysłano`);
          recordHistory(tag, t.channelId, content || `[embed] ${t.embed.title}`, true, res.status);
          bumpDaily(tag);
          sentCount++;
          sendIdx++;
          if (userMode && preset.coffee && sentCount >= nextCoffee) {
            sentCount = 0;
            nextCoffee = randInt(preset.coffee.every[0], preset.coffee.every[1]);
            const pause = randInt(preset.coffee.pause[0], preset.coffee.pause[1]) * 1000;
            append(`☕ [${tag}] przerwa kawowa ${fmtDur(pause)} — jak człowiek`);
            await wait(pause);
            if (stopRef.current) break;
          }
        } else {
          setStats((s) => ({ ...s, failed: s.failed + 1 }));
          append(`✗ [${tag}] ${res.status}: ${String(res.error).slice(0, 80)}`);
          recordHistory(tag, t.channelId, content || `[embed] ${t.embed.title}`, false, res.status, res.error);
          if (res.status === 1015) {
            const backoff = Math.max(300000, Math.round((res.retryAfter ?? 300) * 1000));
            append(`⏸ [${tag}] cloudflare 1015 · przerwa ${(backoff / 1000).toFixed(0)}s (długi backoff)`);
            await wait(backoff);
          } else if (res.status === 429) {
            const backoff = Math.max(30000, Math.round((res.retryAfter ?? 30) * 1000));
            append(`⏸ [${tag}] limit żądań · przerwa ${(backoff / 1000).toFixed(0)}s`);
            await wait(backoff);
          } else if (res.status === 401 || res.status === 403) {
            append(`■ [${tag}] token nieprawidłowy/zabroniony — zatrzymuję wszystko`);
            fireAlert(tag, res.status, res.error);
            stopRef.current = true;
            for (const a of Array.from(waitAbortersRef.current)) a();
            return;
          }
        }
      } catch (err) {
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        append(`✗ [${tag}] ${err instanceof Error ? err.message : String(err)}`);
        recordHistory(tag, t.channelId, content, false, 0, err instanceof Error ? err.message : String(err));
      }
      if (!t.loop || stopRef.current) break;
      let baseMs = Math.max(1000, t.delaySec * 1000);
      if (userMode && preset.warmup && sendIdx < 3) {
        baseMs = Math.round(baseMs * [2.4, 1.7, 1.3][sendIdx]);
        append(`↷ [${tag}] rozgrzewka tempa ×${[2.4, 1.7, 1.3][sendIdx]}`);
      }
      const w = userMode ? humanDelayMs(baseMs, preset.jitterPct) : jitter(baseMs, preset.jitterPct);
      append(`⏱ [${tag}] następna za ${(w / 1000).toFixed(1)}s`);
      await wait(w);
    } while (t.loop && !stopRef.current);
    append(`■ [${tag}] zatrzymano`);
  };

  const runScheduled = async (t) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const seed = Math.floor(Math.random() * 10 ** 6);
    while (!stopRef.current) {
      const ms = nextRunInMs(t.schedule);
      if (ms > 0) {
        append(
          `⏱ [${tag}] start zaplanowany za ${fmtDur(ms)} (${new Date(Date.now() + ms).toLocaleString("pl-PL")})`
        );
        await wait(ms);
        if (stopRef.current) break;
      }
      await runCampaign(t, seed);
      if (t.schedule?.mode !== "weekly" || t.loop || stopRef.current) break;
      append(`↷ [${tag}] tryb cykliczny — czekam na kolejny termin`);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (running) return;
    if (!token.trim()) {
      append("✗ WYMAGANY TOKEN");
      setActiveTab("logs");
      return;
    }
    const valid = targets.filter(
      (t) => t.channelId.trim() && (t.message.trim() || embedHasContent(t.embed))
    );
    if (valid.length === 0) {
      append("✗ DODAJ PRZYNAJMNIEJ JEDNĄ KAMPANIĘ");
      setActiveTab("logs");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    setStats({ sent: 0, failed: 0 });
    append(`▶ start ${valid.length} kampanii · tryb: ${STEALTH[stealth].label}${isBot ? "" : " · USER stealth+"}`);
    setActiveTab("logs");
    try {
      await Promise.all(valid.map((t) => runScheduled(t)));
      append("■ wszystkie kampanie zatrzymane");
    } finally {
      setRunning(false);
      stopRef.current = false;
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden" data-testid="ghost-send-app">
      <AnimatePresence>
        {!entered && <WelcomeScreen key="welcome" onEnter={handleEnter} />}
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-primary"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse-neon" />
              sygnał//wychodzący
            </motion.div>
            <h1 className="mt-2 font-display text-5xl font-bold tracking-tight">
              <span className="block overflow-hidden pb-1">
                <motion.span
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="block text-glow"
                >
                  GHOST<span className="text-primary">.</span>SEND
                </motion.span>
              </span>
            </h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="mt-2 max-w-lg font-mono text-xs text-muted-foreground"
            >
              kampanie discord · harmonogram · spintax · auto-dm · historia wysyłek
            </motion.p>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.7 }}
            className="flex items-center gap-3 font-mono text-xs"
          >
            <Stat label="wysłane" value={stats.sent} tone="neon" testId="stat-sent" />
            <Stat label="błędy" value={stats.failed} tone="danger" testId="stat-failed" />
            <StatusPill running={running} />
          </motion.div>
        </header>

        <Ticker />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList
            aria-label="Widoki aplikacji"
            className="grid h-auto w-full grid-cols-2 gap-1 rounded-md border border-border bg-secondary/40 p-1 sm:grid-cols-3 lg:grid-cols-6"
          >
            <TabsTrigger value="campaigns" className="gap-2 py-3" data-testid="tab-campaigns">
              <Layers className="size-4" />Kampanie
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-2 py-3" data-testid="tab-preview">
              <Eye className="size-4" />Podgląd
            </TabsTrigger>
            <TabsTrigger value="autodm" className="gap-2 py-3" data-testid="tab-autodm">
              <MessageSquareReply className="size-4" />Auto DM
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2 py-3" data-testid="tab-stats">
              <BarChart3 className="size-4" />Statystyki
            </TabsTrigger>
            <TabsTrigger value="configs" className="gap-2 py-3" data-testid="tab-configs">
              <FolderOpen className="size-4" />Konfiguracje
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2 py-3" data-testid="tab-logs">
              <Terminal className="size-4" />Dziennik{" "}
              {log.length > 0 && (
                <span className="font-mono text-xs text-muted-foreground">({log.length})</span>
              )}
            </TabsTrigger>
          </TabsList>
          <form onSubmit={onSubmit} className="mt-6 space-y-6">
            <TabsContent value="autodm" forceMount>
              <AutoDmPanel
                token={token}
                isBot={isBot}
                onLog={append}
                onAlert={fireAlert}
                onRecord={recordHistory}
              />
            </TabsContent>
            <TabsContent value="configs">
              <Panel
                label={`00 // konfiguracje [${Object.keys(profiles).length}]`}
                action={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={onExportProfiles}
                      disabled={Object.keys(profiles).length === 0}
                      data-testid="export-profiles-btn"
                      className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                    >
                      ⇡ eksport
                    </Button>
                    <label
                      data-testid="import-profiles-label"
                      className="cursor-pointer rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20"
                    >
                      ⇣ import
                      <input
                        type="file"
                        accept="application/json"
                        onChange={onImportProfiles}
                        className="hidden"
                        data-testid="import-profiles-input"
                      />
                    </label>
                  </div>
                }
              >
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  zapisz listy kampanii + ustawienia stealth jako nazwane profile. bieżąca sesja
                  zapisuje się automatycznie lokalnie (bez tokena).
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="nazwa nowego profilu"
                    data-testid="profile-name-input"
                    className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  />
                  <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeToken}
                      onChange={(e) => setIncludeToken(e.target.checked)}
                      className="accent-primary"
                      data-testid="include-token-checkbox"
                    />
                    z tokenem
                  </label>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={onSaveProfile}
                    data-testid="save-profile-btn"
                    className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                  >
                    ▤ zapisz
                  </Button>
                </div>
                {Object.keys(profiles).length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <select
                      value={selectedProfile}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                      data-testid="profile-select"
                      className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                    >
                      <option value="">— wybierz profil —</option>
                      {Object.keys(profiles).map((n) => (
                        <option key={n} value={n}>
                          {n}
                          {profiles[n].savedToken ? " ⚿" : ""} · {profiles[n].targets.length} cel(ów)
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={onLoadProfile}
                      disabled={!selectedProfile}
                      data-testid="load-profile-btn"
                      className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                    >
                      ↻ wczytaj
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={onDeleteProfile}
                      disabled={!selectedProfile}
                      data-testid="delete-profile-btn"
                      className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
                    >
                      ✕ usuń
                    </Button>
                  </div>
                )}
                {includeToken && (
                  <p className="mt-2 font-mono text-[10px] leading-relaxed text-warn">
                    ⚠ token zostanie zapisany jako zwykły tekst w localStorage Twojej przeglądarki.
                  </p>
                )}
              </Panel>
            </TabsContent>
            <TabsContent value="campaigns" className="space-y-6">
              <Panel label="01 // autoryzacja">
                <div className="flex gap-2">
                  <TokenTypeButton
                    active={isBot}
                    onClick={() => { setIsBot(true); setIdentity(null); }}
                    label="BOT"
                    hint="zalecane"
                    testId="token-bot-btn"
                  />
                  <TokenTypeButton
                    active={!isBot}
                    onClick={() => { setIsBot(false); setIdentity(null); }}
                    label="USER"
                    hint="ryzyko ToS"
                    testId="token-user-btn"
                  />
                </div>
                <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  token
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => { setToken(e.target.value); setIdentity(null); }}
                    data-testid="token-input"
                    className="w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_1px_hsl(var(--primary))]"
                    placeholder="•••••••••••••••••••"
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={onCheckToken}
                    disabled={checking}
                    data-testid="check-token-btn"
                    className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    <BadgeCheck className="size-3.5" />
                    {checking ? "sprawdzam..." : "sprawdź"}
                  </Button>
                </div>
                {identity && (
                  <p data-testid="token-identity" className="mt-2 font-mono text-[10px] text-primary">
                    ✓ zalogowano: {identity}
                  </p>
                )}
              </Panel>

              <Panel
                label={`02 // kampanie [${targets.length}]`}
                action={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={onLoadEmojis}
                      disabled={emojisLoading}
                      data-testid="load-emoji-btn"
                      title="Pobierz custom emoji ze wszystkich serwerów (Nitro potrzebne do użycia między serwerami przy tokenie użytkownika)"
                      className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    >
                      {emojisLoading
                        ? "⇣ skanowanie..."
                        : Object.keys(emojiMap).length > 0
                          ? `☺ ${Object.keys(emojiMap).length} emoji`
                          : "⇣ wczytaj emoji"}
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={addTarget}
                      data-testid="add-campaign-btn"
                      className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                    >
                      + dodaj kampanię
                    </Button>
                  </div>
                }
              >
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  każda kampania działa niezależnie we własnej pętli. składnia{" "}
                  <span className="text-accent">{"{a|b}"}</span> losuje wariant, zmienne{" "}
                  <span className="text-accent">{"{data} {czas} {dzien} {licznik} {losowa:1-100}"}</span>{" "}
                  podstawiają się przy każdej wysyłce,{" "}
                  <span className="text-accent">:nazwa_emoji:</span> rozwiązuje custom emoji.
                </p>
                <div className="space-y-3">
                  {targets.map((t, i) => (
                    <div
                      key={t.id}
                      data-testid={`campaign-card-${t.id}`}
                      className="group relative rounded-md border border-border bg-background/40 p-3 transition-colors hover:border-primary/40"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                            #{String(i + 1).padStart(2, "0")}
                          </span>
                          <input
                            value={t.name}
                            onChange={(e) => updateTarget(t.id, { name: e.target.value })}
                            data-testid={`campaign-name-input-${t.id}`}
                            className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-foreground outline-none hover:border-border focus:border-primary"
                            placeholder="nazwa kampanii"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() => duplicateTarget(t.id)}
                            data-testid={`campaign-duplicate-btn-${t.id}`}
                            title="Duplikuj kampanię"
                            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground opacity-0 transition-opacity hover:text-primary hover:underline group-hover:opacity-100"
                          >
                            <CopyPlus className="size-3" />
                          </Button>
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() => removeTarget(t.id)}
                            disabled={targets.length === 1}
                            data-testid={`campaign-remove-btn-${t.id}`}
                            className="font-mono text-[10px] uppercase tracking-wider text-destructive opacity-0 transition-opacity hover:underline disabled:opacity-0 group-hover:opacity-100"
                          >
                            usuń
                          </Button>
                        </div>
                      </div>
                      <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        id kanału
                      </label>
                      <input
                        value={t.channelId}
                        onChange={(e) => updateTarget(t.id, { channelId: e.target.value })}
                        data-testid={`campaign-channel-input-${t.id}`}
                        className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                        placeholder="np. 123456789012345678"
                      />
                      <label className="mt-2 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        wiadomość <span className="text-accent">{"· {a|b} + zmienne {data} {licznik}"}</span>
                      </label>
                      <textarea
                        value={t.message}
                        onChange={(e) => updateTarget(t.id, { message: e.target.value })}
                        rows={2}
                        data-testid={`campaign-message-input-${t.id}`}
                        className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                        placeholder="np. {Cześć|Hej}! Dziś {dzien}, wiadomość nr {licznik} — puste, gdy sam embed"
                      />
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <div className="min-w-32 flex-1">
                          <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            opóźnienie (sekundy)
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={t.delaySec}
                            onChange={(e) =>
                              updateTarget(t.id, { delaySec: Math.max(1, Number(e.target.value) || 1) })
                            }
                            data-testid={`campaign-delay-input-${t.id}`}
                            className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            limit/dzień (0=bez)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={t.maxPerDay}
                            onChange={(e) =>
                              updateTarget(t.id, { maxPerDay: Math.max(0, Number(e.target.value) || 0) })
                            }
                            data-testid={`campaign-dailylimit-input-${t.id}`}
                            className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                          />
                        </div>
                        <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={t.loop}
                            onChange={(e) => updateTarget(t.id, { loop: e.target.checked })}
                            className="accent-primary"
                            data-testid={`campaign-loop-toggle-${t.id}`}
                          />
                          pętla
                        </label>
                      </div>

                      <div className="mt-2 rounded-sm border border-border bg-input/30 p-2.5">
                        <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={t.embed.enabled}
                            onChange={(e) => updateTarget(t.id, { embed: { ...t.embed, enabled: e.target.checked } })}
                            className="accent-primary"
                            data-testid={`campaign-embed-toggle-${t.id}`}
                          />
                          embed (bogata karta: tytuł, opis, kolor, obrazek)
                        </label>
                        {t.embed.enabled && (
                          <div className="mt-2 space-y-2" data-testid={`campaign-embed-editor-${t.id}`}>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <input
                                value={t.embed.title}
                                onChange={(e) => updateTarget(t.id, { embed: { ...t.embed, title: e.target.value } })}
                                data-testid={`campaign-embed-title-${t.id}`}
                                className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                                placeholder="tytuł embedu"
                              />
                              <input
                                type="color"
                                value={t.embed.color}
                                onChange={(e) => updateTarget(t.id, { embed: { ...t.embed, color: e.target.value } })}
                                data-testid={`campaign-embed-color-${t.id}`}
                                title="Kolor paska embedu"
                                className="h-8 w-12 cursor-pointer rounded-sm border border-border bg-input p-0.5"
                              />
                            </div>
                            <textarea
                              value={t.embed.description}
                              onChange={(e) => updateTarget(t.id, { embed: { ...t.embed, description: e.target.value } })}
                              rows={2}
                              data-testid={`campaign-embed-description-${t.id}`}
                              className="w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                              placeholder="opis embedu — działa {a|b} i zmienne"
                            />
                            <input
                              value={t.embed.imageUrl}
                              onChange={(e) => updateTarget(t.id, { embed: { ...t.embed, imageUrl: e.target.value } })}
                              data-testid={`campaign-embed-image-${t.id}`}
                              className="w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                              placeholder="url obrazka (https://...)"
                            />
                          </div>
                        )}
                      </div>

                      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
                        <div>
                          <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            start kampanii
                          </label>
                          <select
                            value={t.schedule.mode}
                            onChange={(e) =>
                              updateTarget(t.id, { schedule: { ...t.schedule, mode: e.target.value } })
                            }
                            data-testid={`campaign-schedule-mode-${t.id}`}
                            className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                          >
                            <option value="now">natychmiast</option>
                            <option value="at">o godzinie</option>
                            <option value="weekly">w wybranych dniach tygodnia</option>
                          </select>
                        </div>
                        {t.schedule.mode !== "now" && (
                          <div>
                            <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                              godzina
                            </label>
                            <input
                              type="time"
                              value={t.schedule.time}
                              onChange={(e) =>
                                updateTarget(t.id, { schedule: { ...t.schedule, time: e.target.value } })
                              }
                              data-testid={`campaign-schedule-time-${t.id}`}
                              className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                            />
                          </div>
                        )}
                      </div>
                      {t.schedule.mode === "weekly" && (
                        <div className="mt-2 flex flex-wrap gap-1" data-testid={`campaign-schedule-days-${t.id}`}>
                          {DAY_LABELS.map(([label, val]) => {
                            const active = t.schedule.days.includes(val);
                            return (
                              <Button
                                variant="outline"
                                key={val}
                                type="button"
                                onClick={() =>
                                  updateTarget(t.id, {
                                    schedule: {
                                      ...t.schedule,
                                      days: active
                                        ? t.schedule.days.filter((d) => d !== val)
                                        : [...t.schedule.days, val],
                                    },
                                  })
                                }
                                data-testid={`campaign-schedule-day-${t.id}-${val}`}
                                className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                                  active
                                    ? "border-primary/50 bg-primary/10 text-primary"
                                    : "border-border bg-input text-muted-foreground hover:border-primary/30"
                                }`}
                              >
                                {label}
                              </Button>
                            );
                          })}
                          <span className="ml-1 self-center font-mono text-[9px] text-muted-foreground">
                            bez pętli: wysyłka powtarza się w każdy zaznaczony dzień
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel label="03 // poziom stealth">
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  kontroluje, jak ludzko wygląda każda wysyłka. dotyczy wszystkich kampanii.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {Object.keys(STEALTH).map((k) => {
                    const p = STEALTH[k];
                    const active = stealth === k;
                    return (
                      <Button
                        variant="outline"
                        key={k}
                        type="button"
                        onClick={() => setStealth(k)}
                        data-testid={`stealth-option-${k}`}
                        className={`h-auto flex-col items-start gap-0 rounded-md border p-3 text-left transition-all ${
                          active
                            ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px_hsl(var(--primary))]"
                            : "border-border bg-input/50 hover:border-primary/40"
                        }`}
                      >
                        <div className={`font-mono text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                          {p.label}
                        </div>
                        <div className="mt-1 whitespace-normal font-mono text-[10px] leading-snug text-muted-foreground">
                          {p.blurb}
                        </div>
                      </Button>
                    );
                  })}
                </div>

                <div className="mt-3 rounded-md border border-border bg-input/50 p-3">
                  <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={quiet.enabled}
                      onChange={(e) => setQuiet({ ...quiet, enabled: e.target.checked })}
                      className="accent-primary"
                      data-testid="quiet-toggle"
                    />
                    <MoonStar className="size-3.5 text-accent" />
                    godziny ciszy — symulacja snu
                  </label>
                  {quiet.enabled && (
                    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="quiet-settings">
                      <input
                        type="time"
                        value={quiet.from}
                        onChange={(e) => setQuiet({ ...quiet, from: e.target.value })}
                        data-testid="quiet-from"
                        className="rounded-sm border border-border bg-input px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-primary"
                      />
                      <span className="font-mono text-[10px] text-muted-foreground">→</span>
                      <input
                        type="time"
                        value={quiet.to}
                        onChange={(e) => setQuiet({ ...quiet, to: e.target.value })}
                        data-testid="quiet-to"
                        className="rounded-sm border border-border bg-input px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-primary"
                      />
                      <span className="font-mono text-[9px] leading-snug text-muted-foreground">
                        w tym oknie kampanie czekają do końca ciszy zamiast wysyłać
                      </span>
                    </div>
                  )}
                </div>

                <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  token <span className="text-accent">USER</span> dodatkowo: stały odcisk
                  przeglądarki na całą kampanię (5 profili), opóźnienia gaussowskie, przerwy kawowe
                  wg poziomu, a w Max Stealth pisanie z pauzami i rozgrzewka tempa pierwszych
                  wiadomości. nie zamykaj karty — zamknięcie zatrzymuje wszystko.
                </p>
              </Panel>

              <Panel label="04 // alerty o błędach">
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  gdy kampania dostanie błąd krytyczny (401/403) i się zatrzyma — dźwięk alarmu
                  i/lub POST JSON na Twój webhook (np. Discord webhook, n8n, Zapier).
                </p>
                <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                  <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={alerts.sound}
                      onChange={(e) => setAlerts({ ...alerts, sound: e.target.checked })}
                      className="accent-primary"
                      data-testid="alert-sound-toggle"
                    />
                    <BellRing className="size-3.5 text-warn" />
                    dźwięk
                  </label>
                  <div>
                    <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      url webhooka
                    </label>
                    <input
                      value={alerts.webhook}
                      onChange={(e) => setAlerts({ ...alerts, webhook: e.target.value })}
                      data-testid="alert-webhook-input"
                      className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                      placeholder="https://discord.com/api/webhooks/..."
                    />
                  </div>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      fireAlert("test", 0, "testowy alert z GHOST.SEND");
                      append("♪ test alertu — dźwięk/webhook");
                    }}
                    data-testid="alert-test-btn"
                    className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-warn transition-colors hover:bg-warn/20"
                  >
                    ♪ test alertu
                  </Button>
                </div>
              </Panel>
            </TabsContent>
            <TabsContent value="preview">
              <CampaignPreview targets={targets} />
            </TabsContent>
            <TabsContent value="stats">
              <StatsPanel />
            </TabsContent>
            <TabsContent value="logs">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Dziennik sesji</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLog([])}
                  disabled={!log.length}
                  data-testid="clear-log-btn"
                >
                  <Trash2 />Wyczyść
                </Button>
              </div>
              <div className="scanlines overflow-hidden rounded-md border border-border bg-background/80">
                <ul
                  aria-live="polite"
                  data-testid="log-list"
                  className="log-scroll h-[420px] overflow-auto p-4 font-mono text-xs leading-relaxed"
                >
                  {log.length === 0 && <li className="text-muted-foreground">Brak zdarzeń w tej sesji.</li>}
                  {log.map((line, index) => (
                    <li key={index} className={`${logColor(line)} break-words [overflow-wrap:anywhere]`}>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>
            <div className="flex gap-2 border-t border-border pt-5">
              <Button
                variant="outline"
                type="submit"
                disabled={running}
                data-testid="start-campaigns-btn"
                className="group relative flex-1 overflow-hidden rounded-md border border-primary bg-primary/10 px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                <span className="relative z-10">{running ? "▮▮ działa..." : "▶ start kampanii"}</span>
                {!running && (
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                )}
              </Button>
              {running && (
                <Button
                  variant="outline"
                  type="button"
                  onClick={abortAll}
                  data-testid="abort-btn"
                  className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 font-mono text-sm font-bold uppercase tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  ■ stop
                </Button>
              )}
            </div>
          </form>

          <p className="mt-4 font-mono text-[10px] leading-relaxed text-warn">
            Tokeny użytkowników naruszają regulamin Discorda. Korzystaj z oficjalnego bota; żaden
            tryb nie gwarantuje uniknięcia blokady.
          </p>
        </Tabs>
      </div>
    </div>
  );
}

function logColor(line) {
  if (line.includes("✓")) return "text-primary";
  if (line.includes("✗") || line.includes("ZATRZYMANO")) return "text-destructive";
  if (line.includes("⏸") || line.includes("⏱") || line.includes("☕") || line.includes("☾"))
    return "text-warn";
  if (line.includes("✎") || line.includes("↷") || line.includes("✉") || line.includes("♪") || line.includes("⇡"))
    return "text-accent";
  if (line.includes("──") || line.includes("▶") || line.includes("■")) return "text-primary/80";
  return "text-muted-foreground";
}

function Panel({ label, action, children }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="panel-shadow rounded-md border border-border bg-card/60 p-5 backdrop-blur-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">{label}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function TokenTypeButton({ active, onClick, label, hint, testId }) {
  return (
    <Button
      variant="outline"
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`h-auto flex-1 flex-col items-start gap-0 rounded-md border px-4 py-3 text-left transition-all ${
        active
          ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px_hsl(var(--primary))]"
          : "border-border bg-input/50 hover:border-primary/40"
      }`}
    >
      <div className={`font-mono text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{label}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</div>
    </Button>
  );
}

function Stat({ label, value, tone, testId }) {
  return (
    <div
      data-testid={testId}
      className={`rounded-sm border px-3 py-2 text-right ${
        tone === "neon" ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <div
        className={`font-mono text-lg font-bold leading-none ${
          tone === "neon" ? "text-primary" : "text-destructive"
        }`}
      >
        {String(value).padStart(3, "0")}
      </div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusPill({ running }) {
  const s = running
    ? { label: "DZIAŁA", color: "text-primary border-primary/40 bg-primary/10" }
    : { label: "GOTOWY", color: "text-muted-foreground border-border" };
  return (
    <div
      data-testid="status-pill"
      className={`rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-wider ${s.color}`}
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {s.label}
    </div>
  );
}

function Ticker() {
  const items = [...TICKER, ...TICKER, ...TICKER];
  return (
    <div
      data-testid="status-marquee"
      className="relative mt-8 overflow-hidden border-y border-border/60 py-2 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]"
    >
      <div className="animate-marquee flex w-max gap-8 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
        {items.map((t, i) => (
          <span key={i} className="flex items-center gap-8">
            <span>{t}</span>
            <span className="text-primary/60">//</span>
          </span>
        ))}
      </div>
    </div>
  );
}
