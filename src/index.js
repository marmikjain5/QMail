import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./lib/env.js";
import { registerRoutes } from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

registerRoutes(app);

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    error: err.message || "Internal server error"
  });
});

app.listen(env.PORT, () => {
  console.log(`QuMail server listening on http://localhost:${env.PORT}`);
});
