import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { matchRule, resolveSpintax, resolveVars } from "@/lib/ghost";
import { MessageSquareReply, Bot, Sparkles, Square, Play, Zap, Plus, X } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const AUTODM_KEY = "ghost-send:autodm";

const AI_MODELS = [
  ["gpt-5.4", "gpt-5.4 · domyślny"],
  ["gpt-5.4-mini", "gpt-5.4-mini · szybszy"],
  ["gpt-5-mini", "gpt-5-mini · oszczędny"],
  ["gpt-5-nano", "gpt-5-nano · najtańszy"],
];

const DEFAULTS = {
  interval: 20,
  mode: "rules",
  fixedMessage: "",
  instruction: "",
  model: "gpt-5.4",
  rules: [{ keywords: "", reply: "" }],
  fallback: "",
};

export function AutoDmPanel({ token, isBot, onLog, onAlert, onRecord }) {
  const [cfg, setCfg] = useState(() => {
    try {
      const raw = localStorage.getItem(AUTODM_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULTS;
  });
  const [running, setRunning] = useState(false);
  const [replies, setReplies] = useState(0);
  const [me, setMe] = useState(null);
  const stopRef = useRef(false);
  const abortersRef = useRef(new Set());
  const seenRef = useRef({});
  const baselineRef = useRef(false);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    try {
      localStorage.setItem(AUTODM_KEY, JSON.stringify(cfg));
    } catch {}
  }, [cfg]);

  const wait = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        abortersRef.current.delete(abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(t);
        abortersRef.current.delete(abort);
        resolve();
      };
      abortersRef.current.add(abort);
    });

  const stopAll = () => {
    stopRef.current = true;
    for (const a of Array.from(abortersRef.current)) a();
  };

  const buildReply = (incoming, who, history) => {
    const c = cfgRef.current;
    if (c.mode === "rules") {
      const text = incoming.map((m) => m.content).join(" ");
      const rule = matchRule(c.rules, text);
      if (rule) {
        onLog(`⚡ [auto-dm] reguła "${rule.keywords.split(",")[0].trim()}" dla ${who}`);
        return resolveVars(resolveSpintax(rule.reply), replies + 1);
      }
      if (c.fallback.trim()) return resolveVars(resolveSpintax(c.fallback), replies + 1);
      onLog(`· [auto-dm] brak reguły dla ${who} — pomijam`);
      return "";
    }
    if (c.mode === "fixed") {
      return resolveVars(resolveSpintax(c.fixedMessage), replies + 1);
    }
    return null; // AI — handled async by caller
  };

  const pollOnce = async () => {
    const res = (await axios.post(`${API}/discord/dms`, { token, isBot })).data;
    if (!res.ok) {
      onLog(`✗ [auto-dm] ${res.status}: ${String(res.error).slice(0, 80)}`);
      if (res.status === 401 || res.status === 403) {
        onAlert("auto-dm", res.status, res.error);
        stopRef.current = true;
      }
      return;
    }
    setMe(res.me.username);
    if (!baselineRef.current) {
      for (const ch of res.channels) seenRef.current[ch.id] = ch.lastMessageId;
      baselineRef.current = true;
      onLog(`✓ [auto-dm] nasłuch aktywny jako ${res.me.username} · ${res.channels.length} kanałów DM`);
      return;
    }
    for (const ch of res.channels) {
      if (stopRef.current) return;
      const lastSeen = seenRef.current[ch.id];
      if (ch.lastMessageId === lastSeen) continue;
      const mr = (
        await axios.post(`${API}/discord/dm/messages`, {
          token,
          isBot,
          channelId: ch.id,
          afterId: lastSeen || undefined,
        })
      ).data;
      seenRef.current[ch.id] = ch.lastMessageId;
      if (!mr.ok) continue;
      const incoming = mr.messages.filter((m) => m.authorId !== res.me.id);
      if (!incoming.length) continue;
      const who = ch.name || ch.id;
      onLog(`✉ [auto-dm] ${who}: ${incoming.length} nowa(e) wiadomość(i)`);

      let reply = buildReply(incoming, who);
      if (reply === null) {
        const c = cfgRef.current;
        const history = mr.messages.slice(-8).map((m) => ({
          role: m.authorId === res.me.id ? "assistant" : "user",
          content: m.content,
        }));
        const ai = (
          await axios.post(`${API}/ai/reply`, {
            instruction: c.instruction,
            model: c.model,
            history,
            channelKey: ch.id,
          })
        ).data;
        if (!ai.ok) {
          onLog(`✗ [auto-dm] AI: ${String(ai.error).slice(0, 90)}`);
          continue;
        }
        reply = ai.reply;
      }
      if (!reply || !reply.trim()) continue;

      await wait(1500 + Math.random() * 3500);
      if (stopRef.current) return;
      const sr = (
        await axios.post(`${API}/discord/send`, {
          token,
          channelId: ch.id,
          message: reply,
          isBot,
          typing: true,
          typingMs: Math.min(8000, 800 + reply.length * 60),
          typingBurst: !isBot,
          emojiMap: undefined,
        })
      ).data;
      if (sr.ok) {
        setReplies((r) => r + 1);
        onLog(`✓ [auto-dm] → ${who}: ${reply.slice(0, 70)}`);
        onRecord("auto-dm", ch.id, reply, true, sr.status);
      } else {
        onLog(`✗ [auto-dm] wysyłka → ${sr.status}: ${String(sr.error).slice(0, 70)}`);
        onRecord("auto-dm", ch.id, reply, false, sr.status, sr.error);
        if (sr.status === 401 || sr.status === 403) {
          onAlert("auto-dm", sr.status, sr.error);
          stopRef.current = true;
          return;
        }
      }
    }
  };

  const loop = async () => {
    while (!stopRef.current) {
      try {
        await pollOnce();
      } catch (err) {
        onLog(`✗ [auto-dm] ${err instanceof Error ? err.message : String(err)}`);
      }
      if (stopRef.current) break;
      await wait(Math.max(10, cfgRef.current.interval) * 1000);
    }
    setRunning(false);
    onLog("■ [auto-dm] nasłuch zatrzymany");
  };

  const onStart = () => {
    if (running) return;
    if (!token.trim()) {
      onLog("✗ [auto-dm] WYMAGANY TOKEN");
      return;
    }
    if (cfg.mode === "fixed" && !cfg.fixedMessage.trim()) {
      onLog("✗ [auto-dm] ustal treść auto-odpowiedzi albo zmień tryb");
      return;
    }
    if (
      cfg.mode === "rules" &&
      !cfg.rules.some((r) => r.keywords.trim() && r.reply.trim()) &&
      !cfg.fallback.trim()
    ) {
      onLog("✗ [auto-dm] dodaj regułę (słowa-klucze + odpowiedź) albo odpowiedź domyślną");
      return;
    }
    stopRef.current = false;
    baselineRef.current = false;
    seenRef.current = {};
    setReplies(0);
    setRunning(true);
    const modeLabel =
      cfg.mode === "rules" ? "reguły · 0 kredytów" : cfg.mode === "fixed" ? "ustalona wiadomość" : `AI (${cfg.model})`;
    onLog(`▶ [auto-dm] start nasłuchu · co ${Math.max(10, cfg.interval)}s · tryb: ${modeLabel}`);
    loop();
  };

  const setRule = (i, patch) =>
    setCfg({ ...cfg, rules: cfg.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = () => setCfg({ ...cfg, rules: [...cfg.rules, { keywords: "", reply: "" }] });
  const removeRule = (i) =>
    setCfg({ ...cfg, rules: cfg.rules.length > 1 ? cfg.rules.filter((_, j) => j !== i) : cfg.rules });

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="panel-shadow rounded-md border border-border bg-card/60 p-5 backdrop-blur-sm"
      data-testid="autodm-panel"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
          05 // auto-odpowiedzi DM
        </h2>
        <div
          data-testid="autodm-status"
          className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider ${
            running ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"
          }`}
        >
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          {running ? `nasłuch · ${replies} odp.` : "wyłączony"}
        </div>
      </div>

      <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        odpytuje Twoje skrzynki DM i odpisuje na nowe wiadomości. pierwszy cykl ustala punkt
        startowy — nie odpowiada na stare wiadomości. nie zamykaj karty, gdy nasłuch działa.
        {isBot
          ? " bot widzi tylko DM prowadzone z botem."
          : " tryb USER widzi wszystkie Twoje DM."}
        {me && <span className="text-accent"> zalogowano: {me}</span>}
      </p>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            odstęp sprawdzania (s, min 10)
          </label>
          <input
            type="number"
            min={10}
            value={cfg.interval}
            onChange={(e) => setCfg({ ...cfg, interval: Math.max(10, Number(e.target.value) || 10) })}
            disabled={running}
            data-testid="autodm-interval-input"
            className="mt-1 w-28 rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            tryb odpowiedzi
          </label>
          <div className="mt-1 flex gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setCfg({ ...cfg, mode: "rules" })}
              disabled={running}
              data-testid="autodm-mode-rules"
              className={`flex-1 rounded-sm border px-2 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                cfg.mode === "rules"
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-input text-muted-foreground hover:border-primary/30"
              }`}
            >
              <Zap className="size-3.5" /> reguły · darmowe
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => setCfg({ ...cfg, mode: "fixed" })}
              disabled={running}
              data-testid="autodm-mode-fixed"
              className={`flex-1 rounded-sm border px-2 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                cfg.mode === "fixed"
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-input text-muted-foreground hover:border-primary/30"
              }`}
            >
              <Bot className="size-3.5" /> ustalona
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => setCfg({ ...cfg, mode: "ai" })}
              disabled={running}
              data-testid="autodm-mode-ai"
              className={`flex-1 rounded-sm border px-2 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                cfg.mode === "ai"
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border bg-input text-muted-foreground hover:border-accent/30"
              }`}
            >
              <Sparkles className="size-3.5" /> AI
            </Button>
          </div>
        </div>
      </div>

      {cfg.mode === "rules" && (
        <div className="mt-3" data-testid="autodm-rules-editor">
          <div className="mb-1 flex items-center justify-between">
            <label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              reguły: słowa-klucze (po przecinku) → odpowiedź
            </label>
            <Button
              variant="outline"
              type="button"
              onClick={addRule}
              disabled={running}
              data-testid="autodm-add-rule-btn"
              className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20"
            >
              <Plus className="size-3" /> reguła
            </Button>
          </div>
          <div className="space-y-2">
            {cfg.rules.map((r, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  value={r.keywords}
                  onChange={(e) => setRule(i, { keywords: e.target.value })}
                  disabled={running}
                  data-testid={`autodm-rule-keywords-${i}`}
                  className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                  placeholder="np. trening, kiedy, godzina"
                />
                <input
                  value={r.reply}
                  onChange={(e) => setRule(i, { reply: e.target.value })}
                  disabled={running}
                  data-testid={`autodm-rule-reply-${i}`}
                  className="rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                  placeholder="np. Trening w piątek o 18:00!"
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => removeRule(i)}
                  disabled={running || cfg.rules.length === 1}
                  data-testid={`autodm-rule-remove-${i}`}
                  className="rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[10px] text-destructive hover:bg-destructive/20 disabled:opacity-40"
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
          <label className="mt-3 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            odpowiedź domyślna (gdy żadna reguła nie pasuje; puste = nie odpowiadaj)
          </label>
          <input
            value={cfg.fallback}
            onChange={(e) => setCfg({ ...cfg, fallback: e.target.value })}
            disabled={running}
            data-testid="autodm-fallback-input"
            className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
            placeholder="np. Napisz konkretniej, odezwę się wieczorem."
          />
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-primary/80">
            ⚡ reguły działają lokalnie — nielimitowane, zero kredytów AI, zero opóźnienia. w
            odpowiedziach działają {"{a|b}"} i zmienne.
          </p>
        </div>
      )}

      {cfg.mode === "fixed" && (
        <div className="mt-3">
          <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            treść auto-odpowiedzi <span className="text-accent">· działa {"{a|b}"} i zmienne</span>
          </label>
          <textarea
            value={cfg.fixedMessage}
            onChange={(e) => setCfg({ ...cfg, fixedMessage: e.target.value })}
            rows={2}
            disabled={running}
            data-testid="autodm-fixed-input"
            className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
            placeholder="np. {Cześć|Hej}! Jestem zajęty, odezwę się później."
          />
        </div>
      )}

      {cfg.mode === "ai" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              instrukcja dla AI (persona, styl, czego unikać)
            </label>
            <textarea
              value={cfg.instruction}
              onChange={(e) => setCfg({ ...cfg, instruction: e.target.value })}
              rows={2}
              disabled={running}
              data-testid="autodm-instruction-input"
              className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
              placeholder="np. Odpisuj luźno, po polsku. Jeśli ktoś pyta o spotkanie — zaproponuj piątek 18:00."
            />
          </div>
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              model
            </label>
            <select
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              disabled={running}
              data-testid="autodm-model-select"
              className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50 sm:w-44"
            >
              {AI_MODELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {!running ? (
          <Button
            variant="outline"
            type="button"
            onClick={onStart}
            data-testid="autodm-start-btn"
            className="flex-1 rounded-md border border-primary bg-primary/10 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Play className="size-3.5" /> start nasłuchu
          </Button>
        ) : (
          <Button
            variant="outline"
            type="button"
            onClick={stopAll}
            data-testid="autodm-stop-btn"
            className="flex-1 rounded-md border border-destructive bg-destructive/10 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
          >
            <Square className="size-3.5" /> stop nasłuchu
          </Button>
        )}
      </div>
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        <MessageSquareReply className="mr-1 inline size-3.5 text-accent" />
        tryb AI używa klucza uniwersalnego Emergent (obciąża saldo klucza) — do prostych pytań
        wystarczy tryb reguł, który jest darmowy. każda auto-odpowiedź trafia do historii jako
        „auto-dm".
      </p>
    </motion.section>
  );
}
