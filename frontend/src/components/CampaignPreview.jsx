import { Hash, MessageSquare, Clock, Repeat2, Bot, CalendarClock, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { hasSpintax, hasVars, resolveSpintax, resolveVars, scheduleLabel } from "@/lib/ghost";

export function CampaignPreview({ targets }) {
  return (
    <div className="space-y-6" data-testid="campaign-preview">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <MessageSquare className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Podgląd wiadomości</h2>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{targets.length} kampanii</span>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {targets.map((target, index) => (
          <motion.article
            key={target.id}
            data-testid={`preview-card-${target.id}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="min-w-0 overflow-hidden rounded-md border border-border bg-card"
          >
            <header className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3">
              <Hash className="size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold">{target.name.trim() || `Kampania ${index + 1}`}</h3>
                <p className="break-all font-mono text-[11px] text-muted-foreground">{target.channelId.trim() || "Nie wybrano kanału"}</p>
              </div>
            </header>
            <div className="flex min-h-40 gap-3 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">GHOST.SEND<span className="font-mono text-[10px] font-normal text-primary">PODGLĄD</span></div>
                <p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere] ${target.message.trim() ? "text-foreground" : "text-muted-foreground"}`}>
                  {target.message.trim() ? target.message : "Brak wiadomości"}
                </p>
                {(hasSpintax(target.message) || hasVars(target.message)) && (
                  <p
                    data-testid={`preview-variant-${target.id}`}
                    className="mt-2 whitespace-pre-wrap break-words border-l-2 border-accent/50 pl-2 text-sm leading-relaxed text-accent [overflow-wrap:anywhere]"
                  >
                    przykładowa wysyłka: {resolveVars(resolveSpintax(target.message), 1)}
                  </p>
                )}
              </div>
            </div>
            <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border px-4 py-3 font-mono text-xs text-muted-foreground">
              <span className="flex items-center gap-2"><Clock className="size-3.5" />{target.delaySec} s · minimum</span>
              <span className="flex items-center gap-2"><Repeat2 className="size-3.5" />{target.loop ? "Powtarzanie" : "Jednorazowo"}</span>
              <span className="flex items-center gap-2"><CalendarClock className="size-3.5" />{scheduleLabel(target.schedule)}</span>
              {hasSpintax(target.message) && (
                <span className="flex items-center gap-2 text-accent"><Sparkles className="size-3.5" />spintax</span>
              )}
            </footer>
          </motion.article>
        ))}
      </div>
    </div>
  );
}
