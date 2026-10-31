#!/usr/bin/env bash
# BolBridge: set up (or update) a live server on a fresh Ubuntu 22.04 / 24.04
# machine: AWS EC2, E2E Networks or any VPS. Safe to run again after code changes.
#
#   sudo DOMAIN=bolbridge-yourname.duckdns.org bash deploy/setup.sh
#
# It installs the system packages, Node.js and Caddy (automatic HTTPS), builds
# a Python environment with the open-source models, builds the web app, runs the
# translation server as a systemd service behind Caddy and warms the models up.
#
# Needs: DOMAIN pointing at this server's public IP, and ports 22, 80 and 443 open.
# With an NVIDIA GPU (driver installed), it uses the GPU and larger, more accurate models.
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EXTENSION_ID="${EXTENSION_ID:-}"
APP_DIR="${APP_DIR:-/opt/bolbridge}"
APP_USER=bolbridge
STATE_DIR=/var/lib/bolbridge
ENV_FILE=/etc/bolbridge/bolbridge.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$APP_DIR/server/.venv"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo DOMAIN=... bash deploy/setup.sh"
[[ -n "$DOMAIN" ]] || die "Set DOMAIN, for example: sudo DOMAIN=bolbridge-yourname.duckdns.org bash deploy/setup.sh"
[[ "$DOMAIN" != *"://"* && "$DOMAIN" != */* ]] || die "DOMAIN is a name only, like bolbridge-yourname.duckdns.org (no https://, no slash)"

# ---------------------------------------------------------------- packages
log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-dev build-essential espeak-ng curl rsync \
  ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

PY_VER=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
case "$PY_VER" in
  3.10|3.11|3.12) ;;
  *) die "Python $PY_VER found. Kokoro needs Python 3.10 to 3.12: use Ubuntu 22.04 or 24.04." ;;
esac

log "Node.js 22"
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

log "Caddy (web server with automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ---------------------------------------------------------------- memory
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
if [[ $(swapon --show --noheadings | wc -l) -eq 0 && $MEM_GB -lt 31 ]]; then
  log "Adding 8 GB swap (RAM is ${MEM_GB} GB)"
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------- GPU
GPU=0
if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
  GPU=1
  log "GPU found: $(nvidia-smi -L | head -1)"
elif grep -qs 0x10de /sys/bus/pci/devices/*/vendor; then
  die "This machine has an NVIDIA GPU but no driver. Use an image with the driver (AWS: 'Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04)') or install it, then run this again."
else
  log "No GPU: running the models on the CPU"
fi

# ---------------------------------------------------------------- code
log "Copying the code to $APP_DIR"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$STATE_DIR/data" "$STATE_DIR/hf-cache" /etc/bolbridge "$APP_DIR"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete \
    --exclude '.git' --exclude 'server/.venv' --exclude 'server/.env' --exclude 'server/data' \
    --exclude 'web/node_modules' --exclude 'web/dist' --exclude 'web/.env*' \
    --exclude '__pycache__' --exclude '.pytest_cache' \
    "$SRC_DIR/" "$APP_DIR/"
fi
chmod -R a+rX "$APP_DIR"

# ---------------------------------------------------------------- python
log "Python packages (the first time this downloads a few GB)"
[[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip wheel
if ! "$VENV/bin/python" -c 'import torch' 2>/dev/null; then
  if [[ $GPU -eq 1 ]]; then
    "$VENV/bin/pip" install -q torch
  else
    "$VENV/bin/pip" install -q torch --index-url https://download.pytorch.org/whl/cpu
  fi
fi
"$VENV/bin/pip" install -q -r "$APP_DIR/server/requirements-ml.txt"

# ---------------------------------------------------------------- settings
if [[ ! -f "$ENV_FILE" ]]; then
  log "Writing $ENV_FILE"
  SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
  if [[ $GPU -eq 1 ]]; then
    WHISPER=large-v3-turbo; M2M=facebook/m2m100_1.2B; M2M_CT2=michaelfeil/ct2fast-m2m100_1.2B
  else
    WHISPER=small; M2M=facebook/m2m100_418M; M2M_CT2=jncraton/m2m100_418M-ct2-int8
  fi
  cat > "$ENV_FILE" <<EOF
# BolBridge live settings. After editing: sudo systemctl restart bolbridge
APP_ENV=production
SECRET_KEY=$SECRET
CORS_ORIGINS=https://$DOMAIN
# Only signed-in users can translate, so nobody else spends your server time.
ALLOW_ANONYMOUS_WS=false
# false = plans change only through payments or deploy/set-plan.sh
DEV_MODE=false
DATA_DIR=$STATE_DIR/data
HF_HOME=$STATE_DIR/hf-cache
ENGINE_PRESET=open-source
WHISPER_MODEL=$WHISPER
M2M_MODEL=$M2M
M2M_CT2_MODEL=$M2M_CT2
MT_ENGINE=m2m100-ct2
HINDI_ASR=indicconformer
EUROPEAN_ASR=parakeet
WARMUP_LANGS=hi,en
EOF
fi
for kv in MT_ENGINE=m2m100-ct2 EUROPEAN_ASR=parakeet WARMUP_LANGS=hi,en; do
  grep -q "^${kv%%=*}=" "$ENV_FILE" || echo "$kv" >> "$ENV_FILE"   # settings added in later versions
done
sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=https://$DOMAIN#" "$ENV_FILE"

if [[ $GPU -eq 1 ]]; then
  # faster-whisper on the GPU needs the cuBLAS and cuDNN libraries that come with torch.
  LIBS=$("$VENV/bin/python" - <<'EOF'
import os
paths = []
for name in ("nvidia.cublas.lib", "nvidia.cudnn.lib"):
    try:
        mod = __import__(name, fromlist=["_"])
        paths.append(os.path.dirname(mod.__file__) if getattr(mod, "__file__", None) else list(mod.__path__)[0])
    except Exception:
        pass
print(":".join(paths))
EOF
)
  sed -i '/^LD_LIBRARY_PATH=/d' "$ENV_FILE"
  [[ -n "$LIBS" ]] && echo "LD_LIBRARY_PATH=$LIBS" >> "$ENV_FILE"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# ---------------------------------------------------------------- web app
log "Building the web app for https://$DOMAIN"
cd "$APP_DIR/web"
npm install --no-audit --no-fund
VITE_API_URL="https://$DOMAIN" VITE_EXTENSION_ID="$EXTENSION_ID" npm run build
chmod -R a+rX "$APP_DIR/web/dist"
cd - >/dev/null

# ---------------------------------------------------------------- models
chown -R "$APP_USER:$APP_USER" "$STATE_DIR" "$VENV"
log "Downloading and warming up the models (first time: 10-20 minutes)"
sudo -u "$APP_USER" bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR/server' && '$VENV/bin/python' scripts/warmup.py"
chown -R "$APP_USER:$APP_USER" "$VENV"

# ---------------------------------------------------------------- services
log "Starting the translation server"
cat > /etc/systemd/system/bolbridge.service <<EOF
[Unit]
Description=BolBridge translation server
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$VENV/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --ws-ping-timeout 120 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=5
TimeoutStartSec=900

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
# BolBridge: web app and API on one address, HTTPS certificate managed by Caddy.
$DOMAIN {
	encode zstd gzip
	@api path /api/* /ws/* /health /docs /openapi.json
	handle @api {
		reverse_proxy 127.0.0.1:8000
	}
	handle {
		root * $APP_DIR/web/dist
		try_files {path} /index.html
		file_server
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

systemctl daemon-reload
systemctl enable bolbridge >/dev/null
systemctl restart bolbridge
systemctl enable caddy >/dev/null
systemctl restart caddy

log "Waiting for the models to load"
for _ in $(seq 1 180); do
  curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS http://127.0.0.1:8000/health || die "The server did not start. See: sudo journalctl -u bolbridge -n 100"
echo

log "Checking HTTPS (Caddy fetches a certificate on the first visit)"
OK=0
for _ in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 5
done
if [[ $OK -eq 1 ]]; then
  log "BolBridge is live: https://$DOMAIN"
else
  printf '\nHTTPS is not ready. Check that %s points to this server and ports 80 and 443 are open.\nLogs: sudo journalctl -u caddy -n 50\n' "$DOMAIN"
  exit 1
fi
