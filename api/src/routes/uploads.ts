import { randomUUID } from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import { sendInternalError, sendValidationError } from "../middleware/http";
import { normalizeOptionalText } from "../utils";

const uploadsRouter = Router();

type AwsClientS3Module = {
  S3Client: new (options: { region: string }) => unknown;
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    ContentType: string;
    CacheControl: string;
  }) => unknown;
};

type AwsPresignerModule = {
  getSignedUrl: (
    client: unknown,
    command: unknown,
    options: { expiresIn: number }
  ) => Promise<string>;
};

async function importModule(moduleName: string): Promise<unknown> {
  return import(moduleName);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

function inferExtension(contentType: string): string {
  if (contentType === "image/jpeg") {
    return "jpg";
  }
  if (contentType === "image/png") {
    return "png";
  }
  if (contentType === "image/webp") {
    return "webp";
  }
  if (contentType === "image/gif") {
    return "gif";
  }
  return "bin";
}

function publicS3Url(bucket: string, region: string, key: string): string {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

uploadsRouter.post("/uploads/presign", async (req, res) => {
  const fileNameRaw = normalizeOptionalText(req.body.filename);
  const contentType = normalizeOptionalText(req.body.content_type);
  const scopeRaw = normalizeOptionalText(req.body.scope) ?? "misc";

  if (!fileNameRaw || !contentType) {
    return sendValidationError(res, "filename and content_type are required");
  }

  if (!contentType.startsWith("image/")) {
    return sendValidationError(res, "content_type must be an image MIME type");
  }

  const scope = ["item", "location", "misc"].includes(scopeRaw) ? scopeRaw : "misc";

  if (!env.awsRegion || !env.s3Bucket) {
    return res.status(503).json({
      error: "S3 uploads are not configured (AWS_REGION/S3_BUCKET missing)",
    });
  }

  try {
    let clientS3: AwsClientS3Module;
    let presigner: AwsPresignerModule;
    try {
      [clientS3, presigner] = (await Promise.all([
        importModule("@aws-sdk/client-s3"),
        importModule("@aws-sdk/s3-request-presigner"),
      ])) as [AwsClientS3Module, AwsPresignerModule];
    } catch {
      return res.status(503).json({
        error:
          "S3 upload dependencies missing. Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner.",
      });
    }

    const fileName = sanitizeFileName(fileNameRaw);
    const safeName = fileName.length > 0 ? fileName : `upload.${inferExtension(contentType)}`;
    const key = `${scope}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;

    const client = new clientS3.S3Client({ region: env.awsRegion });
    const command = new clientS3.PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: "public,max-age=31536000,immutable",
    });

    const uploadUrl = await presigner.getSignedUrl(client, command, { expiresIn: 900 });
    const imageUrl = publicS3Url(env.s3Bucket, env.awsRegion, key);

    return res.status(200).json({
      upload_url: uploadUrl,
      image_url: imageUrl,
      key,
      expires_in: 900,
      max_size_mb: 10,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default uploadsRouter;
