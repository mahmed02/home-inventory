import path from "node:path";
import { URL } from "node:url";

export const THUMBNAIL_MAX_EDGE_PX = 360;

export function sanitizeS3ObjectKey(value: string): string {
  return value.replace(/^\/+/, "");
}

export function publicS3Url(bucket: string, region: string, key: string): string {
  const encodedKey = sanitizeS3ObjectKey(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function extractS3ObjectKeyFromPublicUrl(
  imageUrl: string,
  bucket: string,
  region: string
): string | null {
  try {
    const parsed = new URL(imageUrl);
    const allowedHosts = new Set([
      `${bucket}.s3.${region}.amazonaws.com`,
      `${bucket}.s3.amazonaws.com`,
    ]);

    if (!allowedHosts.has(parsed.host)) {
      return null;
    }

    const key = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function buildThumbnailKey(sourceObjectKey: string): string {
  const normalized = sanitizeS3ObjectKey(sourceObjectKey);
  const directory = path.posix.dirname(normalized);
  const ext = path.posix.extname(normalized);
  const basename = path.posix.basename(normalized, ext);
  const relative = directory === "." ? basename : `${directory}/${basename}`;

  return `thumbnails/${relative}.thumb.webp`;
}

export function deriveThumbnailUrlFromImageUrl(
  imageUrl: string | null,
  bucket: string,
  region: string
): string | null {
  if (!imageUrl || !bucket || !region) {
    return null;
  }

  const key = extractS3ObjectKeyFromPublicUrl(imageUrl, bucket, region);
  if (!key) {
    return null;
  }

  return publicS3Url(bucket, region, buildThumbnailKey(key));
}
