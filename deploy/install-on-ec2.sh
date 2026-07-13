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

cat > .env <<EOF
NODE_ENV=production
PORT=${PORT}
HOST=127.0.0.1
PUBLIC_URL=${PUBLIC_URL}
EOF

echo "==> Configuring nginx..."
# Inject port into nginx conf if needed
sed "s/3850/${PORT}/g" deploy/nginx-sr-shoote-2r.conf | sudo tee /etc/nginx/conf.d/sr-shoote-2r.conf >/dev/null
sudo rm -f /etc/nginx/conf.d/default.conf
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
