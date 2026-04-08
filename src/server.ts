import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { auditSite } from "./lib/audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const requestSchema = z.object({
  url: z.string().min(3),
  maxPages: z.number().int().min(1).max(10).optional(),
  renderJavascript: z.boolean().optional(),
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sequoia-audit",
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.post("/api/audit", async (req, res) => {
  try {
    const payload = requestSchema.parse(req.body);
    const report = await auditSite(payload.url, {
      maxPages: payload.maxPages,
      renderJavascript: payload.renderJavascript,
    });
    res.json(report);
  } catch (error) {
    console.error("Audit request failed:", error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid request payload.",
        details: error.issues,
      });
      return;
    }

    res.status(400).json({
      error: error instanceof Error ? error.message : "Audit failed.",
    });
  }
});

app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Sequoia Audit listening on http://localhost:${port}`);
});
