import express from "express";
import path from "node:path";
import { responseEnvelope } from "./middleware/http";
import devRouter from "./routes/dev";
import exportRouter from "./routes/export";
import healthRouter from "./routes/health";
import inventoryRouter from "./routes/inventory";
import itemsRouter from "./routes/items";
import locationsRouter from "./routes/locations";
import shortcutRouter from "./routes/shortcut";
import uploadsRouter from "./routes/uploads";

const app = express();
const publicDir = path.resolve(__dirname, "../public");

app.use(express.json());
app.use(responseEnvelope);
app.use(healthRouter);
app.use(locationsRouter);
app.use(itemsRouter);
app.use(shortcutRouter);
app.use(uploadsRouter);
app.use(inventoryRouter);
app.use(exportRouter);
app.use(devRouter);
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
