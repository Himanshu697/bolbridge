import io

from app.audio import to_wav_bytes
from conftest import signup, tone


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_health_and_languages(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["engines"]["asr"] == "mock-asr"
    assert r.json()["free_plan_switching"] is True  # DEV_MODE on in tests
    langs = client.get("/api/languages").json()
    codes = {l["code"] for l in langs}
    assert {"hi", "en", "fr", "zh"} <= codes


def test_signup_login_me(client):
    token = signup(client)
    me = client.get("/api/me", headers=auth(token)).json()
    assert me["email"] == "himanshu@example.com" and me["plan"] == "free"

    r = client.post("/api/auth/login", json={"email": "HIMANSHU@example.com", "password": "secret123"})
    assert r.status_code == 200

    r = client.post("/api/auth/login", json={"email": "himanshu@example.com", "password": "nope-nope"})
    assert r.status_code == 401


def test_duplicate_signup(client):
    signup(client)
    r = client.post("/api/auth/signup", json={"name": "X", "email": "himanshu@example.com", "password": "secret123"})
    assert r.status_code == 409


def test_short_password_rejected(client):
    r = client.post("/api/auth/signup", json={"name": "X", "email": "a@b.co", "password": "123"})
    assert r.status_code == 422


def test_me_requires_login(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=auth("garbage")).status_code == 401


def test_update_profile(client):
    token = signup(client)
    r = client.patch("/api/me", json={"speaks": "en", "voice_gender": "male"}, headers=auth(token))
    assert r.status_code == 200 and r.json()["speaks"] == "en" and r.json()["voice_gender"] == "male"
    assert client.patch("/api/me", json={"speaks": "xx"}, headers=auth(token)).status_code == 422


def test_usage_and_plan(client):
    token = signup(client)
    u = client.get("/api/usage", headers=auth(token)).json()
    assert u["minutes_quota"] == 15 and u["minutes_left"] == 15
    r = client.post("/api/me/plan", json={"plan": "pro"}, headers=auth(token))
    assert r.status_code == 200
    assert client.get("/api/usage", headers=auth(token)).json()["minutes_quota"] == 300


def test_plan_switch_blocked_outside_dev(strict_client):
    token = signup(strict_client)
    assert strict_client.post("/api/me/plan", json={"plan": "pro"}, headers=auth(token)).status_code == 403


def test_contacts_crud_and_isolation(client):
    t1 = signup(client)
    t2 = signup(client, email="other@example.com")
    r = client.post("/api/contacts", json={"name": "Camille", "language": "fr"}, headers=auth(t1))
    assert r.status_code == 201
    cid = r.json()["id"]
    assert client.post("/api/contacts", json={"name": "Bad", "language": "xx"}, headers=auth(t1)).status_code == 422

    assert [c["name"] for c in client.get("/api/contacts", headers=auth(t1)).json()] == ["Camille"]
    assert client.get("/api/contacts", headers=auth(t2)).json() == []
    assert client.delete(f"/api/contacts/{cid}", headers=auth(t2)).status_code == 404

    r = client.patch(f"/api/contacts/{cid}", json={"language": "es"}, headers=auth(t1))
    assert r.json()["language"] == "es"
    assert client.delete(f"/api/contacts/{cid}", headers=auth(t1)).status_code == 204
    assert client.get("/api/contacts", headers=auth(t1)).json() == []


def test_waitlist_via_signup_and_direct(client):
    signup(client, email="learner@example.com", product="learn")
    assert client.post("/api/waitlist", json={"email": "x@example.com", "product": "chat"}).status_code == 201


def test_voice_upload_and_delete(client):
    token = signup(client)
    assert client.get("/api/voice", headers=auth(token)).json()["has_voice"] is False

    short = to_wav_bytes(tone(2.0), 16000)
    r = client.post("/api/voice", files={"file": ("v.wav", io.BytesIO(short), "audio/wav")}, headers=auth(token))
    assert r.status_code == 422

    good = to_wav_bytes(tone(10.0), 16000)
    r = client.post("/api/voice", files={"file": ("v.wav", io.BytesIO(good), "audio/wav")}, headers=auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_voice"] is True and body["status"] == "saved" and body["cloning_available"] is False

    assert client.delete("/api/voice", headers=auth(token)).status_code == 204
    assert client.get("/api/voice", headers=auth(token)).json()["has_voice"] is False

    r = client.post("/api/voice", files={"file": ("v.webm", io.BytesIO(b"not a wav"), "audio/webm")}, headers=auth(token))
    assert r.status_code == 422


def test_serves_the_built_web_app_when_web_dist_is_set(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from conftest import make_settings, mock_engines

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<div id="root"></div>')
    (dist / "assets" / "app.js").write_text("console.log(1)")
    app = create_app(make_settings(tmp_path, web_dist=str(dist)), engines=mock_engines())
    with TestClient(app) as c:
        assert c.get("/").text == '<div id="root"></div>'
        assert c.get("/app/try").text == '<div id="root"></div>'  # the app's own pages
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/health").json()["ok"] is True  # API still wins
        assert c.get("/api/nope").status_code == 404


def test_warm_up_runs_at_start_when_asked(tmp_path, caplog):
    import logging

    from fastapi.testclient import TestClient

    from app.main import create_app
    from conftest import make_settings, mock_engines

    caplog.set_level(logging.INFO)
    app = create_app(make_settings(tmp_path, warmup_langs=["hi", "en"]), engines=mock_engines())
    with TestClient(app) as c:
        assert c.get("/health").status_code == 200
    assert any("Warm-up done" in r.getMessage() for r in caplog.records)


def test_threads_default_to_physical_cores(tmp_path):
    import os

    from conftest import make_settings

    assert make_settings(tmp_path).threads == max(1, (os.cpu_count() or 2) // 2)
    assert make_settings(tmp_path, cpu_threads=3).threads == 3


def test_test_speech_for_the_extension_test_page(client):
    from urllib.parse import unquote

    from conftest import signup

    assert client.get("/api/test-speech?lang=en").status_code == 401
    token = signup(client)
    h = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/test-speech?lang=en", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert r.content[:4] == b"RIFF"
    assert unquote(r.headers["x-test-sentence"]).startswith("Hello!")
    assert client.get("/api/test-speech?lang=ar", headers=h).status_code == 422  # subtitles-only language
    assert client.get("/api/test-speech?lang=xx", headers=h).status_code == 422
