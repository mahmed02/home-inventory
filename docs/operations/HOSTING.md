# Home Inventory Hosting (MVP Baseline)

This project is locked to an AWS deployment baseline for MVP.

## Selected Architecture

- API runtime: AWS EC2 (single Node.js service)
- Database: Amazon RDS for PostgreSQL
- Image storage: Amazon S3
- TLS certificates: AWS Certificate Manager (ACM)
- Public entrypoint: HTTPS DNS record to load balancer/reverse proxy in front of EC2

## Request/Data Flow

1. Browser or Siri Shortcut sends HTTPS request to API domain.
2. API on EC2 processes request.
3. API reads/writes inventory data in RDS PostgreSQL.
4. API reads/writes image objects in S3.

## MVP Deployment Notes

- Start as a single API instance for simplicity.
- Keep RDS and EC2 in the same AWS region.
- Use separate S3 buckets (or prefixes) for staging and production.
- Prefer IAM role credentials for EC2; avoid long-lived static AWS keys.
- Disable dev-only routes outside local dev (`ENABLE_DEV_ROUTES=false`).
- Enable API authentication for staging/production (`REQUIRE_AUTH=true` with Basic auth credentials).

## Environment Baseline

Reference `/Users/mohammedahmed/MyProjects/home_inventory/api/.env.example` and `/Users/mohammedahmed/MyProjects/home_inventory/api/README.md` for the exact local/staging/production env matrix.

## Out of Scope for Current MVP

- Multi-cloud hosting paths
- Managed frontend platforms outside AWS
- High-availability multi-region topology
