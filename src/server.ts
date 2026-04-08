import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { auditSite } from "./lib/audit.js";
import { generateReportPdf } from "./lib/pdf.js";
import { ensureReportStorage, getSavedReport, saveLeadCapture, saveReport } from "./lib/report-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const assetDir = path.resolve(__dirname, "../data/report-assets");

const requestSchema = z.object({
  url: z.string().min(3),
  maxPages: z.number().int().min(1).max(10).optional(),
  renderJavascript: z.boolean().optional(),
  runLighthouse: z.boolean().optional(),
});
const leadSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100).optional(),
  company: z.string().trim().min(1).max(100).optional(),
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/saved-assets", express.static(assetDir));
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
      runLighthouse: payload.runLighthouse,
    });
    await saveReport(report);
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

app.get("/api/reports/:reportId", async (req, res) => {
  const report = await getSavedReport(req.params.reportId);

  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }

  res.json(report);
});

app.post("/api/reports/:reportId/lead", async (req, res) => {
  try {
    const report = await getSavedReport(req.params.reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }

    const payload = leadSchema.parse(req.body);
    const lead = await saveLeadCapture(req.params.reportId, payload);
    res.json({ success: true, lead });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid lead data.", details: error.issues });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save lead." });
  }
});

app.get("/api/reports/:reportId/pdf", async (req, res) => {
  const report = await getSavedReport(req.params.reportId);

  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }

  try {
    const pdf = await generateReportPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="sequoia-audit-${report.reportId}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to generate PDF.",
    });
  }
});

app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT ?? 3000);
ensureReportStorage()
  .then(() => {
    app.listen(port, () => {
      console.log(`Sequoia Audit listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage:", error);
    process.exit(1);
  });
