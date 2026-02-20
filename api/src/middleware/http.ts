import { NextFunction, Request, Response } from "express";

type ApiEnvelope = {
  ok: boolean;
  data?: unknown;
  error?: { message: string };
};

const RAW_RESPONSE_KEY = "__raw_response__";

export function markRawResponse(res: Response): void {
  (res.locals as Record<string, unknown>)[RAW_RESPONSE_KEY] = true;
}

function isRawResponse(res: Response): boolean {
  return Boolean((res.locals as Record<string, unknown>)[RAW_RESPONSE_KEY]);
}

function hasEnvelopeShape(value: unknown): value is ApiEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "ok" in value;
}

export function responseEnvelope(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = ((body?: unknown) => {
    if (isRawResponse(res)) {
      return originalJson(body);
    }

    if (hasEnvelopeShape(body)) {
      return originalJson(body);
    }

    if (res.statusCode >= 400) {
      if (typeof body === "object" && body !== null && "error" in body) {
        const errorValue = (body as { error: unknown }).error;
        const message =
          typeof errorValue === "string"
            ? errorValue
            : typeof errorValue === "object" &&
                errorValue !== null &&
                "message" in errorValue &&
                typeof (errorValue as { message: unknown }).message === "string"
              ? (errorValue as { message: string }).message
              : "Request failed";

        return originalJson({
          ok: false,
          error: { message },
        } satisfies ApiEnvelope);
      }

      return originalJson({
        ok: false,
        error: { message: "Request failed" },
      } satisfies ApiEnvelope);
    }

    return originalJson({
      ok: true,
      data: body ?? null,
    } satisfies ApiEnvelope);
  }) as Response["json"];

  next();
}

export function getDbErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

export function sendInternalError(error: unknown, res: Response) {
  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
}

export function sendValidationError(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

export function sendNotFound(res: Response, message: string) {
  return res.status(404).json({ error: message });
}

export function sendConflict(res: Response, message: string) {
  return res.status(409).json({ error: message });
}
