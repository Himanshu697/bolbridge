# BolBridge

**Speak your language. Be heard in theirs.**
Live two-way voice translation for web calls (WhatsApp Web, OmeTV, Google Meet,
Zoom on the web), built on open-source models.

| Folder | What it is | Tech |
| --- | --- | --- |
| [`server/`](server) | Translation server: accounts, minutes, and the live speech pipeline | Python, FastAPI, Whisper, M2M100, Kokoro |
| [`extension/`](extension) | Chrome extension that translates calls inside the browser | Manifest V3, plain JavaScript |
| [`web/`](web) | Website and web app: landing page, sign-up, dashboard, translator test page | React + Vite |
| [`voice-clone-service/`](voice-clone-service) | Optional: speak translations in the user's own voice | OpenVoice V2 |
| [`docs/`](docs) | System design, API, models and licences, roadmap, Hinglish setup guide | |

Hinglish setup guide: [docs/SETUP_HINGLISH.md](docs/SETUP_HINGLISH.md)

---

## How it works (one minute version)

```
You (Hindi) ──mic──► Extension ──16 kHz audio──► Server: Whisper → M2M100 → Kokoro ──French speech──► into the call ──► Friend
Friend (French) ──call audio──► Extension ──► Server: same pipeline, reversed ──Hindi speech──► your headphones
```

The extension sits between the web page and your microphone/speakers, so the
other person needs nothing installed. Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Quick start (about 10 minutes, no GPU needed)

You need: **Python 3.11** (3.10 to 3.12 work), **Node.js 20+**, **Google Chrome**, **VS Code**.

Open the `bolbridge` folder in VS Code. VS Code will suggest the recommended extensions; accept them.

### 1. Server (fake "mock" engines first)

```bash
cd server
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # Windows: copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/health. You should see `"ok": true`.
API docs: http://localhost:8000/docs

### 2. Web app

New terminal:

```bash
cd web
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
npm run dev
```

Open http://localhost:3000, create an account, then go to **Try the translator**
and click **Start talking**. With mock engines you get sample sentences back
(this proves the whole pipeline works end to end).

### 3. Chrome extension

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose the `extension` folder.
3. Copy the extension ID, paste it on http://localhost:3000/connect-extension, click **Sign the extension in**.
4. Open WhatsApp Web (or OmeTV, Google Meet), start a call, click the BolBridge icon, pick their language.

Tip: wear headphones, so the translated voice you hear is not picked up by your mic.

VS Code shortcut: **Terminal → Run Task → Start everything** starts the server and the web app together.

---

## Switch to the real open-source models

```bash
cd server
pip install -r requirements-ml.txt
```

Also install **espeak-ng** (used by the Kokoro voice):
Windows: installer from https://github.com/espeak-ng/espeak-ng/releases ·
macOS: `brew install espeak-ng` · Ubuntu: `sudo apt install espeak-ng`.

In `server/.env` set:

```
ENGINE_PRESET=open-source
```

Restart the server. The first start downloads the models (about 2 GB) from
Hugging Face. A laptop CPU works; an NVIDIA GPU makes it several times faster.
Details, sizes, speed and licences: [docs/MODELS.md](docs/MODELS.md).

Better Hinglish: install [Ollama](https://ollama.com), run `ollama pull qwen2.5:7b-instruct`,
then set `MT_ENGINE=ollama` in `server/.env`.

Your own voice: see [voice-clone-service/README.md](voice-clone-service/README.md).

---

## Tests

```bash
cd server
pytest
```

The tests cover the turn-taking (when a sentence ends), the pipeline, accounts,
contacts, minutes, voice upload and the live WebSocket stream.

## Go live

See [deploy/README.md](deploy/README.md): one command sets up a cloud Ubuntu
server (AWS EC2, E2E Networks or any VPS) with HTTPS, and
`deploy/smoke_test.py` checks the live site end to end.

## Project status

- Server: all unit and stream tests pass (mock engines).
- Web app: sign-up, dashboard, contacts, translator test page, voice upload,
  plans and waitlists, driven in Chrome.
- Extension (v0.3.1): on Meet-like test calls (mic opened before any click,
  Chrome's real autoplay rules, the other person played through `<audio>` or
  Web Audio) both directions are translated, the original voice is turned down,
  and the real voice comes back if the server is unreachable or stops. v0.3.1
  also covers pages that send their own processed or cloned copy of the mic,
  take the mic or the call connection from a fresh about:blank frame, or mute
  through the call itself: the call connection always carries BolBridge's
  audio. The popup's Diagnostics shows how the call sends your voice and the
  sound levels on each side, and the web app has a **Test the extension** page.
  On a real Google Meet call v0.3.1 sent the translated voice correctly, but
  their voice did not reach BolBridge from inside the page. Extension v0.4.0
  therefore hears them from the call tab's own sound (Chrome tab capture in
  an offscreen page, started when you open the popup on the call tab), plays
  the call back to you with the original turned down, and plays their
  translation; the in-page route stays as the fallback. Tab audio is checked
  in a test browser up to a running capture and a ready server session (the
  test machine has no sound card); the real sound check is on a laptop.
- Real models on a laptop (Ryzen 5 3500U, CPU only, WSL with 9 GB): Whisper
  small, M2M100 and Kokoro run; Hindi to English took about 10 s per sentence
  (hearing 6 s, translating 2.5 s, voice 2 s). Whisper small mishears Hindi, so
  `HINDI_ASR=indicconformer` (AI4Bharat IndicConformer) is available to try.
- Deployment kit: tested against a production-like local server (mock
  engines); not yet run on a real cloud machine.

Next: see [docs/ROADMAP.md](docs/ROADMAP.md).

## Licences

Your code in this repository is yours. The open-source models keep their own
licences (all allow commercial use): Whisper (MIT), M2M100 (MIT), Kokoro-82M
(Apache-2.0), OpenVoice V2 (MIT), Qwen2.5-7B (Apache-2.0), AI4Bharat
IndicConformer (MIT), NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0: name NVIDIA in
the app's credits), CTranslate2 and onnx-asr (MIT). Do not swap in
NLLB-200, SeamlessM4T or Coqui XTTS: their licences forbid commercial use.
