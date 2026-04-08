import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { LeadCapture, SiteAuditReport } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRoot = path.resolve(__dirname, "../../data");
const reportRoot = path.join(dataRoot, "reports");
const assetRoot = path.join(dataRoot, "report-assets");
const leadRoot = path.join(dataRoot, "leads");

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureReportStorage(): Promise<void> {
  await Promise.all([ensureDirectory(reportRoot), ensureDirectory(assetRoot), ensureDirectory(leadRoot)]);
}

export function createReportId(): string {
  return randomUUID();
}

export function buildReportLinks(reportId: string) {
  return {
    sharePath: `/reports/${reportId}`,
    jsonPath: `/api/reports/${reportId}`,
    pdfPath: `/api/reports/${reportId}/pdf`,
  };
}

export async function writeReportAsset(reportId: string, fileName: string, contents: Buffer | string): Promise<string> {
  await ensureReportStorage();
  const assetDir = path.join(assetRoot, reportId);
  await ensureDirectory(assetDir);
  await fs.writeFile(path.join(assetDir, fileName), contents);
  return `/saved-assets/${reportId}/${fileName}`;
}

export async function saveReport(report: SiteAuditReport): Promise<void> {
  await ensureReportStorage();
  const reportPath = path.join(reportRoot, `${report.reportId}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

export async function getSavedReport(reportId: string): Promise<SiteAuditReport | null> {
  try {
    const reportPath = path.join(reportRoot, `${reportId}.json`);
    const raw = await fs.readFile(reportPath, "utf8");
    return JSON.parse(raw) as SiteAuditReport;
  } catch {
    return null;
  }
}

export async function saveLeadCapture(
  reportId: string,
  lead: Omit<LeadCapture, "id" | "reportId" | "createdAt">,
): Promise<LeadCapture> {
  await ensureReportStorage();
  const leadPath = path.join(leadRoot, `${reportId}.json`);
  const record: LeadCapture = {
    id: randomUUID(),
    reportId,
    email: lead.email,
    name: lead.name,
    company: lead.company,
    createdAt: new Date().toISOString(),
  };

  let existing: LeadCapture[] = [];
  try {
    existing = JSON.parse(await fs.readFile(leadPath, "utf8")) as LeadCapture[];
  } catch {
    existing = [];
  }

  existing.push(record);
  await fs.writeFile(leadPath, JSON.stringify(existing, null, 2), "utf8");
  return record;
}

export async function getReportAssetBuffer(reportId: string, fileName: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(assetRoot, reportId, fileName));
  } catch {
    return null;
  }
}
