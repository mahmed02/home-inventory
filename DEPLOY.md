# deploy.md (First Deployment, No Domain Required)

This is the fastest path to get your MVP running on AWS before buying/configuring a domain.

## 1) What You Will Deploy

- API on one EC2 instance
- Postgres on RDS
- Images in S3
- Access API with EC2 public IP first (HTTP)

## 2) Create AWS Resources

1. Create an S3 bucket (example: `home-inventory-photos-staging`).
2. Create RDS PostgreSQL instance and database/user.
3. Launch EC2 (Ubuntu 22.04 recommended).
4. Security groups:
   - EC2 inbound: `22` (your IP), `4000` (your IP or temporary open for testing)
   - RDS inbound: `5432` from EC2 security group only

## 3) Configure EC2

SSH into EC2 and run:

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Clone and install:

```bash
git clone <YOUR_REPO_URL> /srv/home_inventory
cd /srv/home_inventory
npm --prefix ./api ci
```

Create env file:

```bash
cat > /srv/home_inventory/api/.env <<'ENV'
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://<DB_USER>:<DB_PASSWORD>@<RDS_HOST>:5432/<DB_NAME>
ENABLE_DEV_ROUTES=false
REQUIRE_AUTH=true
BASIC_AUTH_USER=<BASIC_AUTH_USER>
BASIC_AUTH_PASS=<BASIC_AUTH_PASS>
APP_BASE_URL=http://<EC2_PUBLIC_IP>:4000
AWS_REGION=us-east-1
S3_BUCKET=home-inventory-photos-staging
ENV
```

## 4) Run Migrations + Start API

```bash
cd /srv/home_inventory
npm --prefix ./api run migrate
npm install -g pm2
pm2 start "npm --prefix ./api run start" --name home-inventory-api
pm2 save
```

## 5) Verify From Your Laptop

```bash
curl http://<EC2_PUBLIC_IP>:4000/health
curl "http://<EC2_PUBLIC_IP>:4000/items/search?q=tool&limit=1&offset=0"
curl "http://<EC2_PUBLIC_IP>:4000/api/items/lookup?q=tool"
```

Run smoke test:

```bash
BASE_URL=http://<EC2_PUBLIC_IP>:4000 /Users/mohammedahmed/MyProjects/home_inventory/scripts/smoke.sh
```

## 6) S3 Upload Prerequisites

On S3 bucket, add CORS:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["http://<EC2_PUBLIC_IP>:4000", "http://localhost:4000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## 7) Move to Proper Staging Domain (Next)

After IP-based deploy is working:

1. Create `staging.<your-domain>` DNS.
2. Put Nginx/ALB in front.
3. Add HTTPS with ACM.
4. Update `APP_BASE_URL` to HTTPS domain.
5. Update smoke command with new `BASE_URL`.

Run HTTPS smoke check with uploads:

```bash
BASE_URL=https://staging.<your-domain> CHECK_UPLOADS=true /Users/mohammedahmed/MyProjects/home_inventory/scripts/smoke.sh

# If REQUIRE_AUTH=true:
BASE_URL=https://staging.<your-domain> BASIC_AUTH_USER=<BASIC_AUTH_USER> BASIC_AUTH_PASS=<BASIC_AUTH_PASS> CHECK_UPLOADS=true /Users/mohammedahmed/MyProjects/home_inventory/scripts/smoke.sh
```

## 7.1) Backup Automation (Staging/Prod)

Set a daily backup cron (example 03:30 UTC):

```bash
30 3 * * * BASE_URL=https://staging.<your-domain> BACKUP_DIR=/srv/home_inventory/backups RETAIN_DAYS=14 /srv/home_inventory/scripts/backup.sh >> /var/log/home-inventory-backup.log 2>&1
```

Run restore drill safely (validation only):

```bash
BASE_URL=https://staging.<your-domain> /srv/home_inventory/scripts/restore-drill.sh

# If REQUIRE_AUTH=true:
BASE_URL=https://staging.<your-domain> BASIC_AUTH_USER=<BASIC_AUTH_USER> BASIC_AUTH_PASS=<BASIC_AUTH_PASS> /srv/home_inventory/scripts/restore-drill.sh
```

## 8) Common Failure You Just Hit

If smoke script returns HTML/JS challenge page instead of JSON, your `BASE_URL` is not your API server. Use EC2 IP URL first until domain routing is configured.
