import express from "express";
import path from "node:path";
import { requireBasicAuth } from "./middleware/auth";
import { attachUserSession, requireUserSession } from "./middleware/userAuth";
import { corsPolicy, securityHeaders } from "./middleware/security";
import { responseEnvelope } from "./middleware/http";
import authRouter from "./routes/auth";
import devRouter from "./routes/dev";
import exportRouter from "./routes/export";
import healthRouter from "./routes/health";
import householdsRouter from "./routes/households";
import inventoryRouter from "./routes/inventory";
import itemsRouter from "./routes/items";
import locationsRouter from "./routes/locations";
import shortcutRouter from "./routes/shortcut";
import uploadsRouter from "./routes/uploads";

const app = express();
const publicDir = path.resolve(__dirname, "../public");

app.use(express.json({ limit: "1mb" }));
app.use(responseEnvelope);
app.use(securityHeaders);
app.use(corsPolicy);
app.use(requireBasicAuth);
app.use(attachUserSession);
app.use(healthRouter);
app.use(authRouter);
app.use(express.static(publicDir, { index: false }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "landing.html"));
});

app.get("/auth", (_req, res) => {
  res.sendFile(path.join(publicDir, "auth.html"));
});

app.get("/inventory", (_req, res) => {
  res.sendFile(path.join(publicDir, "inventory.html"));
});

app.get("/manage-household", (_req, res) => {
  res.sendFile(path.join(publicDir, "manage-household.html"));
});

app.use(requireUserSession);
app.use(householdsRouter);
app.use(locationsRouter);
app.use(itemsRouter);
app.use(shortcutRouter);
app.use(uploadsRouter);
app.use(inventoryRouter);
app.use(exportRouter);
app.use(devRouter);

export default app;
