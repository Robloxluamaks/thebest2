"""Backend tests for GHOST.SEND — AI compose, Discord proxy, history heatmap."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
API = f"{BASE_URL.rstrip('/')}/api"
FAKE_TOKEN = "FAKE.TOKEN.xyz"


# ---------- AI compose ----------
class TestAiCompose:
    def test_generate_polish(self):
        r = requests.post(f"{API}/ai/compose", json={
            "mode": "generate",
            "brief": "promocja serwera gamingowego z nagrodami",
            "tone": "entuzjastyczny",
        }, timeout=120)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True, j
        assert isinstance(j.get("text"), str) and len(j["text"]) > 10

    def test_improve(self):
        r = requests.post(f"{API}/ai/compose", json={
            "mode": "improve",
            "current": "Siema wbijaj na serwer",
            "tone": "neutralny",
        }, timeout=120)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True, j
        assert len(j.get("text", "")) > 5

    def test_spintax(self):
        r = requests.post(f"{API}/ai/compose", json={
            "mode": "spintax",
            "current": "Zapraszam na serwer, zapraszam znajomych",
            "variants": 3,
        }, timeout=120)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True, j
        assert "{" in j["text"] and "|" in j["text"] and "}" in j["text"], f"no spintax: {j['text']}"

    def test_empty_input(self):
        r = requests.post(f"{API}/ai/compose", json={"mode": "generate", "brief": ""}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is False
        assert "error" in j


# ---------- Discord proxy (fake token) ----------
class TestDiscordSend:
    def test_send_missing_fields(self):
        r = requests.post(f"{API}/discord/send", json={"token": FAKE_TOKEN, "channelId": "", "message": ""}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is False
        assert j["status"] == 400

    def test_send_invalid_channel(self):
        r = requests.post(f"{API}/discord/send", json={"token": FAKE_TOKEN, "channelId": "abc", "message": "hi"}, timeout=15)
        assert r.json()["status"] == 400

    def test_send_fake_token_401(self):
        r = requests.post(f"{API}/discord/send", json={
            "token": FAKE_TOKEN, "channelId": "123456789012345678", "message": "test", "isBot": True
        }, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is False
        assert j["status"] != 500 and j["status"] != 0
        # Should be 401 Unauthorized from Discord
        assert j["status"] in (401, 403), j


class TestDiscordEdit:
    def test_edit_invalid_ids(self):
        r = requests.post(f"{API}/discord/edit", json={
            "token": FAKE_TOKEN, "channelId": "abc", "messageId": "xyz", "message": "x"
        }, timeout=15)
        assert r.json()["status"] == 400

    def test_edit_fake_token(self):
        r = requests.post(f"{API}/discord/edit", json={
            "token": FAKE_TOKEN, "channelId": "123456789012345678",
            "messageId": "987654321098765432", "message": "updated"
        }, timeout=30)
        j = r.json()
        assert j["ok"] is False
        assert j["status"] not in (500, 0), j


class TestDiscordDelete:
    def test_delete_invalid_ids(self):
        r = requests.post(f"{API}/discord/delete", json={
            "token": FAKE_TOKEN, "channelId": "", "messageId": "abc"
        }, timeout=15)
        assert r.json()["status"] == 400

    def test_delete_fake_token(self):
        r = requests.post(f"{API}/discord/delete", json={
            "token": FAKE_TOKEN, "channelId": "123456789012345678", "messageId": "987654321098765432"
        }, timeout=30)
        j = r.json()
        assert j["ok"] is False
        assert j["status"] not in (500, 0), j


# ---------- History heatmap ----------
class TestHeatmap:
    def test_heatmap_shape(self):
        r = requests.get(f"{API}/history/heatmap", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j["grid"], list) and len(j["grid"]) == 7
        for row in j["grid"]:
            assert len(row) == 24
        assert "peak" in j and "total" in j



# ---------- New Discord endpoints (iteration 2): fake token must return clean JSON, never 500 ----------
VALID_ID = "123456789012345678"
VALID_ID2 = "987654321098765432"


def _assert_clean(j, msg=""):
    assert isinstance(j, dict)
    assert j.get("ok") is False, f"{msg}: {j}"
    assert j.get("status") not in (500, 0), f"{msg}: {j}"


class TestChannelInfo:
    def test_invalid_channel(self):
        r = requests.post(f"{API}/discord/channel-info", json={"token": FAKE_TOKEN, "channelId": "abc"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == 400

    def test_missing_token(self):
        r = requests.post(f"{API}/discord/channel-info", json={"token": "", "channelId": VALID_ID}, timeout=15)
        assert r.json()["status"] == 400

    def test_fake_token_401(self):
        r = requests.post(f"{API}/discord/channel-info", json={"token": FAKE_TOKEN, "channelId": VALID_ID, "isBot": True}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        _assert_clean(j, "channel-info")
        assert j["status"] in (401, 403), j


class TestFindChannel:
    def test_invalid_guild(self):
        r = requests.post(f"{API}/discord/find-channel", json={"token": FAKE_TOKEN, "guildId": "abc", "name": "general"}, timeout=15)
        assert r.json()["status"] == 400

    def test_empty_name(self):
        r = requests.post(f"{API}/discord/find-channel", json={"token": FAKE_TOKEN, "guildId": VALID_ID, "name": "   "}, timeout=15)
        assert r.json()["status"] == 400

    def test_fake_token_401(self):
        r = requests.post(f"{API}/discord/find-channel", json={"token": FAKE_TOKEN, "guildId": VALID_ID, "name": "general"}, timeout=30)
        j = r.json()
        _assert_clean(j, "find-channel")
        assert j["status"] in (401, 403), j


class TestChannelMessages:
    def test_invalid_channel(self):
        r = requests.post(f"{API}/discord/messages", json={"token": FAKE_TOKEN, "channelId": "nope"}, timeout=15)
        assert r.json()["status"] == 400

    def test_fake_token_401(self):
        r = requests.post(f"{API}/discord/messages", json={"token": FAKE_TOKEN, "channelId": VALID_ID, "limit": 20}, timeout=30)
        j = r.json()
        _assert_clean(j, "messages")
        assert j["status"] in (401, 403), j


class TestReact:
    def test_invalid_ids(self):
        r = requests.post(f"{API}/discord/react", json={"token": FAKE_TOKEN, "channelId": "abc", "messageId": "xyz", "emoji": "🔥"}, timeout=15)
        assert r.json()["status"] == 400

    def test_empty_emoji(self):
        r = requests.post(f"{API}/discord/react", json={"token": FAKE_TOKEN, "channelId": VALID_ID, "messageId": VALID_ID2, "emoji": ""}, timeout=15)
        assert r.json()["status"] == 400

    def test_fake_token_401(self):
        r = requests.post(f"{API}/discord/react", json={"token": FAKE_TOKEN, "channelId": VALID_ID, "messageId": VALID_ID2, "emoji": "🔥"}, timeout=30)
        j = r.json()
        _assert_clean(j, "react")
        assert j["status"] in (401, 403), j


class TestRelationships:
    def test_missing_token(self):
        r = requests.post(f"{API}/discord/relationships", json={"token": "", "accept": True}, timeout=15)
        assert r.json()["status"] == 400

    def test_fake_token_401(self):
        r = requests.post(f"{API}/discord/relationships", json={"token": FAKE_TOKEN, "accept": True}, timeout=30)
        j = r.json()
        _assert_clean(j, "relationships")
        assert j["status"] in (401, 403), j


class TestActiveThreads:
    def test_invalid_ids(self):
        r = requests.post(f"{API}/discord/active-threads", json={"token": FAKE_TOKEN, "guildId": "abc", "parentId": "xyz"}, timeout=15)
        assert r.json()["status"] == 400

    def test_fake_token_401(self):
        r = requests.post(f"{API}/discord/active-threads", json={"token": FAKE_TOKEN, "guildId": VALID_ID, "parentId": VALID_ID2}, timeout=30)
        j = r.json()
        _assert_clean(j, "active-threads")
        assert j["status"] in (401, 403), j
