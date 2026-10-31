# Going live

One Ubuntu server runs everything: the web app, the API, the live translation
WebSocket and the models. Caddy puts it all behind one HTTPS address and renews
the certificate by itself.

```
browser / extension ──https/wss──▶ Caddy :443 ──▶ web app files (web/dist)
                                            └──▶ uvicorn 127.0.0.1:8000 (/api, /ws, /health)
```

## Free: go live from your own laptop

No server to rent. Cloudflare's free tunnel gives your laptop an `https`
address; the only possible cost is your own domain.

```bash
cd ~/bolbridge
bash deploy/live-from-laptop.sh
```

It builds the web app, starts the server on port 8080 with live settings
(`server/.env.live`: production mode, sign-in required) and prints an address
like `https://something.trycloudflare.com`. That address changes every run.

**Your own fixed address** (one-time setup, domain must use Cloudflare's free DNS):

```bash
~/.local/bin/cloudflared tunnel login                    # pick your domain in the browser
~/.local/bin/cloudflared tunnel create bolbridge
~/.local/bin/cloudflared tunnel route dns bolbridge bolbridge.yourdomain.in
TUNNEL=bolbridge DOMAIN=bolbridge.yourdomain.in bash deploy/live-from-laptop.sh
python extension/set-server.py https://bolbridge.yourdomain.in --out /mnt/c/Users/HP/bolbridge-extension
```

Limits: the site works only while the laptop is on, awake and online; speed is
the laptop's (CPU only). Quick `trycloudflare.com` addresses are meant for
testing, and the website cannot sign the extension in on them (paste the
account key in the extension instead). For real-time speed, use a GPU machine
below, ideally paid for with startup credits.

## 1. Pick a machine

| Option | Good for | Notes |
| --- | --- | --- |
| AWS EC2 `c7i.2xlarge` (8 vCPU, 16 GB), Mumbai | Going live today | CPU only, so a few seconds per sentence. No special quota needed |
| AWS EC2 `g4dn.xlarge` (NVIDIA T4), Mumbai | Real-time pilot | Ask AWS for "Running On-Demand G and VT instances" = 4 vCPUs first. Use the "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04)" |
| E2E Networks T4 / L4 (India, INR billing) | Cheaper GPU in India | Any Ubuntu 22.04/24.04 image with the NVIDIA driver |

Use Ubuntu 22.04 or 24.04, at least 60 GB of disk. Open ports 22 (your IP
only), 80 and 443. Give the machine a fixed IP (AWS: Elastic IP).

Stop the machine when you are not testing: you pay per hour while it runs.

## 2. Give it a name

HTTPS needs a domain name pointing at the server's IP. Free and quick:
[DuckDNS](https://www.duckdns.org): sign in, create `bolbridge-yourname`, paste
the server IP. Your address is `bolbridge-yourname.duckdns.org`.
A bought domain works the same way (an `A` record to the IP).

## 3. Install

From your laptop (WSL), copy the project and run the setup:

```bash
rsync -az --exclude '.venv' --exclude 'node_modules' --exclude 'server/data' --exclude 'server/.env' \
  -e "ssh -i ~/.ssh/bolbridge-key.pem" ~/bolbridge/ ubuntu@SERVER_IP:~/bolbridge/
ssh -i ~/.ssh/bolbridge-key.pem ubuntu@SERVER_IP \
  'sudo DOMAIN=bolbridge-yourname.duckdns.org bash ~/bolbridge/deploy/setup.sh'
```

The first run downloads the models (10–20 minutes). Run the same two commands
again to update the live site after changing code.

What it sets up:

- `/opt/bolbridge`: the code, `server/.venv`, `web/dist`
- `/etc/bolbridge/bolbridge.env`: live settings (secret key, models, `ALLOW_ANONYMOUS_WS=false`, `DEV_MODE=false`)
- `/var/lib/bolbridge`: database and model downloads
- `bolbridge.service` (systemd) and `/etc/caddy/Caddyfile`

## 4. Test it from outside

```bash
cd ~/bolbridge/server && source .venv/bin/activate
python ../deploy/smoke_test.py https://bolbridge-yourname.duckdns.org
```

It checks HTTPS, the web pages, sign-up and log-in, that strangers cannot use
the translator, and real speech both ways (Hindi → English, English → Hindi)
with the delay. Then test by hand: the Try page in Chrome and on a phone, and a
real WhatsApp Web call with the extension (see below).

## 5. Point the extension at the live server

```bash
python ~/bolbridge/extension/set-server.py https://bolbridge-yourname.duckdns.org \
  --out /mnt/c/Users/HP/bolbridge-extension
```

Reload BolBridge in `chrome://extensions`, then on the live site open
**Connect extension** and sign it in (or paste the account key in the
extension's "Account and server" section).

## Everyday commands (on the server)

```bash
sudo systemctl status bolbridge            # is it running?
sudo journalctl -u bolbridge -f            # live server log
sudo journalctl -u caddy -n 50             # HTTPS problems
sudo systemctl restart bolbridge           # after editing /etc/bolbridge/bolbridge.env
sudo bash ~/bolbridge/deploy/set-plan.sh you@example.com pro --reset   # give someone minutes
```

## Before real users

- Back up `/var/lib/bolbridge/data/bolbridge.db` (it holds the accounts).
- Add the privacy policy and terms pages, and payments.
- With more than a handful of users, move to a GPU machine and PostgreSQL.
