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
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, Dict
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

DISCORD_API = "https://discord.com/api/v10"

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
    },
]


class EmojiEntry(BaseModel):
    id: str
    animated: bool = False
    guild: Optional[str] = None


class SendInput(BaseModel):
    token: str
    channelId: str
    message: str
    isBot: bool = True
    typing: bool = False
    typingMs: int = 1500
    emojiMap: Optional[Dict[str, EmojiEntry]] = None


class EmojiFetchInput(BaseModel):
    token: str
    isBot: bool = True


def build_headers(token: str, is_bot: bool, channel_id: Optional[str] = None) -> dict:
    headers = {
        "Authorization": f"Bot {token}" if is_bot else token,
        "Content-Type": "application/json",
    }
    if is_bot:
        headers["User-Agent"] = "DiscordBot (https://ghost.send, 1.0)"
    else:
        profile = random.choice(CLIENT_PROFILES)
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
        if channel_id:
            headers["Referer"] = f"https://discord.com/channels/@me/{channel_id}"
    return headers


@api_router.get("/")
async def root():
    return {"message": "GHOST.SEND API"}


@api_router.post("/discord/send")
async def send_discord_message(data: SendInput):
    if not data.token or not data.channelId or not data.message:
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

    headers = build_headers(data.token, data.isBot, data.channelId)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as http:
            if data.typing:
                typing_wait_ms = max(400, min(15000, data.typingMs))
                try:
                    await http.post(f"{DISCORD_API}/channels/{data.channelId}/typing", headers=headers)
                except Exception:
                    pass
                elapsed = 0.0
                target = typing_wait_ms / 1000.0
                while elapsed < target:
                    chunk = min(9.0, target - elapsed)
                    await asyncio.sleep(chunk)
                    elapsed += chunk
                    if elapsed < target:
                        try:
                            await http.post(f"{DISCORD_API}/channels/{data.channelId}/typing", headers=headers)
                        except Exception:
                            pass

            body = {"content": content, "tts": False, "flags": 0}
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
