# CI/CD Setup (GitHub Actions -> AWS EC2 via OIDC + SSM)

This pipeline keeps CI in GitHub and deploys to EC2 without SSH keys.

## 1) What Is Implemented

- CI workflow: `/Users/mohammedahmed/MyProjects/home_inventory/.github/workflows/ci.yml`
- CD workflow: `/Users/mohammedahmed/MyProjects/home_inventory/.github/workflows/deploy.yml`
- EC2 deploy script: `/Users/mohammedahmed/MyProjects/home_inventory/scripts/deploy.sh`
- EC2 rollback script: `/Users/mohammedahmed/MyProjects/home_inventory/scripts/rollback.sh`

Deploy triggers:
- Push to `main` -> deploy to `staging` environment
- Manual dispatch -> deploy or rollback to `staging` or `production`

## 2) GitHub Environment Configuration

Create GitHub Environments:
- `staging`
- `production`

For each environment, set:

Environment variables:
- `AWS_REGION` (example: `us-east-1`)
- `EC2_INSTANCE_ID` (target EC2 instance id)
- `APP_DIR` (optional, default `/srv/home_inventory`)
- `PROCESS_NAME` (optional, default `home-inventory-api`)

Environment secret:
- `AWS_DEPLOY_ROLE_ARN` (IAM role assumed by GitHub via OIDC)

## 3) IAM Role for GitHub OIDC

Create IAM OIDC provider (once):
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Create IAM role (example `GitHubActionsHomeInventoryDeployRole`) with trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:<ORG_OR_USER>/home_inventory:ref:refs/heads/main",
            "repo:<ORG_OR_USER>/home_inventory:environment:staging",
            "repo:<ORG_OR_USER>/home_inventory:environment:production"
          ]
        }
      }
    }
  ]
}
```

Attach policy to role (minimum for deploy workflow):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

## 4) EC2 Requirements

EC2 instance role must include:
- `AmazonSSMManagedInstanceCore`
- S3 access required by your app (`s3:GetObject`, `s3:PutObject`, etc.)

On EC2, ensure repo exists at `APP_DIR` and PM2 process name matches.

## 5) How Deploy Works

`deploy.sh` on EC2 executes:
1. `git fetch` + `git checkout` target ref
2. `npm --prefix ./api ci`
3. install AWS S3 SDK runtime deps (no-save)
4. `npm --prefix ./api run migrate`
5. `npm --prefix ./api run build`
6. `pm2 restart home-inventory-api` (or start if missing)
7. local health/search smoke checks against `127.0.0.1:4000`

## 6) Manual Deploy / Rollback

In GitHub Actions UI:
1. Run workflow `Deploy API`
2. Choose:
   - `action=deploy` and optional `ref`
   - or `action=rollback` with required `ref` (previous known-good SHA)
3. Choose environment (`staging`/`production`)

## 7) Recommended Hardening

- Restrict deploy role trust policy to exact repo + environment.
- Add production environment approval gate.
- Add post-deploy external smoke step (`scripts/smoke.sh`) for public HTTPS endpoints.
- Move runtime secrets from `.env` to SSM Parameter Store or Secrets Manager.
