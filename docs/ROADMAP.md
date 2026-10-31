# Roadmap

## Done in v0.1 (this code)

- [x] Translation server: accounts, minutes per plan, contacts, call history, voice sample
- [x] Live WebSocket stream with sentence detection, backlog control, minutes metering
- [x] Open-source engines: Whisper, M2M100, Kokoro; optional Ollama LLM and OpenVoice
- [x] Mock engines so everything runs on any laptop
- [x] Chrome extension: mic replacement, incoming audio capture, both directions,
      on-page subtitles, popup, any-site opt-in, sign-in from the web app,
      fallback to real voice on errors
- [x] Web app: landing hub, contextual sign-up, dashboard, translator test page,
      voice recording, plan page, previews and waitlists for AI tutor and video chat
- [x] Tests for server logic and the live stream; browser test of the extension on a WebRTC call

## Next 2–4 weeks (to a real pilot)

- [ ] Run with real models on a GPU machine; measure delay per language pair
- [ ] Test on real WhatsApp Web, OmeTV and Google Meet calls (each site behaves a bit differently)
- [ ] Echo control: pause the outgoing stream while translated speech plays to you
- [ ] Hinglish: default to the Ollama translator for Hindi; collect (with consent) hard examples
- [ ] Glossary per user (trade terms, names)
- [ ] Payments: Razorpay (UPI, cards) for India, Stripe for international
- [ ] Privacy policy, terms, consent texts reviewed (DPDP Act)
- [ ] Deploy: API + GPU worker in a Mumbai region, HTTPS, Postgres, backups
- [ ] Chrome Web Store listing (privacy disclosures for audio)

## Next 2–3 months

- [ ] Lower delay: streaming ASR, clause-by-clause translation, faster turn-taking
- [ ] Desktop app (Windows/Mac) with a virtual microphone, for the WhatsApp and Zoom desktop apps
- [ ] Mobile app: translated call links (WebRTC rooms) since phones block call audio
- [ ] Indian-language voices (Tamil, Bengali, Marathi…)
- [ ] AudioWorklet instead of ScriptProcessor where the site allows it

## Later products

- [ ] **AI tutor** with a realistic talking avatar
- [ ] **Talk to the World** random video chat with built-in translation and moderation
- [ ] **Business API**: per-minute translation for call centres and apps
