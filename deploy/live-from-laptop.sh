#!/usr/bin/env bash
# Put BolBridge online from this laptop for free, through a Cloudflare Tunnel.
# No server to rent and no ports to open: the tunnel gives you an https address.
#
#   bash deploy/live-from-laptop.sh
#       -> a random https://something.trycloudflare.com address (changes every run)
#
#   TUNNEL=bolbridge DOMAIN=bolbridge.yourdomain.in bash deploy/live-from-laptop.sh
#       -> your own fixed address, after the one-time setup in deploy/README.md
#
# The site is online only while this laptop is on, awake and connected.
# Ctrl+C stops everything. The server uses port 8080, so it does not clash
# with other projects on 8000. Logs: ~/bolbridge-logs/live-*.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8080}"
LOGS="$HOME/bolbridge-logs"
BIN="$HOME/.local/bin"
LIVE_ENV="$ROOT/server/.env.live"
TUNNEL="${TUNNEL:-}"
DOMAIN="${DOMAIN:-}"
mkdir -p "$LOGS" "$BIN"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -x "$ROOT/server/.venv/bin/uvicorn" ]] || die "No server/.venv yet. Set up the server first (README: Switch to the real open-source models)."
command -v npm >/dev/null || die "npm not found. Install Node.js 20+ first."
if [[ -n "$TUNNEL" && -z "$DOMAIN" ]]; then die "With TUNNEL=... also set DOMAIN=the name you routed to it"; fi
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then die "Port $PORT is busy. Stop what uses it, or run with PORT=8090."; fi

# ---------------------------------------------------------------- cloudflared
CF="$(command -v cloudflared || true)"
if [[ -z "$CF" ]]; then
  CF="$BIN/cloudflared"
  if [[ ! -x "$CF" ]]; then
    case "$(uname -m)" in
      x86_64) ARCH=amd64 ;;
      aarch64|arm64) ARCH=arm64 ;;
      *) die "Unsupported CPU $(uname -m) for cloudflared" ;;
    esac
    log "Downloading cloudflared (Cloudflare's free tunnel program)"
    curl -fsSL -o "$CF" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH"
    chmod +x "$CF"
  fi
fi

# ---------------------------------------------------------------- live settings
if [[ ! -f "$LIVE_ENV" ]]; then
  log "Creating server/.env.live (live settings, kept separate from your dev .env)"
  SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
  cat > "$LIVE_ENV" <<EOF
# Settings used by deploy/live-from-laptop.sh. They override server/.env.
APP_ENV=production
SECRET_KEY=$SECRET
# Only signed-in users can translate.
ALLOW_ANONYMOUS_WS=false
# Plans change only through deploy/set-plan or payments.
DEV_MODE=false
ENGINE_PRESET=open-source
EOF
  chmod 600 "$LIVE_ENV"
fi
# Speed settings (added to older .env.live files too; edit the file to change them).
add_setting() { grep -q "^$1=" "$LIVE_ENV" || echo "$1=$2" >> "$LIVE_ENV"; }
add_setting HINDI_ASR indicconformer      # Hindi: AI4Bharat IndicConformer, fast and accurate
add_setting EUROPEAN_ASR parakeet         # English, French, ...: NVIDIA Parakeet, fast on CPU
add_setting MT_ENGINE m2m100-ct2          # translator in int8: smaller and faster
add_setting WARMUP_LANGS hi,en            # load these voices before the first call

# ---------------------------------------------------------------- web app
log "Building the web app"
(cd "$ROOT/web" && { [[ -d node_modules ]] || npm install --no-audit --no-fund; } && VITE_API_URL= npm run build) > "$LOGS/live-build.log" 2>&1 \
  || die "Web build failed. See $LOGS/live-build.log"

# ---------------------------------------------------------------- server
PIDS=()
cleanup() {
  trap - EXIT INT TERM
  printf '\nStopping BolBridge live...\n'
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "Starting the translation server on port $PORT (loading and warming up models: 1-3 minutes)"
(
  cd "$ROOT/server"
  set -a; . "$LIVE_ENV"; set +a
  export WEB_DIST="$ROOT/web/dist"
  exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --ws-ping-timeout 120 \
    --proxy-headers --forwarded-allow-ips 127.0.0.1
) > "$LOGS/live-server.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "${PIDS[0]}" 2>/dev/null || { tail -n 30 "$LOGS/live-server.log"; die "The server stopped. Full log: $LOGS/live-server.log"; }
  sleep 5
done
curl -fsS "http://127.0.0.1:$PORT/health" || die "The server did not start in 10 minutes. See $LOGS/live-server.log"
echo

# ---------------------------------------------------------------- tunnel
log "Opening the Cloudflare Tunnel"
: > "$LOGS/live-tunnel.log"
if [[ -n "$TUNNEL" ]]; then
  CONFIG="$HOME/.cloudflared/bolbridge-live.yml"
  mkdir -p "$HOME/.cloudflared"
  cat > "$CONFIG" <<EOF
tunnel: $TUNNEL
ingress:
  - service: http://127.0.0.1:$PORT
EOF
  "$CF" tunnel --no-autoupdate --protocol http2 --config "$CONFIG" run "$TUNNEL" >> "$LOGS/live-tunnel.log" 2>&1 &
  PIDS+=($!)
  URL="https://$DOMAIN"
else
  # http2 (TCP) survives a busy laptop better than the default QUIC (UDP).
  "$CF" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$PORT" >> "$LOGS/live-tunnel.log" 2>&1 &
  PIDS+=($!)
  URL=""
  for _ in $(seq 1 60); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/live-tunnel.log" | head -1 || true)
    [[ -n "$URL" ]] && break
    sleep 1
  done
  [[ -n "$URL" ]] || die "No tunnel address. See $LOGS/live-tunnel.log"
fi

OK=0
for _ in $(seq 1 45); do
  if curl -fsS "$URL/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[[ $OK -eq 1 ]] || printf '\n(%s is not answering yet; new addresses can take a minute. Tunnel log: %s)\n' "$URL" "$LOGS/live-tunnel.log"

cat <<EOF

  BolBridge is live:  $URL

  * Open it on any phone or laptop, sign up or log in.
  * Chrome extension: open its popup -> "Account and server" ->
      Translation server = $URL
      Account key        = the key shown on $URL/connect-extension
  * Full check from another terminal:
      cd $ROOT/server && source .venv/bin/activate && python ../deploy/smoke_test.py $URL

  Keep this window open. Ctrl+C stops the site.
EOF

wait -n "${PIDS[@]}" || true
printf '\nThe server or the tunnel stopped. Logs are in %s\n' "$LOGS"
