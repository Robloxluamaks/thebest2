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

## Backlog
- P0: nic krytycznego
- P1: harmonogram kampanii (start o godzinie / cron), losowe warianty wiadomości (spintax), historia wysyłek w MongoDB
- P2: tryb podglądu embedów, statystyki wykresów (recharts), powiadomienie dźwiękowe przy błędzie

## Kolejne kroki
- Rozbudowa wg wskazówek użytkownika
