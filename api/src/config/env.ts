import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

const projectEnvPath = path.resolve(__dirname, "../../.env");
const cwdEnvPath = path.resolve(process.cwd(), ".env");

if (fs.existsSync(projectEnvPath)) {
  dotenv.config({ path: projectEnvPath });
} else {
  dotenv.config({ path: cwdEnvPath });
}

const port = Number(process.env.PORT ?? "4000");
const databaseUrl = process.env.DATABASE_URL;
const appBaseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;
const awsRegion = process.env.AWS_REGION ?? "";
const s3Bucket = process.env.S3_BUCKET ?? "";

export function resolveEnableDevRoutes(): boolean {
  if (process.env.ENABLE_DEV_ROUTES === "true") {
    return true;
  }
  if (process.env.ENABLE_DEV_ROUTES === "false") {
    return false;
  }
  return process.env.NODE_ENV !== "production";
}

const enableDevRoutes = resolveEnableDevRoutes();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const env = {
  port,
  databaseUrl,
  enableDevRoutes,
  appBaseUrl,
  awsRegion,
  s3Bucket,
};
