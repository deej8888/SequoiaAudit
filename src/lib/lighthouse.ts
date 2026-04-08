import lighthouse, { desktopConfig } from "lighthouse";
import { launch } from "chrome-launcher";
import { compactBrowserErrorMessage, getPlaywrightChromiumPath } from "./browser-runtime.js";
import { writeReportAsset } from "./report-store.js";
import type { LighthouseEvidence, LighthouseRun } from "./types.js";

const categoryDefinitions = [
  { id: "performance", label: "Performance" },
  { id: "accessibility", label: "Accessibility" },
  { id: "best-practices", label: "Best Practices" },
  { id: "seo", label: "SEO" },
] as const;

const metricAuditIds = [
  { id: "first-contentful-paint", label: "First Contentful Paint" },
  { id: "largest-contentful-paint", label: "Largest Contentful Paint" },
  { id: "speed-index", label: "Speed Index" },
  { id: "total-blocking-time", label: "Total Blocking Time" },
  { id: "cumulative-layout-shift", label: "Cumulative Layout Shift" },
  { id: "interactive", label: "Time to Interactive" },
] as const;

const opportunityAuditIds = [
  "render-blocking-resources",
  "unused-javascript",
  "unused-css-rules",
  "offscreen-images",
  "modern-image-formats",
  "uses-text-compression",
  "server-response-time",
  "redirects",
] as const;

function buildChromeFlags(): string[] {
  return ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"];
}

function buildCategoryScores(lhr: any): LighthouseRun["categoryScores"] {
  return categoryDefinitions.map((category) => ({
    id: category.id,
    label: category.label,
    score: Math.round((lhr.categories?.[category.id]?.score ?? 0) * 100),
  }));
}

function buildMetrics(lhr: any): LighthouseRun["metrics"] {
  return metricAuditIds
    .map((metric) => ({
      id: metric.id,
      label: metric.label,
      value: lhr.audits?.[metric.id]?.displayValue ?? "n/a",
    }))
    .filter((metric) => metric.value !== "n/a");
}

function buildOpportunities(lhr: any): LighthouseRun["opportunities"] {
  return opportunityAuditIds
    .map((id) => ({
      id,
      label: lhr.audits?.[id]?.title ?? id,
      displayValue: lhr.audits?.[id]?.displayValue ?? "",
      score: lhr.audits?.[id]?.score ?? 1,
    }))
    .filter((audit) => audit.displayValue && audit.score < 0.95)
    .sort((left, right) => left.score - right.score)
    .slice(0, 5)
    .map(({ id, label, displayValue }) => ({ id, label, displayValue }));
}

async function runSingleLighthouse(siteUrl: string, reportId: string, formFactor: "mobile" | "desktop"): Promise<LighthouseRun> {
  const chromePath = process.env.CHROME_PATH || getPlaywrightChromiumPath();

  if (!chromePath) {
    throw new Error('No Chromium executable was found. Set CHROME_PATH or run "npx playwright install chromium".');
  }

  const chrome = await launch({
    chromePath,
    chromeFlags: buildChromeFlags(),
    logLevel: "silent",
  });

  try {
    const runnerResult = await lighthouse(
      siteUrl,
      {
        port: chrome.port,
        output: "html",
        logLevel: "error",
        onlyCategories: categoryDefinitions.map((category) => category.id),
      } as any,
      formFactor === "desktop" ? (desktopConfig as any) : undefined,
    );

    if (!runnerResult) {
      throw new Error("Lighthouse did not return a result.");
    }

    const lhr = runnerResult.lhr;
    const htmlReport = typeof runnerResult.report === "string" ? runnerResult.report : String(runnerResult.report);
    const htmlReportUrl = await writeReportAsset(reportId, `lighthouse-${formFactor}.html`, htmlReport);
    const jsonReportUrl = await writeReportAsset(reportId, `lighthouse-${formFactor}.json`, JSON.stringify(lhr, null, 2));

    return {
      formFactor,
      finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl || siteUrl,
      categoryScores: buildCategoryScores(lhr),
      metrics: buildMetrics(lhr),
      opportunities: buildOpportunities(lhr),
      reportHtmlUrl: htmlReportUrl,
      reportJsonUrl: jsonReportUrl,
    };
  } finally {
    await chrome.kill();
  }
}

export async function runLighthouseEvidence(siteUrl: string, reportId: string): Promise<LighthouseEvidence> {
  try {
    const mobile = await runSingleLighthouse(siteUrl, reportId, "mobile");
    const desktop = await runSingleLighthouse(siteUrl, reportId, "desktop");

    return {
      status: "ok",
      notes: [],
      mobile,
      desktop,
    };
  } catch (error) {
    return {
      status: "unavailable",
      notes: [compactBrowserErrorMessage(error)],
    };
  }
}
