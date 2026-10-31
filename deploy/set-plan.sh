#!/usr/bin/env bash
# Owner tool on the live server: change a user's plan and optionally reset their minutes.
#   sudo bash deploy/set-plan.sh you@example.com pro --reset
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
APP_DIR="${APP_DIR:-/opt/bolbridge}"
sudo -u bolbridge bash -c "set -a; . /etc/bolbridge/bolbridge.env; set +a; cd '$APP_DIR/server' && .venv/bin/python scripts/set_plan.py $(printf '%q ' "$@")"
