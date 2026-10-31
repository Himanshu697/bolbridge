# Open-source models used by BolBridge

All of these allow commercial use. Licences can change: re-check before launch.

| Job | Model | Licence | Size | Languages | Notes |
| --- | --- | --- | --- | --- | --- |
| Speech → text (ASR) | Whisper `small` via faster-whisper (CTranslate2) | MIT | ~0.5 GB | 99 incl. Hindi, Tamil, Bengali, Urdu, Mandarin | `medium`/`large-v3`/`turbo` are more accurate, slower |
| Speech → text, Hindi (optional) | AI4Bharat IndicConformer, ONNX export via onnx-asr | MIT (model, export and onnx-asr) | ~0.1–0.5 GB (int8 smaller) | Hindi (other Indian languages have their own exports) | `HINDI_ASR=indicconformer`. Trained on Indian speech; no 30-second padding, so much faster than Whisper on a CPU |
| Speech → text, European (optional) | NVIDIA Parakeet TDT 0.6B v3 via onnx-asr | CC-BY-4.0 (credit NVIDIA) | ~0.7 GB int8 | 25 European incl. English, French, Spanish, Italian, Portuguese, German, Russian | `EUROPEAN_ASR=parakeet`. Much faster than Whisper on a CPU |
| Text → text (MT, default) | M2M100 418M in CTranslate2 int8 (`jncraton/m2m100_418M-ct2-int8`) | MIT | ~0.5 GB | same as M2M100 | `MT_ENGINE=m2m100-ct2`. Same model, ~4x less memory and faster on CPU. On a GPU: `michaelfeil/ct2fast-m2m100_1.2B` |
| Text → text (MT) | Meta M2M100 418M | MIT | ~1.9 GB | 100 incl. Hindi, Tamil, Bengali, Marathi, Urdu, French, Mandarin | Default. Works on CPU |
| Text → text (MT, better) | Qwen2.5-7B-Instruct via Ollama | Apache-2.0 | ~4.7 GB (q4) | Many | Handles Hinglish and glossaries much better. Needs ~8 GB RAM/VRAM |
| Text → speech (TTS) | Kokoro-82M | Apache-2.0 | ~0.3 GB | English, Hindi, French, Spanish, Italian, Portuguese, Japanese, Mandarin | Needs `espeak-ng` installed |
| Your own voice | OpenVoice V2 tone-colour converter | MIT | ~0.2 GB | Any (converts the voice, not the words) | Runs as a separate service; adds a watermark |

## Do not use (non-commercial licences)

- **NLLB-200** (Meta): CC-BY-NC 4.0
- **SeamlessM4T / Seamless Streaming** (Meta): CC-BY-NC 4.0
- **Coqui XTTS-v2**: Coqui Public Model Licence (non-commercial)
- **Wav2Lip** (talking heads): non-commercial

## Hardware guide

| Setup | Who it is for | Expect |
| --- | --- | --- |
| Laptop CPU, 16 GB RAM | Building and testing | Measured on a 4-core Ryzen 5 3500U with Whisper small: ~10 s per sentence (hearing ~6 s, translating ~2.5 s, voice ~2 s). One call at a time |
| One NVIDIA GPU (T4, RTX 3060 or better) | Pilot with real users | ~1–1.5 s delay, 10–20 people talking at once |
| Several GPUs + queue | Launch | Scale workers per language group |

## Indian languages roadmap

- **Voices for Tamil, Bengali, Marathi, Telugu, Gujarati:** Kokoro does not have
  them yet. Options to evaluate: AI4Bharat's Indic TTS models and Indic Parler-TTS
  (check each model card's licence), and the Government's Bhashini APIs (free
  for startups; a hosted API, not open weights).
- **Better Indian-language translation:** AI4Bharat IndicTrans2 (MIT) for
  Indian languages ↔ English, chained with M2M100 for English ↔ others.
- **Hinglish:** the Ollama LLM translator already handles code-mixed speech; a
  fine-tuned Whisper on Hinglish call audio is the next accuracy jump.

## Where the models are downloaded

The first run downloads weights from Hugging Face into the user cache
(`~/.cache/huggingface`). For servers, bake them into the Docker image or a
mounted volume so restarts are fast.
