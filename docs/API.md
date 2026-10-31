# BolBridge API

Base URL in development: `http://localhost:8000`. Interactive docs: `/docs`.
Authenticated calls send `Authorization: Bearer <token>`.

## REST

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | | `{ok, version, preset, engines, voice_clone}` |
| GET | `/api/languages` | | `[{code, name, native, voice}]` |
| POST | `/api/auth/signup` | `{name, email, password (8+), speaks, region: "IN"\|"INTL", product: "translate"\|"learn"\|"chat"}` | `{token, user}` (201). 409 if the email exists |
| POST | `/api/auth/login` | `{email, password}` | `{token, user}`. 401 on wrong password |
| GET | `/api/me` | | user |
| PATCH | `/api/me` | any of `{name, speaks, voice_gender, use_my_voice, region}` | user |
| GET | `/api/usage` | | `{plan, minutes_quota, minutes_used, minutes_left, period_start}` |
| POST | `/api/me/plan` | `{plan: "free"\|"basic"\|"pro"}` | user. Only when `DEV_MODE=true` |
| GET | `/api/contacts` | | `[{id, name, language, note, created_at}]` |
| POST | `/api/contacts` | `{name, language, note?}` | contact (201) |
| PATCH | `/api/contacts/{id}` | any of `{name, language, note}` | contact |
| DELETE | `/api/contacts/{id}` | | 204 |
| GET | `/api/calls?limit=20` | | `[{id, platform, peer_name, direction, src_lang, tgt_lang, seconds_processed, utterances, started_at, ended_at}]` |
| GET | `/api/voice` | | `{has_voice, seconds, status, cloning_available}` |
| POST | `/api/voice` | multipart `file` = 16-bit WAV, 8 s or more | same as GET |
| DELETE | `/api/voice` | | 204 |
| POST | `/api/waitlist` | `{email, product: "learn"\|"chat"}` | `{ok}` |

Errors: `{"detail": "message"}` with 401, 403, 404, 409, 413 or 422.

## Live stream: `WS /ws/translate`

Query parameters:

| Name | Meaning | Default |
| --- | --- | --- |
| `src`, `tgt` | language codes, e.g. `hi`, `fr` | required |
| `direction` | `out` (my voice to them) or `in` (their voice to me) | `out` |
| `token` | JWT; needed unless `ALLOW_ANONYMOUS_WS=true` | |
| `speak` | `1` to get translated speech, `0` for text only | `1` |
| `voice` | `1` to use the user's cloned voice (if ready) | `0` |
| `announce` | `1` to speak "this call is translated" first (direction `out`) | `0` |
| `gender` | `female` or `male` stock voice | user setting |
| `platform`, `peer` | stored in call history | `web`, empty |

### Client → server

- **Binary:** PCM, 16-bit little-endian, mono, 16 000 Hz. Any chunk size;
  keep sending during silence (the server needs it to find sentence ends).
- **Text:**
  - `{"type":"config","src":"hi","tgt":"es","speak":true}` change languages mid-call
  - `{"type":"flush"}` treat what was said so far as a full sentence
  - `{"type":"ping"}` → `{"type":"pong"}`
  - `{"type":"stop"}` close

### Server → client

```jsonc
{"type":"ready","session":"a1b2c3","direction":"out","src":"hi","tgt":"fr","speech":true,
 "voice_clone":false,"engines":{"asr":"faster-whisper","mt":"m2m100","tts":"kokoro","voice":"none"},
 "minutes_left":58.5,"input":{"format":"pcm16","sample_rate":16000,"channels":1}}
{"type":"vad","speaking":true,"direction":"out"}
{"type":"status","pending":1,"direction":"out"}   // sentences still being translated; sent whenever it changes
{"type":"result","id":1,"direction":"out","source_text":"नमस्ते","translated_text":"Bonjour",
 "src":"hi","tgt":"fr","voice_cloned":false,"has_audio":true,"timings_ms":{"asr":420,"mt":180,"tts":260}}
{"type":"audio","id":1,"sample_rate":24000,"format":"pcm16","bytes":48000}
<binary frame: 48000 bytes of PCM16 mono at 24 kHz>
{"type":"usage","minutes_left":58.4}
{"type":"announcement", ...same fields as result...}
{"type":"notice","code":"dropped","message":"Skipped an older sentence to stay live."}
{"type":"notice","code":"no_speech","message":"Didn't catch any words. ..."}   // a sentence was cut out but no words were recognised
{"type":"error","code":"quota_exceeded"|"auth"|"bad_language"|"pipeline","message":"..."}
```

Close codes: `4400` bad language, `4401` login needed, `4402` no minutes left.

To stop without losing the last sentence, send `{"type":"flush"}` then
`{"type":"ping"}`; once the `pong` has arrived and `status.pending` is 0, close.

The binary audio frame always comes right after its `audio` header, on the same
connection, so a client can pair them by order.
