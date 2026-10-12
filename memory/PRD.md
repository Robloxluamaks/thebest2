# PRD — GHOST.SEND

## Oryginalne zlecenie
"Zbuduj stronę docelową: tutaj masz moja gotowa strone bedziemy ja rozbudowywac" — użytkownik dostarczył paczkę zip z aplikacją GHOST.SEND (Discord Auto Sender zbudowaną w Lovable, TanStack Start + Supabase) i wybrał pełne przeniesienie aplikacji do środowiska Emergent z myślą o dalszej rozbudowie. Język: polski. Strona statyczna, bez zbierania danych odwiedzających.

## Architektura
- Frontend: React (CRA/craco), Tailwind 3, shadcn/ui, framer-motion, lenis — port `src/routes/index.tsx` z paczki Lovable do `/app/frontend/src/App.js` + `src/components/CampaignPreview.jsx`
- Backend: FastAPI `/app/backend/server.py` — port funkcji serwerowych `discord.functions.ts`:
  - `POST /api/discord/send` — wysyłka wiadomości przez Discord API v10 (bot/user token, typing indicator z re-triggerem co ~9s, nonce, rotacja fingerprintów desktop klienta, rozwiązywanie :emoji:, obsługa 429/1015 Cloudflare z retryAfter)
  - `POST /api/discord/emojis` — skan serwerów tokena i pobranie custom emoji
- Baza: MongoDB podpięta (MONGO_URL), obecnie nieużywana — tokeny i profile są celowo TYLKO w localStorage przeglądarki (prywatność)
- Tokeny nigdy nie trafiają do bazy; backend tylko przekazuje żądania do Discord API

## Persony
- Właściciel serwera Discord automatyzujący ogłoszenia przez oficjalny token bota
- Power-user z wieloma kampaniami i zapisanymi profilami konfiguracji

## Wymagania kluczowe (stałe)
- Kampanie równoległe: wiele kanałów, każdy z własną wiadomością, opóźnieniem i pętlą
- 3 poziomy stealth (Szybki / Zbalansowany / Max Stealth) z typing indicator i jitter
- Podgląd wiadomości na żywo, dziennik sesji, profile w localStorage (eksport/import JSON)
- Ostrzeżenie ToS o tokenach użytkownika

## Zaimplementowane
- 2026-10-12: pełny port aplikacji (zakładki Kampanie/Podgląd/Konfiguracje/Dziennik), UI po polsku, neonowo-terminalowy motyw z oryginału, animowane wejście hero (masked reveal), marquee statusowe, lenis smooth scroll, logo-duch SVG jako favicon, data-testid na wszystkich elementach interaktywnych. Zweryfikowane: walidacja bez tokena, wysyłka z fałszywym tokenem (401 w dzienniku, licznik błędów), zapis/wczytanie profilu, podgląd na żywo, layout 375/768/1366px.
- 2026-10-12: kinetyczny ekran powitalny (GhostMark, boot log, CTA, exit slide-up; sessionStorage `ghost-send:entered`); historia wysyłek w MongoDB (`send_history`, endpointy POST/GET/DELETE /api/history + /api/history/stats) z zakładką Statystyki (sumy, wykres 7 dni, wg kampanii, lista wpisów); spintax `{a|b|c}` losowany przy każdej wysyłce + podgląd wariantu; harmonogram startu per kampania (natychmiast / o godzinie / dni tygodnia, cyklicznie przy pętli wyłączonej). Lib: `src/lib/ghost.js`. Zweryfikowane e2e: welcome→panel, zapis historii przy 401, statystyki, log "start zaplanowany za 4h 13m", abort.
- 2026-10-12: wzmocniony stealth dla tokenów USER — stały odcisk klienta na kampanię (profileSeed → 5 profili: Win/Mac/Linux desktop + Chrome web, z nagłówkami sec-ch-ua), pisanie z pauzami (typingBurst w Max Stealth), opóźnienia gaussowskie, przerwy kawowe (balanced: co 12–20 wysyłek 2–5 min; max: co 8–14, 3–8 min), rozgrzewka tempa pierwszych 3 wysyłek (×2.4/1.7/1.3), godziny ciszy (globalne, localStorage `ghost-send:quiet`). Zweryfikowane: burst 3s + 401, log "godziny ciszy — pauza 7h 3m", "pisanie · z pauzami", abort przerywa ciszę.
- 2026-10-12: alerty o błędach krytycznych (401/403) — dźwięk WebAudio + webhook przez relay backendowy `POST /api/alert/relay` (omija CORS przeglądarki; zweryfikowane dostarczenie payloadu do webhook.site); zmienne w treści `{data} {czas} {dzien} {licznik} {losowa:min-max}` (ghost.js `resolveVars`, podgląd pokazuje rozwiązany przykład); auto-odpowiedzi DM — nowa zakładka Auto DM (forceMount, nasłuch działa przy ukrytej zakładce): endpointy `/api/discord/dms` + `/api/discord/dm/messages`, baseline bez odpowiadania na stare wiadomości, tryb ustalonej wiadomości lub AI (`/api/ai/reply`, emergentintegrations + EMERGENT_LLM_KEY, modele gpt-5.4/mini/nano, persona konfigurowalna), odpowiedzi trafiają do historii jako "auto-dm". Zweryfikowane: AI wygenerowało naturalną odpowiedź PL, nasłuch z fake tokenem → 401 → alert → stop.
- 2026-10-12: tryb REGUŁY w Auto DM (domyślny) — darmowe, nielimitowane auto-odpowiedzi bez AI: lista reguł słowa-klucze→odpowiedź (`matchRule` w ghost.js, testowane jednostkowo), odpowiedź domyślna opcjonalna, spintax i zmienne działają w regułach. Poprawka: zakładki z forceMount ukrywane przez `data-[state=inactive]:hidden` w ui/tabs.jsx (Radix nie nadaje atrybutu hidden przy forceMount).

- 2026-10-12 (v2): paczki "ciekawych funkcji". (1) Asystent treści AI — przycisk AI na każdej kampanii otwiera modal z trybami Generuj/Ulepsz/Spintax, wybór tonu, zastąp/dopisz; backend `POST /api/ai/compose` (emergentintegrations, gpt-5.4, EMERGENT_LLM_KEY). (2) Biblioteka szablonów w zakładce Konfiguracje (localStorage `ghost-send:templates`), wstawianie przez select „▾ szablon" przy kampanii. (3) Heatmapa aktywności godzina×dzień w Statystykach; backend `GET /api/history/heatmap` (grid[7][24], peak, total). (4) Ustawienia zaawansowane per kampania: start delay, jitter% (0=auto), adaptacyjna ochrona przed limitem (zwiększa interwał przy 429/1015), stop po X wiadomościach / X minutach, auto-edycja wysłanej wiadomości (`POST /api/discord/edit`), auto-usuwanie (`POST /api/discord/delete`); `/api/discord/send` zwraca teraz `id` wiadomości. (5) Webhook logi — toggle wysyła zdarzenia dziennika ✓/✗ na webhook przez relay. Zweryfikowane: backend 9/12 pytest (Discord proxy edit/delete/send bez 500, 401 przy fake tokenie, 400 przy złych ID; heatmapa zwraca siatkę), modal AI e2e (generate zwrócił polski tekst), szablony zapis+wstawienie, rozwijanie ustawień zaawansowanych + toggle auto-edit/auto-delete. UWAGA: AI zależy od salda klucza uniwersalnego Emergent — przy wyczerpaniu `/api/ai/compose` zwraca błąd budżetu (doładowanie: Profil → Zarządzaj planem → Universal Key).

- 2026-10-12 (v2.1): pełne opcje zaawansowane w stylu autosender.lol. Kampanie to teraz kompaktowe karty + przycisk "edytuj" otwierający modal **Edytuj kampanię** (EditCampaignModal) z pełną edycją + sekcją Ustawień zaawansowanych (przełączniki): Message Jitter %, Start Delay, Adaptacyjna ochrona przed limitem, Auto-przywracanie usuniętych kanałów, Grupowe zatrzymanie (pole grupy), Stop After (liczba/min), Aktywny kanał (próg nowych wiadomości), Auto-akceptacja zaproszeń, Forum auto-odpowiedź, Auto-reakcje, Auto-edycja, Auto-usuwanie. **Konta zapasowe** (panel 05, localStorage `ghost-send:backups`) — przy 401/403 kampania waliduje i przełącza się na kolejne ważne konto zamiast stopu. **Maskowanie anti-detekcja** (panel 06, `ghost-send:mask`): losowa kolejność + stagger startu, losowe pomijanie wysyłek (%), przerwy idle (5% szans), literówki+autokorekta (wysyła z literówką, poprawia edycją po 2-5 s), plus naturalne wejście 2-8 s. Backend: 6 nowych endpointów REST (`/discord/channel-info`, `find-channel`, `messages`, `react`, `relationships`, `active-threads`), `send` zwraca `id`. Research anti-detect (web): losowy jitter+przerwy, typing indicator, unikanie idealnej równoległości/sekwencji, reagowanie na retry-after, przełączanie z nieważnych tokenów — wdrożone; proxy/TLS są poza przeglądarką (dla pełnej izolacji: proxy rezydencjalne per konto — poza zakresem). Zweryfikowane: backend 23/23 pytest (fake token→401, złe ID→400, nigdy 500); frontend 100% (modal, konta zapasowe, maskowanie, persystencja po reload przez lazy useState). Opcje USER-token łamią ToS — użytkownik zaakceptował ryzyko.

## Backlog
- P0: nic krytycznego
- P1: powiadomienie dźwiękowe/webhook przy błędzie krytycznym, szablony wiadomości ze zmiennymi (np. {user})
- P2: tryb podglądu embedów, wykres godzinowy aktywności (recharts), eksport historii do CSV

## Kolejne kroki
- Rozbudowa wg wskazówek użytkownika
