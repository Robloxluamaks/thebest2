import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { DAY_LABELS } from "@/lib/ghost";
import { X, Sparkles, Hash, SlidersHorizontal, ShieldCheck, Crown } from "lucide-react";

function Toggle({ checked, onChange, testId }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Row({ title, desc, pro, children, testId }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/60 py-3" data-testid={testId}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-foreground">{title}</span>
          {pro && (
            <span className="flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-accent">
              <Crown className="size-2.5" />{pro}
            </span>
          )}
        </div>
        {desc && <p className="mt-0.5 font-mono text-[10px] leading-snug text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary";

export function EditCampaignModal({ target, updateTarget, onClose, templates, onInsertTemplate, onOpenAi }) {
  if (!target) return null;
  const t = target;
  const adv = t.advanced;
  const up = (patch) => updateTarget(t.id, patch);
  const upAdv = (patch) => up({ advanced: { ...adv, ...patch } });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm"
        data-testid="edit-campaign-modal"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="panel-shadow my-6 w-full max-w-2xl rounded-md border border-primary/40 bg-card"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
            <div>
              <h3 className="font-display text-xl font-bold">Edytuj kampanię</h3>
              <p className="font-mono text-[10px] text-muted-foreground">skonfiguruj, kiedy i co wysyła ta kampania.</p>
            </div>
            <button type="button" onClick={onClose} data-testid="edit-campaign-close" className="rounded-sm border border-border bg-secondary/60 p-1.5 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-5 p-5">
            {/* BASIC */}
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">nazwa kampanii</label>
              <input value={t.name} onChange={(e) => up({ name: e.target.value })} data-testid="edit-name" className={`mt-1 ${inputCls}`} placeholder="nazwa kampanii" />
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">id kanału</label>
              <div className="mt-1 flex items-center gap-2">
                <Hash className="size-4 shrink-0 text-primary" />
                <input value={t.channelId} onChange={(e) => up({ channelId: e.target.value })} data-testid="edit-channel" className={inputCls} placeholder="np. 123456789012345678" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">wiadomość · {"{a|b}"} + zmienne</label>
                <div className="flex items-center gap-1.5">
                  {templates.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => { const tpl = templates.find((x) => x.id === e.target.value); if (tpl) onInsertTemplate(t.id, tpl.text); e.target.value = ""; }}
                      data-testid="edit-template-select"
                      className="rounded-sm border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-muted-foreground outline-none focus:border-primary"
                    >
                      <option value="">▾ szablon</option>
                      {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                    </select>
                  )}
                  <Button type="button" variant="outline" onClick={() => onOpenAi(t.id)} data-testid="edit-ai-btn" className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/20">
                    <Sparkles className="size-3" /> AI
                  </Button>
                </div>
              </div>
              <textarea value={t.message} onChange={(e) => up({ message: e.target.value })} rows={3} data-testid="edit-message" className={`mt-1 resize-none ${inputCls}`} placeholder="np. {Cześć|Hej}! Dziś {dzien}, wiadomość nr {licznik}" />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">opóźnienie (s)</label>
                <input type="number" min={1} value={t.delaySec} onChange={(e) => up({ delaySec: Math.max(1, Number(e.target.value) || 1) })} data-testid="edit-delay" className={`mt-1 ${inputCls}`} />
              </div>
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">limit/dzień (0=bez)</label>
                <input type="number" min={0} value={t.maxPerDay} onChange={(e) => up({ maxPerDay: Math.max(0, Number(e.target.value) || 0) })} data-testid="edit-dailylimit" className={`mt-1 ${inputCls}`} />
              </div>
              <label className="flex items-end gap-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <input type="checkbox" checked={t.loop} onChange={(e) => up({ loop: e.target.checked })} className="accent-primary" data-testid="edit-loop" />
                pętla
              </label>
            </div>

            {/* SCHEDULE */}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">start kampanii</label>
                <select value={t.schedule.mode} onChange={(e) => up({ schedule: { ...t.schedule, mode: e.target.value } })} data-testid="edit-schedule-mode" className={`mt-1 ${inputCls}`}>
                  <option value="now">natychmiast</option>
                  <option value="at">o godzinie</option>
                  <option value="weekly">w wybranych dniach tygodnia</option>
                </select>
              </div>
              {t.schedule.mode !== "now" && (
                <div>
                  <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">godzina</label>
                  <input type="time" value={t.schedule.time} onChange={(e) => up({ schedule: { ...t.schedule, time: e.target.value } })} data-testid="edit-schedule-time" className={`mt-1 ${inputCls}`} />
                </div>
              )}
            </div>
            {t.schedule.mode === "weekly" && (
              <div className="flex flex-wrap gap-1">
                {DAY_LABELS.map(([label, val]) => {
                  const active = t.schedule.days.includes(val);
                  return (
                    <Button variant="outline" key={val} type="button"
                      onClick={() => up({ schedule: { ...t.schedule, days: active ? t.schedule.days.filter((d) => d !== val) : [...t.schedule.days, val] } })}
                      className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${active ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-input text-muted-foreground"}`}>
                      {label}
                    </Button>
                  );
                })}
              </div>
            )}

            {/* EMBED */}
            <div className="rounded-sm border border-border bg-input/30 p-3">
              <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <input type="checkbox" checked={t.embed.enabled} onChange={(e) => up({ embed: { ...t.embed, enabled: e.target.checked } })} className="accent-primary" data-testid="edit-embed-toggle" />
                embed (tytuł, opis, kolor, obrazek)
              </label>
              {t.embed.enabled && (
                <div className="mt-2 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input value={t.embed.title} onChange={(e) => up({ embed: { ...t.embed, title: e.target.value } })} data-testid="edit-embed-title" className={inputCls} placeholder="tytuł embedu" />
                    <input type="color" value={t.embed.color} onChange={(e) => up({ embed: { ...t.embed, color: e.target.value } })} data-testid="edit-embed-color" className="h-8 w-12 cursor-pointer rounded-sm border border-border bg-input p-0.5" />
                  </div>
                  <textarea value={t.embed.description} onChange={(e) => up({ embed: { ...t.embed, description: e.target.value } })} rows={2} data-testid="edit-embed-desc" className={`resize-none ${inputCls}`} placeholder="opis embedu" />
                  <input value={t.embed.imageUrl} onChange={(e) => up({ embed: { ...t.embed, imageUrl: e.target.value } })} data-testid="edit-embed-image" className={inputCls} placeholder="url obrazka (https://...)" />
                </div>
              )}
            </div>

            {/* ADVANCED */}
            <div className="rounded-md border border-accent/30 bg-accent/5 p-4" data-testid="edit-advanced">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-accent">
                  <SlidersHorizontal className="size-4" /> ustawienia zaawansowane
                </h4>
                <Toggle checked={adv.enabled} onChange={(v) => upAdv({ enabled: v })} testId="edit-adv-enabled" />
              </div>

              {adv.enabled && (
                <div className="mt-2" data-testid="edit-advanced-body">
                  <Row title="Message Jitter (%)" desc="Dodaje do X% dodatkowego, losowego opóźnienia (0 = auto wg trybu stealth).">
                    <input type="number" min={0} max={100} value={adv.jitterPct} onChange={(e) => upAdv({ jitterPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} data-testid="edit-adv-jitter" className="w-24 rounded-sm border border-border bg-input px-2 py-1.5 text-right font-mono text-xs text-foreground outline-none focus:border-primary" />
                  </Row>
                  <Row title="Start Delay (sekundy)" desc="Opóźnia tylko pierwszą wysyłkę po starcie tej kampanii.">
                    <input type="number" min={0} value={adv.startDelaySec} onChange={(e) => upAdv({ startDelaySec: Math.max(0, Number(e.target.value) || 0) })} data-testid="edit-adv-startdelay" className="w-24 rounded-sm border border-border bg-input px-2 py-1.5 text-right font-mono text-xs text-foreground outline-none focus:border-primary" />
                  </Row>
                  <Row title="Adaptacyjna ochrona przed limitem" desc="Automatycznie zwiększa odstęp po trafieniu w rate limit, by uniknąć kolejnych." testId="edit-adv-adaptive-row">
                    <Toggle checked={adv.adaptive} onChange={(v) => upAdv({ adaptive: v })} testId="edit-adv-adaptive" />
                  </Row>
                  <Row title="Auto-przywracanie usuniętych kanałów" desc="Gdy kanał zostanie usunięty i odtworzony na tym serwerze, znajdziemy najnowszy kanał o tej samej nazwie i podmienimy go w kampanii." pro="PLUS/PRO/ULTRA">
                    <Toggle checked={adv.restoreChannels} onChange={(v) => upAdv({ restoreChannels: v })} testId="edit-adv-restore" />
                  </Row>
                  <Row title="Grupowe zatrzymanie kampanii" desc="Gdy ta kampania padnie (nieważny token), zatrzyma też inne działające kampanie w tej samej grupie." pro="PLUS/PRO/ULTRA">
                    <div className="flex items-center gap-2">
                      <input value={adv.group} onChange={(e) => upAdv({ group: e.target.value })} data-testid="edit-adv-group" placeholder="grupa" className="w-24 rounded-sm border border-border bg-input px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary" />
                      <Toggle checked={adv.failGroup} onChange={(v) => upAdv({ failGroup: v })} testId="edit-adv-failgroup" />
                    </div>
                  </Row>
                  <Row title="Stop After" desc="Zatrzymaj kampanię automatycznie po liczbie wiadomości lub limicie czasu.">
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} value={adv.stopAfterCount} onChange={(e) => upAdv({ stopAfterCount: Math.max(0, Number(e.target.value) || 0) })} data-testid="edit-adv-stopcount" title="liczba wiadomości" className="w-16 rounded-sm border border-border bg-input px-2 py-1 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary" />
                      <span className="font-mono text-[9px] text-muted-foreground">szt</span>
                      <input type="number" min={0} value={adv.stopAfterMin} onChange={(e) => upAdv({ stopAfterMin: Math.max(0, Number(e.target.value) || 0) })} data-testid="edit-adv-stopmin" title="minuty" className="w-16 rounded-sm border border-border bg-input px-2 py-1 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary" />
                      <span className="font-mono text-[9px] text-muted-foreground">min</span>
                    </div>
                  </Row>
                  <Row title="Aktywny kanał" desc="Przy każdym cyklu wysyłaj tylko, gdy w kanale pojawiło się wystarczająco nowych wiadomości od ostatniej wysyłki." pro="PRO/ULTRA">
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} value={adv.activeChannel.minNew} onChange={(e) => upAdv({ activeChannel: { ...adv.activeChannel, minNew: Math.max(1, Number(e.target.value) || 1) } })} data-testid="edit-adv-active-min" className="w-16 rounded-sm border border-border bg-input px-2 py-1 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary" />
                      <Toggle checked={adv.activeChannel.enabled} onChange={(v) => upAdv({ activeChannel: { ...adv.activeChannel, enabled: v } })} testId="edit-adv-active" />
                    </div>
                  </Row>
                  <Row title="Auto-akceptacja zaproszeń do znajomych" desc="Akceptuj przychodzące zaproszenia do znajomych dla konta Discord tej kampanii." pro="PRO/ULTRA">
                    <Toggle checked={adv.autoAcceptFriends} onChange={(v) => upAdv({ autoAcceptFriends: v })} testId="edit-adv-friends" />
                  </Row>
                  <Row title="Forum — auto-odpowiedź" desc="Odpowiadaj automatycznie, gdy w kanale forum pojawi się nowy publiczny wątek." pro="PRO/ULTRA">
                    <Toggle checked={adv.forumReply.enabled} onChange={(v) => upAdv({ forumReply: { ...adv.forumReply, enabled: v } })} testId="edit-adv-forum" />
                  </Row>
                  {adv.forumReply.enabled && (
                    <div className="grid gap-2 pb-3 sm:grid-cols-[10rem_1fr]">
                      <input value={adv.forumReply.parentId} onChange={(e) => upAdv({ forumReply: { ...adv.forumReply, parentId: e.target.value } })} data-testid="edit-adv-forum-parent" placeholder="id kanału forum" className={inputCls} />
                      <input value={adv.forumReply.message} onChange={(e) => upAdv({ forumReply: { ...adv.forumReply, message: e.target.value } })} data-testid="edit-adv-forum-msg" placeholder="treść odpowiedzi (działa {a|b})" className={inputCls} />
                    </div>
                  )}
                  <Row title="Auto-reakcje" desc="Dodawaj reakcje emoji na nowe wiadomości w kanale (po przecinku; unicode lub nazwa:id)." pro="PRO/ULTRA">
                    <Toggle checked={adv.autoReact.enabled} onChange={(v) => upAdv({ autoReact: { ...adv.autoReact, enabled: v } })} testId="edit-adv-react" />
                  </Row>
                  {adv.autoReact.enabled && (
                    <input value={adv.autoReact.emojis} onChange={(e) => upAdv({ autoReact: { ...adv.autoReact, emojis: e.target.value } })} data-testid="edit-adv-react-emojis" placeholder="🔥, 👍, pepe:123456789012345678" className={`mb-3 ${inputCls}`} />
                  )}
                  <Row title="Auto-edycja wysłanych wiadomości" desc="Wyślij wiadomość, a po czasie podmień jej treść." pro="PRO/ULTRA">
                    <Toggle checked={adv.autoEdit.enabled} onChange={(v) => upAdv({ autoEdit: { ...adv.autoEdit, enabled: v } })} testId="edit-adv-autoedit" />
                  </Row>
                  {adv.autoEdit.enabled && (
                    <div className="grid gap-2 pb-3 sm:grid-cols-[6rem_1fr]">
                      <input type="number" min={2} value={adv.autoEdit.delaySec} onChange={(e) => upAdv({ autoEdit: { ...adv.autoEdit, delaySec: Math.max(2, Number(e.target.value) || 2) } })} data-testid="edit-adv-autoedit-delay" title="po ilu sekundach" className={inputCls} />
                      <input value={adv.autoEdit.text} onChange={(e) => upAdv({ autoEdit: { ...adv.autoEdit, text: e.target.value } })} data-testid="edit-adv-autoedit-text" placeholder="nowa treść po edycji" className={inputCls} />
                    </div>
                  )}
                  <Row title="Auto-usuwanie wysłanych wiadomości" desc="Ustaw timer usunięcia każdej wiadomości." pro="PRO/ULTRA">
                    <div className="flex items-center gap-2">
                      <input type="number" min={2} value={adv.autoDelete.afterSec} onChange={(e) => upAdv({ autoDelete: { ...adv.autoDelete, afterSec: Math.max(2, Number(e.target.value) || 2) } })} data-testid="edit-adv-autodelete-sec" className="w-20 rounded-sm border border-border bg-input px-2 py-1 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary" />
                      <span className="font-mono text-[9px] text-muted-foreground">sek</span>
                      <Toggle checked={adv.autoDelete.enabled} onChange={(v) => upAdv({ autoDelete: { ...adv.autoDelete, enabled: v } })} testId="edit-adv-autodelete" />
                    </div>
                  </Row>
                  <p className="mt-3 flex items-start gap-1.5 font-mono text-[9px] leading-snug text-warn">
                    <ShieldCheck className="mt-0.5 size-3 shrink-0" />
                    opcje akceptacji znajomych, forum, reakcji, aktywnego kanału i kont zapasowych działają z tokenem USER i łamią regulamin Discorda — używasz na własne ryzyko.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 px-5 py-4 backdrop-blur">
            <Button type="button" variant="outline" onClick={onClose} data-testid="edit-done-btn" className="rounded-md border border-primary bg-primary/10 px-6 py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary hover:text-primary-foreground">
              gotowe
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
