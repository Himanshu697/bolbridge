# Voice-clone service (optional)

Makes translations sound like **your own voice**. Uses
[OpenVoice V2](https://github.com/myshell-ai/OpenVoice) (MIT licence, free for
commercial use). Every cloned clip carries OpenVoice's inaudible watermark.

It runs on its own, in its own Python environment, because OpenVoice needs
older library versions than the main server.

## Setup (once)

Use Python 3.9 or 3.10.

```bash
cd voice-clone-service
python3.10 -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install git+https://github.com/myshell-ai/OpenVoice.git
pip install fastapi "uvicorn[standard]" python-multipart soundfile
```

Download the V2 checkpoints (`checkpoints_v2_0417.zip`, link in the OpenVoice
README) and unzip them here so you have `voice-clone-service/checkpoints_v2/converter/`.

## Run

```bash
uvicorn app:app --port 8100
```

Then in `server/.env`:

```
VOICE_ENGINE=openvoice-service
VOICE_SERVICE_URL=http://localhost:8100
```

Restart the main server. In the web app, open **My voice**, record 30 seconds,
and turn on "Speak in my own voice" in the extension.

## Rules we follow

- Only the account owner can create their voice profile, after ticking consent.
- Deleting the voice in the web app deletes the profile here too.
- Do not remove the watermark.
