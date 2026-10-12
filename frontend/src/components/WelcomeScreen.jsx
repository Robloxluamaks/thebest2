import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const BOOT_LINES = [
  "» inicjalizacja GHOST.SEND v2.0",
  "» łączenie: discord api v10 ......... OK",
  "» moduły: kampanie · stealth · emoji . OK",
  "» status: GOTOWY",
];

const MARQUEE = [
  "kampanie równoległe",
  "tryb stealth",
  "custom emoji",
  "harmonogram wysyłek",
  "warianty spintax",
  "historia wysyłek",
];

export function GhostMark({ className = "" }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        d="M32 10c-9.9 0-17 7.2-17 17.5V52l5.7-4.8L26.4 52l5.6-4.8L37.6 52l5.7-4.8L49 52V27.5C49 17.2 41.9 10 32 10z"
        fill="currentColor"
      />
      <circle cx="25.5" cy="28.5" r="3.2" fill="#040a11" />
      <circle cx="38.5" cy="28.5" r="3.2" fill="#040a11" />
      <rect x="26" y="37" width="12" height="2.4" rx="1.2" fill="#040a11" opacity="0.55" />
    </svg>
  );
}

export function WelcomeScreen({ onEnter }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2200);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      data-testid="welcome-screen"
      exit={{ y: "-100%" }}
      transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background"
    >
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-50" />
      <div className="scanlines pointer-events-none absolute inset-0" />

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
      >
        <motion.div
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <GhostMark className="h-24 w-24 text-primary drop-shadow-[0_0_25px_hsl(126_85%_65%/0.6)]" />
        </motion.div>
      </motion.div>

      <h1 className="mt-6 font-display text-6xl font-bold tracking-tight sm:text-7xl">
        <span className="block overflow-hidden pb-1">
          <motion.span
            initial={{ y: "110%" }}
            animate={{ y: "0%" }}
            transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="block text-glow"
          >
            GHOST<span className="text-primary">.</span>SEND
          </motion.span>
        </span>
      </h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.6 }}
        className="mt-3 font-mono text-xs uppercase tracking-[0.35em] text-muted-foreground"
      >
        sygnał//wychodzący
      </motion.p>

      <div
        data-testid="boot-log"
        className="mt-8 h-20 font-mono text-[11px] leading-relaxed text-muted-foreground"
      >
        {BOOT_LINES.map((l, i) => (
          <motion.div
            key={l}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.4 }}
          >
            <span className={i === BOOT_LINES.length - 1 ? "text-primary" : ""}>{l}</span>
          </motion.div>
        ))}
      </div>

      <motion.button
        data-testid="enter-panel-btn"
        onClick={onEnter}
        initial={{ opacity: 0, y: 10 }}
        animate={ready ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="group relative mt-6 overflow-hidden rounded-md border border-primary bg-primary/10 px-8 py-3 font-mono text-sm font-bold uppercase tracking-[0.25em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        <span className="relative z-10">▶ wejdź do panelu</span>
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
      </motion.button>

      <div className="absolute bottom-0 left-0 right-0 overflow-hidden border-t border-border/60 py-2 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
        <div className="animate-marquee flex w-max gap-8 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
          {[...MARQUEE, ...MARQUEE, ...MARQUEE].map((t, i) => (
            <span key={i} className="flex items-center gap-8">
              <span>{t}</span>
              <span className="text-primary/50">//</span>
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
