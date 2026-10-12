from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import time
import base64
import random
import asyncio
import uuid
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timezone, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

DISCORD_API = "https://discord.com/api/v10"

# Pool of realistic desktop/browser client fingerprints (user tokens only).
# The frontend pins one profile per campaign via profileSeed — a real client
# never changes its User-Agent between requests.
CLIENT_PROFILES = [
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9042 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
        "props": {
            "os": "Windows",
            "browser": "Discord Client",
            "release_channel": "stable",
            "client_version": "1.0.9042",
            "os_version": "10.0.19045",
            "os_arch": "x64",
            "system_locale": "en-US",
            "client_build_number": 320472,
            "client_event_source": None,
        },
        "extra": {},
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.312 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
        "props": {
            "os": "Mac OS X",
            "browser": "Discord Client",
            "release_channel": "stable",
            "client_version": "0.0.312",
            "os_version": "23.5.0",
            "os_arch": "arm64",
            "system_locale": "en-US",
            "client_build_number": 320472,
            "client_event_source": None,
        },
        "extra": {},
    },
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "props": {
            "os": "Windows",
            "browser": "Chrome",
            "browser_version": "126.0.0.0",
            "release_channel": "stable",
            "os_version": "10.0.19045",
            "os_arch": "x64",
            "system_locale": "en-US",
            "client_build_number": 320472,
            "client_event_source": None,
        },
        "extra": {
            "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        },
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "props": {
            "os": "Mac OS X",
            "browser": "Chrome",
            "browser_version": "126.0.0.0",
            "release_channel": "stable",
            "os_version": "14.5.0",
            "os_arch": "x64",
            "system_locale": "en-US",
            "client_build_number": 320472,
            "client_event_source": None,
        },
        "extra": {
            "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
        },
    },
    {
        "ua": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.61 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36",
        "props": {
            "os": "Linux",
            "browser": "Discord Client",
            "release_channel": "stable",
            "client_version": "0.0.61",
            "os_version": "",
            "os_arch": "x64",
            "system_locale": "en-US",
            "client_build_number": 320472,
            "client_event_source": None,
        },
        "extra": {},
    },
]


class EmojiEntry(BaseModel):
    id: str
    animated: bool = False
    guild: Optional[str] = None


class EmbedInput(BaseModel):
    title: str = ""
    description: str = ""
    color: str = "#5af169"
    imageUrl: str = ""


class SendInput(BaseModel):
    token: str
    channelId: str
    message: str = ""
    isBot: bool = True
    typing: bool = False
    typingMs: int = 1500
    typingBurst: bool = False
    profileSeed: Optional[int] = None
    emojiMap: Optional[Dict[str, EmojiEntry]] = None
    embed: Optional[EmbedInput] = None


class EmojiFetchInput(BaseModel):
    token: str
    isBot: bool = True


def build_headers(token: str, is_bot: bool, channel_id: Optional[str] = None, profile_seed: Optional[int] = None) -> dict:
    headers = {
        "Authorization": f"Bot {token}" if is_bot else token,
        "Content-Type": "application/json",
    }
    if is_bot:
        headers["User-Agent"] = "DiscordBot (https://ghost.send, 1.0)"
    else:
        idx = (profile_seed if profile_seed is not None else random.randint(0, 10**6)) % len(CLIENT_PROFILES)
        profile = CLIENT_PROFILES[idx]
        headers["User-Agent"] = profile["ua"]
        headers["X-Super-Properties"] = base64.b64encode(
            json.dumps(profile["props"]).encode()
        ).decode()
        headers["X-Discord-Locale"] = "en-US"
        headers["X-Debug-Options"] = "bugReporterEnabled"
        headers["Accept"] = "*/*"
        headers["Accept-Language"] = "en-US,en;q=0.9"
        headers["Sec-Fetch-Dest"] = "empty"
        headers["Sec-Fetch-Mode"] = "cors"
        headers["Sec-Fetch-Site"] = "same-origin"
        headers["Origin"] = "https://discord.com"
        headers.update(profile.get("extra", {}))
        if channel_id:
            headers["Referer"] = f"https://discord.com/channels/@me/{channel_id}"
    return headers


@api_router.get("/")
async def root():
    return {"message": "GHOST.SEND API"}


@api_router.post("/discord/send")
async def send_discord_message(data: SendInput):
    has_embed = bool(
        data.embed
        and (data.embed.title.strip() or data.embed.description.strip() or data.embed.imageUrl.strip())
    )
    if not data.token or not data.channelId or (not data.message.strip() and not has_embed):
        return {"ok": False, "status": 400, "error": "Missing fields"}
    if len(data.message) > 2000:
        return {"ok": False, "status": 400, "error": "Message too long (max 2000)"}
    if not re.fullmatch(r"\d{5,25}", data.channelId):
        return {"ok": False, "status": 400, "error": "Invalid channel ID"}

    content = data.message
    if data.emojiMap:
        def repl(m):
            e = data.emojiMap.get(m.group(1))
            if not e:
                return m.group(0)
            return f"<{'a' if e.animated else ''}:{m.group(1)}:{e.id}>"
        content = re.sub(r":([a-zA-Z0-9_]{2,32}):", repl, content)

    headers = build_headers(data.token, data.isBot, data.channelId, data.profileSeed)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as http:
            if data.typing:
                typing_wait_ms = max(400, min(15000, data.typingMs))
                target = typing_wait_ms / 1000.0
                typing_url = f"{DISCORD_API}/channels/{data.channelId}/typing"
                if data.typingBurst and not data.isBot:
                    # Human burst pattern: type, stop to think (indicator off),
                    # type again — instead of one continuous typing indicator.
                    elapsed = 0.0
                    on = True
                    try:
                        await http.post(typing_url, headers=headers)
                    except Exception:
                        pass
                    while elapsed < target:
                        chunk = random.uniform(0.9, 2.6) if on else random.uniform(0.5, 1.4)
                        chunk = min(chunk, target - elapsed, 9.0)
                        await asyncio.sleep(chunk)
                        elapsed += chunk
                        if elapsed >= target:
                            break
                        if on:
                            on = False
                        else:
                            on = True
                            try:
                                await http.post(typing_url, headers=headers)
                            except Exception:
                                pass
                else:
                    try:
                        await http.post(typing_url, headers=headers)
                    except Exception:
                        pass
                    elapsed = 0.0
                    while elapsed < target:
                        chunk = min(9.0, target - elapsed)
                        await asyncio.sleep(chunk)
                        elapsed += chunk
                        if elapsed < target:
                            try:
                                await http.post(typing_url, headers=headers)
                            except Exception:
                                pass

            body = {"content": content, "tts": False, "flags": 0}
            if has_embed:
                e = {}
                if data.embed.title.strip():
                    e["title"] = data.embed.title[:256]
                if data.embed.description.strip():
                    e["description"] = data.embed.description[:4096]
                cm = re.fullmatch(r"#?([0-9a-fA-F]{6})", data.embed.color.strip())
                if cm:
                    e["color"] = int(cm.group(1), 16)
                if re.match(r"^https?://", data.embed.imageUrl.strip()):
                    e["image"] = {"url": data.embed.imageUrl.strip()}
                if e:
                    body["embeds"] = [e]
            if not data.isBot:
                body["nonce"] = str(int(time.time() * 1000) * 1000 + random.randint(0, 999))

            res = await http.post(
                f"{DISCORD_API}/channels/{data.channelId}/messages",
                headers=headers,
                json=body,
            )
            text = res.text
            if res.status_code not in (200, 201):
                retry_after = None
                cloudflare = False
                try:
                    j = json.loads(text)
                    if isinstance(j.get("retry_after"), (int, float)):
                        retry_after = j["retry_after"]
                except Exception:
                    if re.search(r"error code:\s*1015", text, re.I) or "cloudflare" in text.lower():
                        cloudflare = True
                cf_match = re.search(r"error code:\s*(\d+)", text, re.I)
                if cloudflare:
                    err_msg = f"Cloudflare block (error {cf_match.group(1) if cf_match else '1015'}) — IP rate limited by Discord edge. Slow down significantly."
                else:
                    err_msg = text[:500]
                return {
                    "ok": False,
                    "status": 1015 if cloudflare else res.status_code,
                    "error": err_msg,
                    "retryAfter": 300 if cloudflare else retry_after,
                    "cloudflare": cloudflare,
                }
            return {"ok": True, "status": res.status_code}
    except Exception as err:
        return {"ok": False, "status": 0, "error": str(err)}


@api_router.post("/discord/emojis")
async def fetch_emoji_map(data: EmojiFetchInput):
    if not data.token:
        return {"ok": False, "status": 400, "error": "Missing token"}

    headers = build_headers(data.token, data.isBot)
    headers["User-Agent"] = (
        "DiscordBot (https://ghost.send, 1.0)" if data.isBot else CLIENT_PROFILES[0]["ua"]
    )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as http:
            gr = await http.get(f"{DISCORD_API}/users/@me/guilds", headers=headers)
            if gr.status_code != 200:
                return {"ok": False, "status": gr.status_code, "error": gr.text[:300]}
            guilds = gr.json()
            emoji_map = {}
            for g in guilds:
                er = await http.get(f"{DISCORD_API}/guilds/{g['id']}/emojis", headers=headers)
                if er.status_code != 200:
                    await asyncio.sleep(0.25)
                    continue
                for e in er.json():
                    if not e.get("id") or not e.get("name"):
                        continue
                    if e["name"] not in emoji_map:
                        emoji_map[e["name"]] = {
                            "id": e["id"],
                            "animated": bool(e.get("animated")),
                            "guild": g.get("name"),
                        }
                await asyncio.sleep(0.2)
            return {
                "ok": True,
                "map": emoji_map,
                "guildCount": len(guilds),
                "emojiCount": len(emoji_map),
            }
    except Exception as err:
        return {"ok": False, "status": 0, "error": str(err)}


class DmMessagesInput(BaseModel):
    token: str
    isBot: bool = True
    channelId: str
    afterId: Optional[str] = None


@api_router.post("/discord/dms")
async def list_dm_channels(data: EmojiFetchInput):
    if not data.token:
        return {"ok": False, "status": 400, "error": "Missing token"}
    headers = build_headers(data.token, data.isBot)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as http:
            me_r = await http.get(f"{DISCORD_API}/users/@me", headers=headers)
            if me_r.status_code != 200:
                return {"ok": False, "status": me_r.status_code, "error": me_r.text[:300]}
            me = me_r.json()
            ch_r = await http.get(f"{DISCORD_API}/users/@me/channels", headers=headers)
            if ch_r.status_code != 200:
                return {"ok": False, "status": ch_r.status_code, "error": ch_r.text[:300]}
            channels = []
            for c in ch_r.json():
                if c.get("type") != 1:
                    continue
                name = ", ".join(r.get("username", "?") for r in c.get("recipients", [])) or c.get("name", "")
                channels.append({"id": c["id"], "lastMessageId": c.get("last_message_id"), "name": name})
            return {
                "ok": True,
                "me": {"id": me["id"], "username": me.get("username", "?")},
                "channels": channels,
            }
    except Exception as err:
        return {"ok": False, "status": 0, "error": str(err)}


@api_router.post("/discord/dm/messages")
async def dm_messages(data: DmMessagesInput):
    if not data.token or not re.fullmatch(r"\d{5,25}", data.channelId or ""):
        return {"ok": False, "status": 400, "error": "Invalid input"}
    headers = build_headers(data.token, data.isBot, data.channelId)
    try:
        params = {"limit": 10}
        if data.afterId and re.fullmatch(r"\d{5,25}", data.afterId):
            params["after"] = data.afterId
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as http:
            r = await http.get(
                f"{DISCORD_API}/channels/{data.channelId}/messages",
                headers=headers,
                params=params,
            )
            if r.status_code != 200:
                return {"ok": False, "status": r.status_code, "error": r.text[:300]}
            msgs = [
                {
                    "id": m["id"],
                    "authorId": m.get("author", {}).get("id"),
                    "author": m.get("author", {}).get("username", "?"),
                    "content": (m.get("content") or "")[:500],
                    "ts": m.get("timestamp"),
                }
                for m in r.json()
            ]
            msgs.reverse()
            return {"ok": True, "messages": msgs}
    except Exception as err:
        return {"ok": False, "status": 0, "error": str(err)}


@api_router.post("/discord/me")
async def discord_me(data: EmojiFetchInput):
    if not data.token:
        return {"ok": False, "status": 400, "error": "Missing token"}
    headers = build_headers(data.token, data.isBot)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as http:
            r = await http.get(f"{DISCORD_API}/users/@me", headers=headers)
            if r.status_code != 200:
                return {"ok": False, "status": r.status_code, "error": r.text[:200]}
            me = r.json()
            return {
                "ok": True,
                "id": me.get("id"),
                "username": me.get("global_name") or me.get("username") or "?",
                "bot": bool(me.get("bot")),
            }
    except Exception as err:
        return {"ok": False, "status": 0, "error": str(err)}


class AiReplyInput(BaseModel):
    instruction: str = ""
    model: str = "gpt-5.4"
    provider: str = "openai"
    geminiKey: Optional[str] = None
    history: list = []
    channelKey: str = "dm"


@api_router.post("/ai/reply")
async def ai_reply(data: AiReplyInput):
    if data.provider == "gemini":
        if not data.geminiKey or not data.geminiKey.strip():
            return {"ok": False, "error": "brak własnego klucza Gemini — wklej go w zakładce Auto DM"}
        api_key = data.geminiKey.strip()
        provider = "gemini"
    else:
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        provider = "openai"
        if not api_key:
            return {"ok": False, "error": "brak skonfigurowanego klucza AI"}
    system = (
        "Jesteś właścicielem tego konta Discord i odpisujesz na prywatne wiadomości. "
        "Odpowiadaj krótko (1-2 zdania), naturalnie i po polsku, jak człowiek. "
        "Nigdy nie ujawniaj, że jesteś AI. Bez list i bez nagłówków. "
        + (f"Dodatkowe wytyczne od właściciela: {data.instruction}" if data.instruction.strip() else "")
    )
    transcript = "\n".join(
        f"{'Ty' if (m.get('role') == 'assistant') else 'Rozmówca'}: {str(m.get('content', ''))[:300]}"
        for m in data.history[-8:]
        if isinstance(m, dict)
    )
    if not transcript.strip():
        return {"ok": False, "error": "brak historii rozmowy"}
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

        chat = LlmChat(
            api_key=api_key,
            session_id=f"ghostdm-{uuid.uuid4()}",
            system_message=system,
        ).with_model(provider, data.model)
        um = UserMessage(
            text=f"Ostatnie wiadomości DM:\n{transcript}\n\nNapisz teraz jedną krótką odpowiedź jako 'Ty'."
        )
        reply = ""
        async for ev in chat.stream_message(um):
            if isinstance(ev, TextDelta):
                reply += ev.content
            elif isinstance(ev, StreamDone):
                break
        reply = reply.strip()
        if not reply:
            return {"ok": False, "error": "pusta odpowiedź AI"}
        return {"ok": True, "reply": reply[:1900]}
    except Exception as err:
        return {"ok": False, "error": str(err)[:300]}


class AlertRelayInput(BaseModel):
    url: str
    payload: dict


@api_router.post("/alert/relay")
async def alert_relay(data: AlertRelayInput):
    url = data.url.strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "invalid url"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as http:
            r = await http.post(url, json=data.payload)
            return {"ok": 200 <= r.status_code < 300, "status": r.status_code}
    except Exception as err:
        return {"ok": False, "error": str(err)[:200]}


class HistoryEntryIn(BaseModel):
    campaign: str
    channelId: str
    message: str
    ok: bool
    status: int = 0
    error: Optional[str] = None


@api_router.post("/history")
async def save_history(entry: HistoryEntryIn):
    doc = entry.model_dump()
    doc["message"] = doc["message"][:500]
    doc["timestamp"] = datetime.now(timezone.utc).isoformat()
    await db.send_history.insert_one(doc)
    return {"ok": True}


@api_router.get("/history")
async def list_history(limit: int = 50):
    limit = max(1, min(200, limit))
    items = await db.send_history.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return {"items": items}


@api_router.get("/history/stats")
async def history_stats():
    total_sent = await db.send_history.count_documents({"ok": True})
    total_failed = await db.send_history.count_documents({"ok": False})
    rows = await db.send_history.aggregate([
        {"$group": {"_id": "$campaign", "sent": {"$sum": {"$cond": ["$ok", 1, 0]}}, "failed": {"$sum": {"$cond": ["$ok", 0, 1]}}}},
        {"$sort": {"sent": -1}},
        {"$limit": 8},
    ]).to_list(8)
    by_campaign = [
        {"name": r["_id"] or "kampania", "sent": r["sent"], "failed": r["failed"]}
        for r in rows
    ]
    today = datetime.now(timezone.utc).date()
    since = (today - timedelta(days=6)).isoformat()
    raw = await db.send_history.find(
        {"timestamp": {"$gte": since}}, {"_id": 0, "timestamp": 1, "ok": 1}
    ).to_list(10000)
    counts = {}
    for r in raw:
        d = r["timestamp"][:10]
        c = counts.setdefault(d, {"sent": 0, "failed": 0})
        c["sent" if r.get("ok") else "failed"] += 1
    by_day = []
    for i in range(6, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        c = counts.get(d, {"sent": 0, "failed": 0})
        by_day.append({"date": d, "label": f"{d[8:10]}.{d[5:7]}", "sent": c["sent"], "failed": c["failed"]})
    return {
        "totalSent": total_sent,
        "totalFailed": total_failed,
        "byCampaign": by_campaign,
        "byDay": by_day,
    }


@api_router.delete("/history")
async def clear_history():
    await db.send_history.delete_many({})
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
