#!/bin/bash
set -euo pipefail

APP_DIR="/opt/sr-shoote-2r"
PUBLIC_URL="${PUBLIC_URL:-http://localhost}"
PORT="${PORT:-3850}"

echo "==> Installing system packages..."
sudo dnf update -y
sudo dnf install -y nginx tar

echo "==> Installing Node.js 20..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
  sudo dnf install -y nodejs
fi

echo "==> Setting up app in ${APP_DIR}..."
sudo mkdir -p "$APP_DIR"
sudo rm -rf "${APP_DIR:?}"/*
sudo tar -xzf /tmp/sr-shoote-2r-deploy.tar.gz -C "$APP_DIR"
sudo chown -R ec2-user:ec2-user "$APP_DIR"

cd "$APP_DIR"
npm install --omit=dev

# Ensure faces dir is writable for admin PNG uploads
mkdir -p public/assets/faces data
chmod -R u+rwX public/assets/faces data

# Keep HTTPS public URL if Let's Encrypt cert already exists
if sudo test -f /etc/letsencrypt/live/srshoot.engliew.xyz/fullchain.pem; then
  PUBLIC_URL="https://srshoot.engliew.xyz"
fi

cat > .env <<EOF
NODE_ENV=production
PORT=${PORT}
HOST=127.0.0.1
PUBLIC_URL=${PUBLIC_URL}
EOF

echo "==> Configuring nginx..."
sudo rm -f /etc/nginx/conf.d/default.conf
if sudo test -f /etc/letsencrypt/live/srshoot.engliew.xyz/fullchain.pem; then
  DOMAIN_NAME="srshoot.engliew.xyz"
  sudo tee /etc/nginx/conf.d/sr-shoote-2r.conf >/dev/null <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN_NAME};
    client_max_body_size 8m;
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name ${DOMAIN_NAME};
    client_max_body_size 8m;
    ssl_certificate /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
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
EOF
else
  sed "s/3850/${PORT}/g" deploy/nginx-sr-shoote-2r.conf | sudo tee /etc/nginx/conf.d/sr-shoote-2r.conf >/dev/null
fi
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "==> Configuring systemd service..."
sed "s/3850/${PORT}/g" deploy/sr-shoote-2r.service | sudo tee /etc/systemd/system/sr-shoote-2r.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable sr-shoote-2r
sudo systemctl restart sr-shoote-2r

echo "==> Done. Health check:"
sleep 2
curl -sS "http://127.0.0.1/health" || true
echo ""
systemctl is-active sr-shoote-2r || true
