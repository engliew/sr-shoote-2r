# SR Shooter 2 — AWS EC2 Deployment

Deploys the multiplayer game to a **t3.micro** EC2 instance (Free Tier eligible) in **ap-southeast-1** by default.

## Prerequisites

- AWS credentials with EC2 permissions (`aws sts get-caller-identity` works)
- Node.js 18+ on your Mac (for the provisioner)

## First-time deploy

```bash
cd ~/Projects/sr-shoote-2r
./deploy/deploy.sh
```

Optional:

```bash
AWS_REGION=ap-southeast-1 INSTANCE_TYPE=t3.micro ./deploy/deploy.sh
```

## After deploy

| Role | URL |
|------|-----|
| Players | `http://YOUR_EC2_IP/` |
| Organiser | `http://YOUR_EC2_IP/admin.html` |
| Health | `http://YOUR_EC2_IP/health` |

State is saved in `deploy/.deploy-env` (instance id, IP, key path).

## Redeploy code changes

```bash
cd ~/Projects/sr-shoote-2r
REDEPLOY=1 ./deploy/deploy.sh
```

## Teardown

```bash
source deploy/.deploy-env
aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID"
```

## HTTPS + domain (`engliew.xyz`)

1. **Register** [engliew.xyz](https://porkbun.com/checkout/domains?search=engliew.xyz) (Porkbun ~US$2 first year / ~$13 renew).
   AWS Free Tier cannot buy domains via Route 53 Domains — purchase at the registrar in a browser.

2. At the registrar, set DNS **A** records to the Elastic IP in `deploy/.deploy-env` (`PUBLIC_IP`):
   ```
   A    engliew.xyz        YOUR_ELASTIC_IP
   A    www.engliew.xyz    YOUR_ELASTIC_IP
   ```

3. After DNS resolves (check with `dig +short engliew.xyz`), enable TLS:
   ```bash
   cd ~/Projects/sr-shoote-2r
   DOMAIN=engliew.xyz EMAIL=you@example.com ./deploy/enable-https.sh
   ```

4. Share:
   - Players: `https://engliew.xyz/`
   - Organiser: `https://engliew.xyz/admin.html`

Certbot renews automatically on the instance. Redeploys keep the cert; only re-run `enable-https.sh` if nginx conf is wiped.

## Notes

- App runs on `127.0.0.1:3850` behind **nginx** (ports 80/443 + WebSocket upgrade / `wss`).
- Face PNG uploads write to `public/assets/faces/` on the instance.
- Separate from the older `sr-shooter` instance if both are running.
