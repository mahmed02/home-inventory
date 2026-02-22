import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { Router } from "express";
import { env } from "../config/env";
import { sendInternalError, sendValidationError } from "../middleware/http";
import { createInMemoryRateLimit } from "../middleware/rateLimit";
import {
  buildThumbnailKey,
  extractS3ObjectKeyFromPublicUrl,
  publicS3Url,
  THUMBNAIL_MAX_EDGE_PX,
} from "../media/thumbnails";
import { normalizeOptionalText } from "../utils";

const uploadsRouter = Router();
const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_KEY_PREFIXES = ["item/", "location/", "misc/"];

type AwsClientS3Module = {
  S3Client: new (options: { region: string }) => unknown;
  HeadObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  GetObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    ContentType: string;
    CacheControl: string;
    Body?: Buffer;
  }) => unknown;
};

type AwsPresignerModule = {
  getSignedUrl: (
    client: unknown,
    command: unknown,
    options: { expiresIn: number }
  ) => Promise<string>;
};

type SharpModule = {
  default: (input: Buffer) => {
    rotate: () => {
      resize: (
        width: number,
        height: number,
        options: { fit: "inside"; withoutEnlargement: boolean }
      ) => {
        webp: (options: { quality: number }) => {
          toBuffer: () => Promise<Buffer>;
        };
      };
    };
  };
};

async function importModule(moduleName: string): Promise<unknown> {
  return import(moduleName);
}

function isAllowedImageContentType(contentTypeRaw: string): boolean {
  const contentType = contentTypeRaw.toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(contentType);
}

function isAllowedUploadObjectKey(objectKey: string): boolean {
  return ALLOWED_KEY_PREFIXES.some((prefix) => objectKey.startsWith(prefix));
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

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error("Missing S3 object body");
  }

  if (body instanceof Buffer) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function"
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof body === "object" && body !== null && "on" in body) {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = body as {
        on: (event: string, handler: (...args: unknown[]) => void) => void;
      };

      stream.on("data", (chunk: unknown) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      });
      stream.on("error", (...errorArgs: unknown[]) => {
        reject(errorArgs[0] instanceof Error ? errorArgs[0] : new Error("Stream read failed"));
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  throw new Error("Unsupported S3 object body type");
}

uploadsRouter.use(
  createInMemoryRateLimit({
    keyPrefix: "uploads",
    max: 60,
    windowMs: 60_000,
  })
);

uploadsRouter.post("/uploads/presign", async (req, res) => {
  const fileNameRaw = normalizeOptionalText(req.body.filename);
  const contentType = normalizeOptionalText(req.body.content_type);
  const scopeRaw = normalizeOptionalText(req.body.scope) ?? "misc";

  if (!fileNameRaw || !contentType) {
    return sendValidationError(res, "filename and content_type are required");
  }

  if (!isAllowedImageContentType(contentType)) {
    return sendValidationError(
      res,
      "content_type must be one of image/jpeg, image/png, image/webp, image/gif"
    );
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
    const thumbnailKey = buildThumbnailKey(key);

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
      thumbnail_url: publicS3Url(env.s3Bucket, env.awsRegion, thumbnailKey),
      thumbnail_key: thumbnailKey,
      expires_in: 900,
      max_size_mb: MAX_UPLOAD_MB,
      max_size_bytes: MAX_UPLOAD_BYTES,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

uploadsRouter.post("/uploads/finalize", async (req, res) => {
  const imageUrl = normalizeOptionalText(req.body.image_url);

  if (!imageUrl) {
    return sendValidationError(res, "image_url is required");
  }

  if (!env.awsRegion || !env.s3Bucket) {
    return res.status(503).json({
      error: "S3 uploads are not configured (AWS_REGION/S3_BUCKET missing)",
    });
  }

  const sourceKey = extractS3ObjectKeyFromPublicUrl(imageUrl, env.s3Bucket, env.awsRegion);
  if (!sourceKey) {
    return sendValidationError(
      res,
      "image_url must be an S3 URL for the configured bucket and region"
    );
  }
  if (!isAllowedUploadObjectKey(sourceKey)) {
    return sendValidationError(res, "image_url is not in an allowed upload scope");
  }

  try {
    let clientS3: AwsClientS3Module;
    let sharpModule: SharpModule;
    try {
      [clientS3, sharpModule] = (await Promise.all([
        importModule("@aws-sdk/client-s3"),
        importModule("sharp"),
      ])) as [AwsClientS3Module, SharpModule];
    } catch {
      return res.status(503).json({
        error: "Thumbnail generation dependencies missing. Install @aws-sdk/client-s3 and sharp.",
      });
    }

    const client = new clientS3.S3Client({ region: env.awsRegion });
    const sourceHead = (await (
      client as {
        send: (command: unknown) => Promise<{ ContentLength?: number; ContentType?: string }>;
      }
    ).send(
      new clientS3.HeadObjectCommand({
        Bucket: env.s3Bucket,
        Key: sourceKey,
      })
    )) as { ContentLength?: number; ContentType?: string };

    if (
      typeof sourceHead.ContentLength !== "number" ||
      sourceHead.ContentLength < 1 ||
      sourceHead.ContentLength > MAX_UPLOAD_BYTES
    ) {
      return sendValidationError(
        res,
        `Uploaded image must be between 1 byte and ${MAX_UPLOAD_MB}MB`
      );
    }
    if (!sourceHead.ContentType || !isAllowedImageContentType(sourceHead.ContentType)) {
      return sendValidationError(
        res,
        "uploaded object content type must be image/jpeg, image/png, image/webp, or image/gif"
      );
    }

    const sourceObject = (await (
      client as {
        send: (command: unknown) => Promise<{ Body?: unknown }>;
      }
    ).send(
      new clientS3.GetObjectCommand({
        Bucket: env.s3Bucket,
        Key: sourceKey,
      })
    )) as { Body?: unknown };

    const sourceBuffer = await bodyToBuffer(sourceObject.Body);
    const thumbnailBuffer = await sharpModule
      .default(sourceBuffer)
      .rotate()
      .resize(THUMBNAIL_MAX_EDGE_PX, THUMBNAIL_MAX_EDGE_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbnailKey = buildThumbnailKey(sourceKey);
    await (
      client as {
        send: (command: unknown) => Promise<unknown>;
      }
    ).send(
      new clientS3.PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: "image/webp",
        CacheControl: "public,max-age=31536000,immutable",
      })
    );

    return res.status(200).json({
      thumbnail_url: publicS3Url(env.s3Bucket, env.awsRegion, thumbnailKey),
      thumbnail_key: thumbnailKey,
      max_edge_px: THUMBNAIL_MAX_EDGE_PX,
      format: "webp",
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default uploadsRouter;
