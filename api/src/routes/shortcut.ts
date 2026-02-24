import { Request, Response, Router } from "express";
import { markRawResponse } from "../middleware/http";
import { resolveInventoryScope } from "../auth/inventoryScope";
import { createInMemoryRateLimit } from "../middleware/rateLimit";
import { answerInventoryQuestion } from "../nli/inventoryAssistant";
import { env } from "../config/env";
import { normalizeOptionalText } from "../utils";

const shortcutRouter = Router();

shortcutRouter.use(
  createInMemoryRateLimit({
    keyPrefix: "shortcut-nli",
    max: 120,
    windowMs: 60_000,
  })
);

async function handleLookup(req: Request, res: Response) {
  markRawResponse(res);
  const q = normalizeOptionalText(req.query.q);
  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  const confirmRaw = normalizeOptionalText(req.query.confirm) ?? normalizeOptionalText(req.header("x-confirm-write"));
  const confirmed = !!confirmRaw && /^(1|true|yes|y|confirm)$/i.test(confirmRaw);
  const idempotencyKey =
    normalizeOptionalText(req.query.idempotency_key) ?? normalizeOptionalText(req.header("x-idempotency-key"));

  try {
    const scopeResult = await resolveInventoryScope(req);
    if (!scopeResult.ok) {
      return res.status(scopeResult.status).json({ error: scopeResult.message });
    }
    const payload = await answerInventoryQuestion(q, scopeResult.scope, {
      allowQuantityMutations: env.siriRequireMutationConfirmation ? confirmed : true,
      idempotencyKey,
    });
    console.log(
      JSON.stringify({
        event: "nli.lookup",
        intent: payload.intent,
        confidence: payload.confidence,
        fallback: payload.fallback,
        requires_confirmation: payload.requires_confirmation,
        confirmed,
        has_idempotency_key: !!idempotencyKey,
        query: q.slice(0, 180),
        auth_user_id: req.authUserId ?? null,
      })
    );
    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

shortcutRouter.get("/api/items/lookup", async (req, res) => {
  return handleLookup(req, res);
});

shortcutRouter.get("/shortcut/find-item", async (req, res) => {
  return handleLookup(req, res);
});

export default shortcutRouter;
