import { useState } from "react";
import axios from "axios";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Sparkles, Wand2, Shuffle, X, Check } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TONES = ["ekscytujący", "neutralny", "profesjonalny", "luźny", "tajemniczy", "pilny"];

export function AiComposeModal({ open, current, onClose, onApply }) {
  const [mode, setMode] = useState("generate");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("ekscytujący");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setLoading(true);
    setError("");
    setResult("");
    try {
      const res = (
        await axios.post(`${API}/ai/compose`, {
          mode,
          brief,
          current: current || "",
          tone,
          model: "gpt-5.4",
          variants: 3,
        })
      ).data;
      if (res.ok) setResult(res.text);
      else setError(res.error || "błąd AI");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const apply = (replace) => {
    onApply(result, replace);
    setResult("");
    onClose();
  };

  const MODES = [
    { k: "generate", label: "Generuj", icon: Sparkles, hint: "napisz nowe ogłoszenie z briefu" },
    { k: "improve", label: "Ulepsz", icon: Wand2, hint: "popraw obecną wiadomość" },
    { k: "spintax", label: "Spintax", icon: Shuffle, hint: "dodaj warianty {a|b|c}" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          data-testid="ai-compose-modal"
          data-lenis-prevent
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="panel-shadow max-h-[90vh] w-full max-w-lg overflow-auto rounded-md border border-primary/40 bg-card p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
                <Sparkles className="size-4" /> asystent treści AI
              </h3>
              <button
                type="button"
                onClick={onClose}
                data-testid="ai-compose-close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => {
                const active = mode === m.k;
                const Icon = m.icon;
                return (
                  <Button
                    key={m.k}
                    type="button"
                    variant="outline"
                    onClick={() => { setMode(m.k); setResult(""); setError(""); }}
                    data-testid={`ai-mode-${m.k}`}
                    className={`h-auto flex-col items-start gap-0 rounded-md border p-2.5 text-left transition-all ${
                      active ? "border-primary bg-primary/10" : "border-border bg-input/50 hover:border-primary/40"
                    }`}
                  >
                    <span className={`flex items-center gap-1.5 font-mono text-xs font-bold ${active ? "text-primary" : "text-foreground"}`}>
                      <Icon className="size-3.5" />{m.label}
                    </span>
                    <span className="mt-0.5 whitespace-normal font-mono text-[9px] leading-snug text-muted-foreground">
                      {m.hint}
                    </span>
                  </Button>
                );
              })}
            </div>

            {mode === "generate" ? (
              <div className="mt-4">
                <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  brief ogłoszenia
                </label>
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={3}
                  data-testid="ai-brief-input"
                  className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  placeholder="np. event w piątek 20:00, turniej z nagrodami, wbijajcie wszyscy"
                />
              </div>
            ) : (
              <div className="mt-4">
                <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  obecna wiadomość
                </label>
                <p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-input/50 px-2 py-1.5 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                  {current?.trim() || <span className="text-muted-foreground">— pusta — wpisz najpierw wiadomość w kampanii —</span>}
                </p>
              </div>
            )}

            {mode !== "spintax" && (
              <div className="mt-3">
                <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  ton
                </label>
                <div className="mt-1 flex flex-wrap gap-1.5" data-testid="ai-tone-row">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTone(t)}
                      data-testid={`ai-tone-${t}`}
                      className={`rounded-sm border px-2 py-1 font-mono text-[10px] lowercase transition-colors ${
                        tone === t ? "border-accent/60 bg-accent/10 text-accent" : "border-border bg-input text-muted-foreground hover:border-accent/40"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={run}
              disabled={loading}
              data-testid="ai-generate-btn"
              className="mt-4 w-full rounded-md border border-primary bg-primary/10 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="size-3.5" />
              {loading ? "generuję..." : "generuj z AI"}
            </Button>

            {error && (
              <p data-testid="ai-error" className="mt-3 font-mono text-[10px] text-destructive">
                ✗ {error}
              </p>
            )}

            {result && (
              <div className="mt-4" data-testid="ai-result">
                <label className="block font-mono text-[9px] uppercase tracking-wider text-primary">
                  propozycja AI
                </label>
                <textarea
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  rows={4}
                  data-testid="ai-result-text"
                  className="mt-1 w-full resize-none rounded-sm border border-primary/40 bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => apply(true)}
                    data-testid="ai-apply-replace"
                    className="flex-1 rounded-sm border border-primary/40 bg-primary/10 py-2 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20"
                  >
                    <Check className="size-3.5" /> zastąp wiadomość
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => apply(false)}
                    data-testid="ai-apply-append"
                    className="flex-1 rounded-sm border border-accent/40 bg-accent/10 py-2 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/20"
                  >
                    + dopisz
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
