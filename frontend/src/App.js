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
import { AiComposeModal } from "@/components/AiComposeModal";
import { EditCampaignModal } from "@/components/EditCampaignModal";
import { DAY_LABELS, fmtDur, nextRunInMs, playAlertSound, resolveSpintax, resolveVars, scheduleLabel } from "@/lib/ghost";
import { Layers, Eye, BarChart3, FolderOpen, Terminal, Trash2, MoonStar, MessageSquareReply, BellRing, CopyPlus, BadgeCheck, Sparkles, SlidersHorizontal, BookMarked, Pencil, Users, ShieldAlert } from "lucide-react";

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
  advanced: {
    enabled: false,
    startDelaySec: 0,
    jitterPct: 0,
    adaptive: false,
    stopAfterCount: 0,
    stopAfterMin: 0,
    autoEdit: { enabled: false, delaySec: 30, text: "" },
    autoDelete: { enabled: false, afterSec: 60 },
    restoreChannels: false,
    failGroup: false,
    group: "",
    activeChannel: { enabled: false, minNew: 1 },
    autoAcceptFriends: false,
    autoReact: { enabled: false, emojis: "" },
    forumReply: { enabled: false, parentId: "", message: "" },
  },
});

const DEFAULT_MASK = {
  shuffle: false,
  randomSkipPct: 0,
  idleBreaks: false,
  typos: false,
};

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

// Introduce a believable human typo: swap two adjacent letters in a random word.
function makeTypo(text) {
  if (!text || text.length < 4) return text;
  const chars = text.split("");
  const letterIdx = chars
    .map((c, i) => (/[a-zA-Ząćęłńóśźż]/i.test(c) ? i : -1))
    .filter((i) => i >= 0 && i < chars.length - 1);
  if (letterIdx.length < 2) return text;
  const i = letterIdx[Math.floor(Math.random() * (letterIdx.length - 1))];
  [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
  return chars.join("");
}

const PROFILES_KEY = "ghost-send:profiles";
const SESSION_KEY = "ghost-send:session";
const ENTERED_KEY = "ghost-send:entered";
const QUIET_KEY = "ghost-send:quiet";
const ALERTS_KEY = "ghost-send:alerts";
const DAILY_KEY = "ghost-send:daily";
const TEMPLATES_KEY = "ghost-send:templates";
const BACKUPS_KEY = "ghost-send:backups";
const MASK_KEY = "ghost-send:mask";

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
  const [alerts, setAlerts] = useState({ sound: true, webhook: "", logs: false });
  const [identity, setIdentity] = useState(null);
  const [checking, setChecking] = useState(false);

  const [profiles, setProfiles] = useState({});
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [includeToken, setIncludeToken] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplName, setTplName] = useState("");
  const [tplText, setTplText] = useState("");
  const [aiTargetId, setAiTargetId] = useState(null);
  const [editTargetId, setEditTargetId] = useState(null);
  const [backups, setBackups] = useState([]);
  const [backupToken, setBackupToken] = useState("");
  const [backupLabel, setBackupLabel] = useState("");
  const [mask, setMask] = useState(DEFAULT_MASK);
  const hydratedRef = useRef(false);
  const channelMetaRef = useRef({});
  const stoppedGroupsRef = useRef(new Set());

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
      if (a) setAlerts({ sound: true, webhook: "", logs: false, ...JSON.parse(a) });
      const tpl = localStorage.getItem(TEMPLATES_KEY);
      if (tpl) setTemplates(JSON.parse(tpl));
      const bk = localStorage.getItem(BACKUPS_KEY);
      if (bk) setBackups(JSON.parse(bk));
      const mk = localStorage.getItem(MASK_KEY);
      if (mk) setMask({ ...DEFAULT_MASK, ...JSON.parse(mk) });
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

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    } catch {}
  }, [templates]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups));
    } catch {}
  }, [backups]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(MASK_KEY, JSON.stringify(mask));
    } catch {}
  }, [mask]);

  const onSaveTemplate = () => {
    const name = tplName.trim();
    const text = tplText.trim();
    if (!name || !text) {
      append("✗ podaj nazwę i treść szablonu");
      return;
    }
    setTemplates((ts) => [{ id: Math.random().toString(36).slice(2, 9), name, text }, ...ts.filter((t) => t.name !== name)]);
    setTplName("");
    setTplText("");
    append(`✓ zapisano szablon "${name}"`);
  };

  const onDeleteTemplate = (id) => setTemplates((ts) => ts.filter((t) => t.id !== id));

  const onAddBackup = () => {
    const tok = backupToken.trim();
    if (!tok) {
      append("✗ wklej token konta zapasowego");
      return;
    }
    setBackups((b) => [...b, { id: Math.random().toString(36).slice(2, 9), label: backupLabel.trim() || `konto ${b.length + 1}`, token: tok }]);
    setBackupToken("");
    setBackupLabel("");
    append("✓ dodano konto zapasowe (tylko w przeglądarce)");
  };

  const onDeleteBackup = (id) => setBackups((b) => b.filter((x) => x.id !== id));

  const insertTemplate = (targetId, text) => {
    setTargets((ts) =>
      ts.map((t) =>
        t.id === targetId
          ? { ...t, message: t.message.trim() ? `${t.message}\n${text}` : text }
          : t
      )
    );
    append("✓ wstawiono szablon do kampanii");
  };

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
          advanced: {
            ...newTarget().advanced,
            ...(t.advanced || {}),
            autoEdit: { ...newTarget().advanced.autoEdit, ...(t.advanced?.autoEdit || {}) },
            autoDelete: { ...newTarget().advanced.autoDelete, ...(t.advanced?.autoDelete || {}) },
            activeChannel: { ...newTarget().advanced.activeChannel, ...(t.advanced?.activeChannel || {}) },
            autoReact: { ...newTarget().advanced.autoReact, ...(t.advanced?.autoReact || {}) },
            forumReply: { ...newTarget().advanced.forumReply, ...(t.advanced?.forumReply || {}) },
          },
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

  const append = (line) => {
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 200));
    // Webhook activity logs — forward meaningful events only (fire-and-forget).
    if (alerts.logs && alerts.webhook?.trim() && /[✓✗■▶]/.test(line)) {
      axios
        .post(`${API}/alert/relay`, {
          url: alerts.webhook.trim(),
          payload: { event: "log", app: "GHOST.SEND", line, time: new Date().toISOString() },
        })
        .catch(() => {});
    }
  };

  const onAiApply = (targetId, text, replace) => {
    setTargets((ts) =>
      ts.map((t) =>
        t.id === targetId
          ? { ...t, message: replace ? text : t.message.trim() ? `${t.message}\n${text}` : text }
          : t
      )
    );
    append(`✓ zastosowano treść z AI${replace ? " (zastąpiono)" : " (dopisano)"}`);
  };

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
        advanced: {
          ...src.advanced,
          autoEdit: { ...src.advanced.autoEdit },
          autoDelete: { ...src.advanced.autoDelete },
          activeChannel: { ...src.advanced.activeChannel },
          autoReact: { ...src.advanced.autoReact },
          forumReply: { ...src.advanced.forumReply },
        },
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

  const scheduleAutoActions = (t, seed, msgId, tag, curToken, chanId) => {
    if (!msgId || !t.advanced?.enabled) return;
    const userMode = !isBot;
    const adv = t.advanced;
    if (adv.autoEdit?.enabled && adv.autoEdit.text.trim()) {
      const delay = Math.max(2, adv.autoEdit.delaySec) * 1000;
      setTimeout(() => {
        const edited = resolveVars(resolveSpintax(adv.autoEdit.text), 0);
        axios
          .post(`${API}/discord/edit`, {
            token: curToken,
            channelId: chanId,
            messageId: msgId,
            message: edited,
            isBot,
            profileSeed: userMode ? seed : undefined,
          })
          .then((r) => append(r.data?.ok ? `✎ [${tag}] auto-edycja wysłana` : `✗ [${tag}] auto-edycja → ${r.data?.status}`))
          .catch(() => {});
      }, delay);
    }
    if (adv.autoDelete?.enabled) {
      const delay = Math.max(2, adv.autoDelete.afterSec) * 1000;
      setTimeout(() => {
        axios
          .post(`${API}/discord/delete`, {
            token: curToken,
            channelId: chanId,
            messageId: msgId,
            isBot,
            profileSeed: userMode ? seed : undefined,
          })
          .then((r) => append(r.data?.ok ? `🗑 [${tag}] auto-usunięcie wykonane` : `✗ [${tag}] auto-usunięcie → ${r.data?.status}`))
          .catch(() => {});
      }, delay);
    }
  };

  // Validate and switch to the next untried backup token. Returns new token or null.
  const trySwitchBackup = async (tag, triedSet) => {
    for (const b of backups) {
      if (!b.token || triedSet.has(b.token)) continue;
      triedSet.add(b.token);
      try {
        const me = (await axios.post(`${API}/discord/me`, { token: b.token, isBot })).data;
        if (me.ok) {
          append(`⇄ [${tag}] przełączono na konto zapasowe "${b.label || me.username}"`);
          return b.token;
        }
        append(`✗ [${tag}] konto zapasowe "${b.label || "?"}" nieważne — próbuję następne`);
      } catch {
        /* try next */
      }
    }
    return null;
  };

  const runCampaign = async (t, seed) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const preset = STEALTH[stealth];
    const userMode = !isBot;
    const userBurst = userMode && preset.burst;
    const adv = t.advanced || {};
    const effJitter = adv.enabled && adv.jitterPct > 0 ? adv.jitterPct : preset.jitterPct;
    const startedAt = Date.now();
    let adaptiveMult = 1;
    let sentCount = 0;
    let sendIdx = 0;
    let curToken = token;
    let curChannelId = t.channelId;
    const triedBackups = new Set([token]);
    let nextCoffee = preset.coffee ? randInt(preset.coffee.every[0], preset.coffee.every[1]) : Infinity;

    // Resolve channel metadata (name + guild + last message) for restore / active-channel.
    const meta = channelMetaRef.current[t.id] || {};
    if (adv.enabled && (adv.restoreChannels || adv.activeChannel?.enabled) && !meta.guildId) {
      try {
        const info = (await axios.post(`${API}/discord/channel-info`, { token: curToken, channelId: curChannelId, isBot })).data;
        if (info.ok) {
          channelMetaRef.current[t.id] = { name: info.name, guildId: info.guildId, lastSeen: info.lastMessageId };
        }
      } catch {}
    }

    if (adv.enabled && adv.startDelaySec > 0) {
      append(`⏱ [${tag}] opóźnienie startu ${fmtDur(adv.startDelaySec * 1000)}`);
      await wait(adv.startDelaySec * 1000);
      if (stopRef.current) {
        append(`■ [${tag}] zatrzymano`);
        return;
      }
    }
    do {
      if (stopRef.current) break;
      if (adv.enabled && adv.failGroup && adv.group && stoppedGroupsRef.current.has(adv.group)) {
        append(`■ [${tag}] grupa "${adv.group}" zatrzymana przez błąd innej kampanii`);
        break;
      }
      // Stop After — message count / time limit
      if (adv.enabled && adv.stopAfterCount > 0 && sendIdx >= adv.stopAfterCount) {
        append(`■ [${tag}] osiągnięto limit ${adv.stopAfterCount} wiadomości — koniec kampanii`);
        break;
      }
      if (adv.enabled && adv.stopAfterMin > 0 && Date.now() - startedAt >= adv.stopAfterMin * 60000) {
        append(`■ [${tag}] osiągnięto limit czasu ${adv.stopAfterMin} min — koniec kampanii`);
        break;
      }
      const qMs = quietWaitMs(quiet);
      if (qMs > 0) {
        append(`☾ [${tag}] godziny ciszy — pauza ${fmtDur(qMs)} (symulacja snu)`);
        await wait(qMs);
        if (stopRef.current) break;
      }
      // Anti-detect: occasional idle break (~5% chance) to mimic distraction.
      if (mask.idleBreaks && Math.random() < 0.05) {
        const pause = randInt(120, 180) * 1000;
        append(`☕ [${tag}] losowa przerwa (symulacja rozproszenia) ${fmtDur(pause)}`);
        await wait(pause);
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
      // Active Channel Sending — only send if enough new messages since last send.
      if (adv.enabled && adv.activeChannel?.enabled) {
        try {
          const m = channelMetaRef.current[t.id] || {};
          const resM = (await axios.post(`${API}/discord/messages`, { token: curToken, channelId: curChannelId, afterId: m.lastSeen, limit: 50, isBot })).data;
          if (resM.ok) {
            const fresh = resM.messages.filter((mm) => mm.authorId && !mm.bot);
            if (resM.messages.length) channelMetaRef.current[t.id] = { ...m, lastSeen: resM.messages[resM.messages.length - 1].id };
            if (fresh.length < Math.max(1, adv.activeChannel.minNew)) {
              append(`⏭ [${tag}] aktywny kanał: ${fresh.length}/${adv.activeChannel.minNew} nowych — pomijam ten cykl`);
              if (!t.loop || stopRef.current) break;
              await wait(userMode ? humanDelayMs(Math.max(1000, t.delaySec * 1000), effJitter) : jitter(Math.max(1000, t.delaySec * 1000), effJitter));
              continue;
            }
          }
        } catch {}
      }
      // Anti-detect: random skip.
      if (mask.randomSkipPct > 0 && Math.random() * 100 < mask.randomSkipPct) {
        append(`⏭ [${tag}] losowe pominięcie wysyłki (maskowanie)`);
        if (!t.loop || stopRef.current) break;
        await wait(userMode ? humanDelayMs(Math.max(1000, t.delaySec * 1000) * adaptiveMult, effJitter) : jitter(Math.max(1000, t.delaySec * 1000) * adaptiveMult, effJitter));
        continue;
      }
      const realContent = resolveVars(resolveSpintax(t.message), sendIdx + 1);
      // Anti-detect: human typo + self-correct (~25% of sends when enabled).
      const doTypo = mask.typos && realContent.trim().length >= 4 && Math.random() < 0.25;
      const content = doTypo ? makeTypo(realContent) : realContent;
      const tMs = preset.humanTyping ? humanTypingMs(content || t.embed.description) : 1500;
      if (preset.typing)
        append(`✎ [${tag}] pisanie (~${(tMs / 1000).toFixed(1)}s)${userBurst ? " · z pauzami" : ""}`);
      try {
        let res = (
          await axios.post(`${API}/discord/send`, {
            token: curToken,
            channelId: curChannelId,
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
        // Auto-restore deleted/recreated channel on "Unknown Channel".
        if (!res.ok && adv.enabled && adv.restoreChannels && (res.status === 404 || /10003|Unknown Channel/i.test(String(res.error)))) {
          const m = channelMetaRef.current[t.id] || {};
          if (m.guildId && m.name) {
            const fc = (await axios.post(`${API}/discord/find-channel`, { token: curToken, guildId: m.guildId, name: m.name, isBot })).data;
            if (fc.ok && fc.found) {
              curChannelId = fc.channelId;
              updateTarget(t.id, { channelId: fc.channelId });
              append(`↺ [${tag}] odtworzono kanał "${m.name}" → ${fc.channelId.slice(-6)} — ponawiam`);
              res = (await axios.post(`${API}/discord/send`, { token: curToken, channelId: curChannelId, message: content, isBot, typing: false, profileSeed: userMode ? seed : undefined })).data;
            }
          }
        }
        if (res.ok) {
          setStats((s) => ({ ...s, sent: s.sent + 1 }));
          append(`✓ [${tag}] wysłano${doTypo ? " (z literówką — poprawiam)" : ""}`);
          recordHistory(tag, curChannelId, content || `[embed] ${t.embed.title}`, true, res.status);
          bumpDaily(tag);
          // Self-correct the typo via edit after a short, human pause.
          if (doTypo && res.id) {
            const fix = Math.round(randInt(2, 5) * 1000);
            setTimeout(() => {
              axios
                .post(`${API}/discord/edit`, { token: curToken, channelId: curChannelId, messageId: res.id, message: realContent, isBot, profileSeed: userMode ? seed : undefined })
                .then((r) => r.data?.ok && append(`✎ [${tag}] poprawiono literówkę`))
                .catch(() => {});
            }, fix);
          } else {
            scheduleAutoActions(t, seed, res.id, tag, curToken, curChannelId);
          }
          if (adaptiveMult > 1) adaptiveMult = Math.max(1, adaptiveMult * 0.85);
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
          recordHistory(tag, curChannelId, content || `[embed] ${t.embed.title}`, false, res.status, res.error);
          if (res.status === 1015) {
            const backoff = Math.max(300000, Math.round((res.retryAfter ?? 300) * 1000));
            append(`⏸ [${tag}] cloudflare 1015 · przerwa ${(backoff / 1000).toFixed(0)}s (długi backoff)`);
            if (adv.enabled && adv.adaptive) {
              adaptiveMult = Math.min(5, adaptiveMult * 1.5);
              append(`↑ [${tag}] adaptacja: interwał ×${adaptiveMult.toFixed(2)}`);
            }
            await wait(backoff);
          } else if (res.status === 429) {
            const backoff = Math.max(30000, Math.round((res.retryAfter ?? 30) * 1000));
            append(`⏸ [${tag}] limit żądań · przerwa ${(backoff / 1000).toFixed(0)}s`);
            if (adv.enabled && adv.adaptive) {
              adaptiveMult = Math.min(5, adaptiveMult * 1.4);
              append(`↑ [${tag}] adaptacja: interwał ×${adaptiveMult.toFixed(2)}`);
            }
            await wait(backoff);
          } else if (res.status === 401 || res.status === 403) {
            // Try backup accounts before giving up.
            const next = await trySwitchBackup(tag, triedBackups);
            if (next) {
              curToken = next;
              continue; // retry with backup token
            }
            append(`■ [${tag}] token nieprawidłowy i brak ważnych kont zapasowych`);
            fireAlert(tag, res.status, res.error);
            if (adv.enabled && adv.failGroup && adv.group) {
              stoppedGroupsRef.current.add(adv.group);
              append(`■ [${tag}] zatrzymuję grupę "${adv.group}"`);
              return;
            }
            stopRef.current = true;
            for (const a of Array.from(waitAbortersRef.current)) a();
            return;
          }
        }
      } catch (err) {
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        append(`✗ [${tag}] ${err instanceof Error ? err.message : String(err)}`);
        recordHistory(tag, curChannelId, content, false, 0, err instanceof Error ? err.message : String(err));
      }
      if (!t.loop || stopRef.current) break;
      let baseMs = Math.max(1000, t.delaySec * 1000) * adaptiveMult;
      if (userMode && preset.warmup && sendIdx < 3) {
        baseMs = Math.round(baseMs * [2.4, 1.7, 1.3][sendIdx]);
        append(`↷ [${tag}] rozgrzewka tempa ×${[2.4, 1.7, 1.3][sendIdx]}`);
      }
      const w = userMode ? humanDelayMs(baseMs, effJitter) : jitter(baseMs, effJitter);
      append(`⏱ [${tag}] następna za ${(w / 1000).toFixed(1)}s`);
      await wait(w);
    } while (t.loop && !stopRef.current);
    append(`■ [${tag}] zatrzymano`);
  };

  // Background pollers for auxiliary USER-token features (run alongside campaigns).
  const runAuxiliaries = async (t) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const adv = t.advanced || {};
    if (!adv.enabled || isBot) return;
    const meta = channelMetaRef.current[t.id] || {};
    let guildId = meta.guildId;
    if ((adv.autoReact?.enabled || adv.forumReply?.enabled) && !guildId) {
      try {
        const info = (await axios.post(`${API}/discord/channel-info`, { token, channelId: t.channelId, isBot })).data;
        if (info.ok) {
          guildId = info.guildId;
          channelMetaRef.current[t.id] = { ...meta, name: info.name, guildId: info.guildId };
        }
      } catch {}
    }
    let lastReact = null;
    const seenThreads = new Set();
    while (!stopRef.current) {
      await wait(randInt(20, 40) * 1000);
      if (stopRef.current) break;
      // Auto-accept friend requests
      if (adv.autoAcceptFriends) {
        try {
          const r = (await axios.post(`${API}/discord/relationships`, { token, accept: true })).data;
          if (r.ok && r.accepted?.length) append(`🤝 [${tag}] zaakceptowano zaproszenia: ${r.accepted.join(", ")}`);
        } catch {}
      }
      // Auto-react to new messages in the channel
      if (adv.autoReact?.enabled && adv.autoReact.emojis.trim()) {
        try {
          const rm = (await axios.post(`${API}/discord/messages`, { token, channelId: t.channelId, afterId: lastReact, limit: 20, isBot })).data;
          if (rm.ok && rm.messages.length) {
            lastReact = rm.messages[rm.messages.length - 1].id;
            const emojis = adv.autoReact.emojis.split(",").map((e) => e.trim()).filter(Boolean);
            for (const mm of rm.messages.filter((x) => !x.bot)) {
              const emoji = emojis[Math.floor(Math.random() * emojis.length)];
              await axios.post(`${API}/discord/react`, { token, channelId: t.channelId, messageId: mm.id, emoji, isBot }).catch(() => {});
              await wait(randInt(1, 3) * 1000);
            }
            if (rm.messages.length) append(`❤ [${tag}] auto-reakcje na ${rm.messages.length} wiadomości`);
          }
        } catch {}
      }
      // Forum auto-reply to new threads
      if (adv.forumReply?.enabled && adv.forumReply.parentId.trim() && adv.forumReply.message.trim() && guildId) {
        try {
          const at = (await axios.post(`${API}/discord/active-threads`, { token, guildId, parentId: adv.forumReply.parentId.trim(), isBot })).data;
          if (at.ok) {
            for (const th of at.threads) {
              if (seenThreads.has(th.id)) continue;
              seenThreads.add(th.id);
              const msg = resolveVars(resolveSpintax(adv.forumReply.message), 1);
              await axios.post(`${API}/discord/send`, { token, channelId: th.id, message: msg, isBot, typing: true, typingMs: 1500, profileSeed: seed0(t) }).catch(() => {});
              append(`💬 [${tag}] odpowiedź na nowy wątek forum "${th.name}"`);
              await wait(randInt(3, 8) * 1000);
            }
          }
        } catch {}
      }
    }
  };

  const seed0 = (t) => Math.abs((t.id || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 1000000;

  const runScheduled = async (t, staggerMs = 0) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const seed = Math.floor(Math.random() * 10 ** 6);
    // Anti-detect: initial human reaction delay + optional shuffle stagger
    // (avoids firing all channels in perfect parallel at t=0).
    const initial = randInt(2, 8) * 1000 + staggerMs;
    if (initial > 0) {
      append(`⏱ [${tag}] wejście za ${fmtDur(initial)} (naturalne rozłożenie startu)`);
      await wait(initial);
      if (stopRef.current) return;
    }
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
    let valid = targets.filter(
      (t) => t.channelId.trim() && (t.message.trim() || embedHasContent(t.embed))
    );
    if (valid.length === 0) {
      append("✗ DODAJ PRZYNAJMNIEJ JEDNĄ KAMPANIĘ");
      setActiveTab("logs");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    stoppedGroupsRef.current = new Set();
    channelMetaRef.current = {};
    setStats({ sent: 0, failed: 0 });
    // Anti-detect: randomize campaign order so channels aren't hit in a fixed sequence.
    if (mask.shuffle) {
      valid = [...valid].sort(() => Math.random() - 0.5);
      append("🔀 maskowanie: losowa kolejność kanałów");
    }
    const maskBits = [
      mask.shuffle && "losowa kolejność",
      mask.randomSkipPct > 0 && `pomijanie ${mask.randomSkipPct}%`,
      mask.idleBreaks && "przerwy idle",
      mask.typos && "literówki+autokorekta",
    ].filter(Boolean);
    append(`▶ start ${valid.length} kampanii · tryb: ${STEALTH[stealth].label}${isBot ? "" : " · USER stealth+"}${maskBits.length ? " · maska: " + maskBits.join(", ") : ""}`);
    if (backups.length) append(`⇄ ${backups.length} kont(o) zapasowe gotowe do przełączenia`);
    setActiveTab("logs");
    try {
      const jobs = valid.map((t, i) => runScheduled(t, mask.shuffle ? randInt(0, 4) * 1000 * i : 0));
      const aux = valid.map((t) => runAuxiliaries(t));
      await Promise.all([...jobs, ...aux]);
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

              <Panel label={`00b // biblioteka szablonów [${templates.length}]`}>
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  zapisz gotowe treści wiadomości (ze spintaxem i zmiennymi) i wstawiaj je jednym
                  kliknięciem w dowolnej kampanii — przez przycisk <span className="text-accent">▾ szablon</span>.
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <input
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="nazwa szablonu"
                    data-testid="template-name-input"
                    className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  />
                  <input
                    value={tplText}
                    onChange={(e) => setTplText(e.target.value)}
                    placeholder="treść szablonu, np. {Hej|Cześć}! Nowy event {dzien}!"
                    data-testid="template-text-input"
                    className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={onSaveTemplate}
                    data-testid="template-save-btn"
                    className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                  >
                    <BookMarked className="size-3" /> zapisz
                  </Button>
                </div>
                {templates.length > 0 && (
                  <div className="mt-3 space-y-1.5" data-testid="template-list">
                    {templates.map((tpl) => (
                      <div
                        key={tpl.id}
                        data-testid={`template-item-${tpl.id}`}
                        className="flex items-center gap-2 rounded-sm border border-border bg-input/40 px-2.5 py-1.5"
                      >
                        <span className="w-28 shrink-0 truncate font-mono text-[11px] font-bold text-primary">{tpl.name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{tpl.text}</span>
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => onDeleteTemplate(tpl.id)}
                          data-testid={`template-delete-${tpl.id}`}
                          className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-destructive hover:underline"
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
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
                <div className="space-y-2">
                  {targets.map((t, i) => {
                    const adv = t.advanced || {};
                    const advCount = adv.enabled
                      ? [adv.restoreChannels, adv.failGroup, adv.activeChannel?.enabled, adv.autoAcceptFriends, adv.autoReact?.enabled, adv.forumReply?.enabled, adv.autoEdit?.enabled, adv.autoDelete?.enabled, adv.adaptive, adv.startDelaySec > 0, adv.jitterPct > 0, adv.stopAfterCount > 0, adv.stopAfterMin > 0].filter(Boolean).length
                      : 0;
                    return (
                      <div
                        key={t.id}
                        data-testid={`campaign-card-${t.id}`}
                        className="group flex items-center gap-3 rounded-md border border-border bg-background/40 p-3 transition-colors hover:border-primary/40"
                      >
                        <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                          #{String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-mono text-sm font-semibold text-foreground">
                              {t.name.trim() || "kampania"}
                            </span>
                            {adv.enabled && advCount > 0 && (
                              <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent">
                                zaawansowane ·{advCount}
                              </span>
                            )}
                            {t.embed.enabled && (
                              <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                                embed
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {t.channelId.trim() ? `kanał …${t.channelId.slice(-6)}` : "brak kanału"} · {t.delaySec}s ·{" "}
                            {t.loop ? "pętla" : "raz"} · {scheduleLabel(t.schedule)}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-foreground/70">
                            {t.message.trim() || (t.embed.enabled ? "[embed]" : "— brak treści —")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() => setEditTargetId(t.id)}
                            data-testid={`campaign-edit-btn-${t.id}`}
                            className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                          >
                            <Pencil className="size-3" /> edytuj
                          </Button>
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() => duplicateTarget(t.id)}
                            data-testid={`campaign-duplicate-btn-${t.id}`}
                            title="Duplikuj kampanię"
                            className="rounded-sm border border-border px-2 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-primary"
                          >
                            <CopyPlus className="size-3" />
                          </Button>
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() => removeTarget(t.id)}
                            disabled={targets.length === 1}
                            data-testid={`campaign-remove-btn-${t.id}`}
                            className="rounded-sm border border-destructive/40 px-2 py-1.5 font-mono text-[10px] text-destructive transition-colors disabled:opacity-30"
                          >
                            ✕
                          </Button>
                        </div>
                      </div>
                    );
                  })}
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
                <label className="mt-3 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={alerts.logs}
                    onChange={(e) => setAlerts({ ...alerts, logs: e.target.checked })}
                    className="accent-primary"
                    data-testid="alert-logs-toggle"
                  />
                  wysyłaj dziennik aktywności na webhook (zdarzenia ✓/✗ w czasie rzeczywistym)
                </label>
              </Panel>

              <Panel label={`05 // konta zapasowe [${backups.length}]`}>
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  jeśli bieżące konto zostanie unieważnione (401/403), kampania automatycznie przełącza
                  się na kolejne ważne konto zapasowe wg kolejności. tokeny zapisują się{" "}
                  <span className="text-warn">tylko w Twojej przeglądarce</span> — nigdy w bazie.
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <input
                    value={backupLabel}
                    onChange={(e) => setBackupLabel(e.target.value)}
                    placeholder="etykieta (np. konto #2)"
                    data-testid="backup-label-input"
                    className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  />
                  <input
                    type="password"
                    value={backupToken}
                    onChange={(e) => setBackupToken(e.target.value)}
                    placeholder="token konta zapasowego"
                    data-testid="backup-token-input"
                    className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={onAddBackup}
                    data-testid="backup-add-btn"
                    className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                  >
                    <Users className="size-3" /> dodaj
                  </Button>
                </div>
                {backups.length > 0 && (
                  <div className="mt-3 space-y-1.5" data-testid="backup-list">
                    {backups.map((b, i) => (
                      <div key={b.id} data-testid={`backup-item-${b.id}`} className="flex items-center gap-2 rounded-sm border border-border bg-input/40 px-2.5 py-1.5">
                        <span className="font-mono text-[10px] text-primary">#{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{b.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">••••{b.token.slice(-4)}</span>
                        <Button variant="outline" type="button" onClick={() => onDeleteBackup(b.id)} data-testid={`backup-delete-${b.id}`} className="font-mono text-[10px] uppercase tracking-wider text-destructive hover:underline">
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel label="06 // maskowanie anti-detekcja">
                <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  dodatkowe zachowania utrudniające oznaczenie konta jako spam. łączą się z trybem
                  stealth, godzinami ciszy i przerwami kawowymi. (sieć/proxy/TLS są poza przeglądarką —
                  dla pełnej izolacji używaj proxy rezydencjalnego per konto.)
                </p>
                <div className="space-y-1">
                  <MaskRow
                    title="losowa kolejność kanałów"
                    desc="startuje kampanie w losowej kolejności i rozkłada starty w czasie — zamiast równoległego strzału w t=0"
                    checked={mask.shuffle}
                    onChange={(v) => setMask({ ...mask, shuffle: v })}
                    testId="mask-shuffle"
                  />
                  <MaskRow
                    title="losowe pomijanie wysyłek"
                    desc="z zadanym prawdopodobieństwem pomija pojedynczą wysyłkę (ludzie nie są idealnie regularni)"
                    checked={mask.randomSkipPct > 0}
                    onChange={(v) => setMask({ ...mask, randomSkipPct: v ? 15 : 0 })}
                    testId="mask-skip"
                    extra={
                      mask.randomSkipPct > 0 && (
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} max={90} value={mask.randomSkipPct} onChange={(e) => setMask({ ...mask, randomSkipPct: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} data-testid="mask-skip-pct" className="w-14 rounded-sm border border-border bg-input px-2 py-1 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary" />
                          <span className="font-mono text-[9px] text-muted-foreground">%</span>
                        </div>
                      )
                    }
                  />
                  <MaskRow
                    title="symulacja obecności (przerwy idle)"
                    desc="losowe krótkie przerwy ~2-3 min (5% szans na cykl) jak odejście od klawiatury"
                    checked={mask.idleBreaks}
                    onChange={(v) => setMask({ ...mask, idleBreaks: v })}
                    testId="mask-idle"
                  />
                  <MaskRow
                    title="losowe literówki + autokorekta"
                    desc="czasem wysyła wiadomość z drobną literówką, a po 2-5 s poprawia ją edycją — bardzo ludzkie"
                    checked={mask.typos}
                    onChange={(v) => setMask({ ...mask, typos: v })}
                    testId="mask-typos"
                  />
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

      <AiComposeModal
        open={!!aiTargetId}
        current={targets.find((t) => t.id === aiTargetId)?.message || ""}
        onClose={() => setAiTargetId(null)}
        onApply={(text, replace) => aiTargetId && onAiApply(aiTargetId, text, replace)}
      />

      {editTargetId && (
        <EditCampaignModal
          target={targets.find((t) => t.id === editTargetId)}
          updateTarget={updateTarget}
          templates={templates}
          onInsertTemplate={insertTemplate}
          onOpenAi={(id) => setAiTargetId(id)}
          onClose={() => setEditTargetId(null)}
        />
      )}
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

function MaskRow({ title, desc, checked, onChange, testId, extra }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/60 py-2.5" data-testid={`${testId}-row`}>
      <div className="min-w-0">
        <span className="font-mono text-xs font-bold text-foreground">{title}</span>
        <p className="mt-0.5 font-mono text-[10px] leading-snug text-muted-foreground">{desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          data-testid={testId}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
    </div>
  );
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
