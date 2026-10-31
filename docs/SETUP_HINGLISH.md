# VS Code mein setup (Roman Hindi guide)

Yeh guide step-by-step batati hai ki project apne laptop pe kaise chalana hai.
Pehle **mock** engines ke saath chalayenge (koi AI model download nahi hota,
sab 10 minute mein chal jaata hai). Phir asli open-source models lagayenge.

## 0. Pehle yeh install karo (ek baar)

1. **VS Code**: https://code.visualstudio.com
2. **Python 3.11**: https://www.python.org/downloads/ (install karte waqt "Add Python to PATH" tick karna)
3. **Node.js 20 ya naya (LTS)**: https://nodejs.org
4. **Google Chrome**

Check karo (VS Code ka terminal: menu **Terminal → New Terminal**):

```bash
python --version
node --version
```

## 1. Project kholo

1. Zip file ko unzip karo, jaise `D:\projects\bolbridge`.
2. VS Code mein **File → Open Folder** → `bolbridge` folder chuno.
3. Neeche kone mein "recommended extensions" ka message aaye to **Install** dabao.

## 2. Server chalao (terminal 1)

```bash
cd server
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Mac/Linux
pip install -r requirements-dev.txt
copy .env.example .env          # Mac/Linux: cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Browser mein http://localhost:8000/health kholo. `"ok": true` dikhe to server chal raha hai.

Tests chalane ke liye (naya terminal, `.venv` activate karke): `cd server` phir `pytest`.

## 3. Web app chalao (terminal 2)

```bash
cd web
npm install
copy .env.example .env.local    # Mac/Linux: cp .env.example .env.local
npm run dev
```

http://localhost:3000 kholo → account banao → **Try the translator** → **Start talking**.
Mock mode mein sample sentences aate hain: matlab poora system juda hua hai.

Shortcut: VS Code mein **Terminal → Run Task → Start everything** dono ek saath chala deta hai.

## 4. Chrome extension lagao

1. Chrome mein `chrome://extensions` kholo.
2. Upar right mein **Developer mode** on karo.
3. **Load unpacked** dabao → project ka `extension` folder chuno.
4. Extension ke card pe jo **ID** likha hai (32 letters), use copy karo.
5. http://localhost:3000/connect-extension pe ID paste karo → **Sign the extension in**.
6. Ab WhatsApp Web kholo, call lagao/uthao, BolBridge icon dabao, saamne wale ki bhasha chuno.

**Headphones lagana zaroori hai**, warna speaker ki awaaz mic mein jaakar dobara translate hogi.

## 5. Asli open-source AI models lagao

```bash
cd server
.venv\Scripts\activate
pip install -r requirements-ml.txt
```

**espeak-ng** bhi install karo (Kokoro voice ke liye):
Windows installer: https://github.com/espeak-ng/espeak-ng/releases

`server/.env` file kholo aur yeh line badlo:

```
ENGINE_PRESET=open-source
```

Server dobara chalao. Pehli baar ~2 GB models download honge (thoda time lagega).
Laptop CPU pe chalega (2–4 second delay); NVIDIA GPU ho to 1–1.5 second.

**Hinglish ke liye behtar translation:**
1. https://ollama.com se Ollama install karo
2. Terminal mein: `ollama pull qwen2.5:7b-instruct`
3. `server/.env` mein: `MT_ENGINE=ollama`

**Apni awaaz mein translation:** `voice-clone-service/README.md` dekho.

## Dikkat aaye to

| Problem | Hal |
| --- | --- |
| `python` command nahi mila | Python install karte waqt "Add to PATH" tick nahi hua. Dobara install karo |
| Web app bole "Can't reach the BolBridge server" | Terminal 1 mein server chal raha hai? http://localhost:8000/health check karo |
| Extension "refresh the page to start" bole | Call wala page ek baar reload karo |
| Saamne wale ko kuch sunai nahi deta | Extension popup mein error dekho; server band ho to extension asli awaaz bhej deta hai |
| Awaaz goonj rahi hai | Headphones lagao |
| `kokoro` install nahi ho raha | Python 3.13 hai to 3.11 install karo (Kokoro abhi 3.13 support nahi karta) |
