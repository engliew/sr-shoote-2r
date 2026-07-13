#!/bin/bash
# Enable HTTPS with Let's Encrypt for SR Shooter 2 on the existing EC2 box.
# Usage (on your Mac, after DNS A record points at the instance):
#   DOMAIN=srshoot.engliew.xyz EMAIL=you@example.com ./deploy/enable-https.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/.deploy-env"

DOMAIN="${DOMAIN:-srshoot.engliew.xyz}"
EMAIL="${EMAIL:-}"
KEY_FILE="${KEY_FILE:-${SCRIPT_DIR}/sr-shoote-2r-key.pem}"
PUBLIC_IP="${PUBLIC_IP:?PUBLIC_IP missing in .deploy-env}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
INSTANCE_ID="${INSTANCE_ID:?INSTANCE_ID missing}"

if [[ -z "$EMAIL" ]]; then
  echo "Set EMAIL for Let's Encrypt notices, e.g.:"
  echo "  DOMAIN=srshoot.engliew.xyz EMAIL=you@example.com ./deploy/enable-https.sh"
  exit 1
fi

if [[ ! -f "$KEY_FILE" ]]; then
  echo "Missing SSH key: $KEY_FILE"
  exit 1
fi

echo "==> Ensuring security group allows HTTPS (443)..."
SG_ID=$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)
aws ec2 authorize-security-group-ingress \
  --region "$AWS_REGION" \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 2>/dev/null || echo "  (443 already open or rule exists)"

echo "==> Checking DNS for ${DOMAIN}..."
resolved=""
for attempt in 1 2 3 4 5 6; do
  # Prefer authoritative name.com NS if this is under engliew.xyz
  resolved=$(dig +short "${DOMAIN}" A @ns1psw.name.com 2>/dev/null | head -1 || true)
  if [[ -z "$resolved" ]]; then
    resolved=$(dig +short "${DOMAIN}" A @8.8.8.8 2>/dev/null | head -1 || true)
  fi
  # dig can return CNAME then A — take last IPv4-looking line
  if [[ "$resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    break
  fi
  # multi-line: take first IPv4
  resolved=$(dig +short "${DOMAIN}" A @8.8.8.8 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)
  if [[ -n "$resolved" ]]; then
    break
  fi
  echo "  attempt $attempt: not ready yet..."
  sleep 10
done

echo "  ${DOMAIN} -> ${resolved:-'(no A record)'}"
if [[ -z "$resolved" ]]; then
  echo ""
  echo "DNS is not ready for ${DOMAIN}."
  echo "In name.com → engliew.xyz → DNS records, create:"
  echo "  Type: A"
  echo "  Host: srshoot"
  echo "  Answer / Value: ${PUBLIC_IP}"
  echo "  TTL: 300 (or default)"
  echo ""
  echo "Do NOT only set records on the apex (engliew.xyz) if you want the game on the subdomain."
  echo "Wait a few minutes after saving, then re-run this script."
  exit 2
fi
if [[ "$resolved" != "$PUBLIC_IP" ]]; then
  echo "WARNING: ${DOMAIN} resolves to $resolved, expected $PUBLIC_IP"
  echo "Certbot may fail until DNS matches. Continuing in 5s..."
  sleep 5
fi

echo "==> Installing certbot + issuing certificate on EC2 for ${DOMAIN}..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEY_FILE" "ec2-user@${PUBLIC_IP}" bash -s <<REMOTE
set -euo pipefail
DOMAIN="${DOMAIN}"
EMAIL="${EMAIL}"
PUBLIC_URL="https://${DOMAIN}"

sudo dnf install -y certbot python3-certbot-nginx

# Point nginx server_name at this host (certbot will add 443 + redirect)
sudo tee /etc/nginx/conf.d/sr-shoote-2r.conf >/dev/null <<'NGINX'
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name DOMAIN_PLACEHOLDER;

    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3850;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
NGINX
sudo sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" /etc/nginx/conf.d/sr-shoote-2r.conf
sudo rm -f /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl reload nginx

# Single-host cert (subdomain only)
sudo certbot --nginx \
  -d "\${DOMAIN}" \
  --non-interactive --agree-tos -m "\${EMAIL}" \
  --redirect

if [[ -f /opt/sr-shoote-2r/.env ]]; then
  sudo sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=\${PUBLIC_URL}|" /opt/sr-shoote-2r/.env
else
  echo "PUBLIC_URL=\${PUBLIC_URL}" | sudo tee -a /opt/sr-shoote-2r/.env >/dev/null
fi
sudo systemctl restart sr-shoote-2r
sudo systemctl enable --now certbot-renew.timer 2>/dev/null || true

echo ""
echo "Health:"
curl -sS "https://\${DOMAIN}/health" || curl -sS "http://127.0.0.1/health" || true
echo ""
REMOTE

{
  grep -v '^PUBLIC_URL=\|^DOMAIN=\|^EMAIL=' "${SCRIPT_DIR}/.deploy-env" || true
  echo "DOMAIN=${DOMAIN}"
  echo "EMAIL=${EMAIL}"
  echo "PUBLIC_URL=https://${DOMAIN}"
} > "${SCRIPT_DIR}/.deploy-env.tmp"
mv "${SCRIPT_DIR}/.deploy-env.tmp" "${SCRIPT_DIR}/.deploy-env"

echo ""
echo "============================================"
echo "  HTTPS enabled for SR Shooter 2"
echo "  Players:   https://${DOMAIN}/"
echo "  Organiser: https://${DOMAIN}/admin.html"
echo "============================================"
echo "Cert auto-renews via certbot on the instance."
