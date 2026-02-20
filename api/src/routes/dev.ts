import { Router } from "express";
import { resolveEnableDevRoutes } from "../config/env";
import { seedInventoryData } from "../db/devData";
import { sendInternalError } from "../middleware/http";

const devRouter = Router();

function ensureDevEnabled(): string | null {
  if (!resolveEnableDevRoutes()) {
    return "Dev routes are disabled";
  }
  return null;
}

devRouter.post("/dev/seed", async (_req, res) => {
  const disabledReason = ensureDevEnabled();
  if (disabledReason) {
    return res.status(403).json({ error: disabledReason });
  }

  try {
    await seedInventoryData();
    return res.status(200).json({ seeded: true });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default devRouter;
