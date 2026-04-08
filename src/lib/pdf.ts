import path from "node:path";
import type { SiteAuditReport } from "./types.js";
import { getReportAssetBuffer } from "./report-store.js";
import { compactBrowserErrorMessage, getSharedPlaywrightBrowser } from "./browser-runtime.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function assetUrlToDataUrl(reportId: string, assetUrl?: string): Promise<string | undefined> {
  if (!assetUrl) {
    return undefined;
  }

  const fileName = path.basename(assetUrl);
  const buffer = await getReportAssetBuffer(reportId, fileName);
  if (!buffer) {
    return undefined;
  }

  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function renderCategoryCards(report: SiteAuditReport): string {
  return report.categoryScores
    .map(
      (category) => `
        <div class="score-card">
          <div class="muted">${escapeHtml(category.label)}</div>
          <div class="score">${escapeHtml(String(category.score))}</div>
          <div>${escapeHtml(category.summary)}</div>
        </div>
      `,
    )
    .join("");
}

function renderIssues(report: SiteAuditReport): string {
  return report.issues
    .slice(0, 8)
    .map(
      (issue) => `
        <div class="issue">
          <div class="issue-title">${escapeHtml(issue.title)}</div>
          <div class="muted">${escapeHtml(issue.category)} · ${escapeHtml(issue.severity)}</div>
          <p>${escapeHtml(issue.description)}</p>
          <p><strong>Recommendation:</strong> ${escapeHtml(issue.recommendation)}</p>
        </div>
      `,
    )
    .join("");
}

function renderWins(report: SiteAuditReport): string {
  return report.wins.map((win) => `<li>${escapeHtml(win)}</li>`).join("");
}

function renderLighthouse(report: SiteAuditReport): string {
  if (!report.lighthouse || report.lighthouse.status !== "ok") {
    return "";
  }

  const runs = [report.lighthouse.mobile, report.lighthouse.desktop].filter(
    (run): run is NonNullable<typeof run> => Boolean(run),
  );
  return runs
    .map(
      (run) => `
        <div class="issue">
          <div class="issue-title">${escapeHtml(run.formFactor.toUpperCase())} Lighthouse</div>
          <div class="metric-grid">
            ${run.categoryScores
              .map(
                (category) => `
                  <div class="metric">
                    <div class="muted">${escapeHtml(category.label)}</div>
                    <div class="metric-value">${escapeHtml(String(category.score))}</div>
                  </div>
                `,
              )
              .join("")}
          </div>
          <div class="muted">Key metrics</div>
          <ul>${run.metrics.map((metric) => `<li>${escapeHtml(`${metric.label}: ${metric.value}`)}</li>`).join("")}</ul>
        </div>
      `,
    )
    .join("");
}

export async function generateReportPdf(report: SiteAuditReport): Promise<Buffer> {
  let browser;

  try {
    browser = await getSharedPlaywrightBrowser();
  } catch (error) {
    throw new Error(compactBrowserErrorMessage(error));
  }

  const page = await browser.newPage();

  try {
    const desktopScreenshot = await assetUrlToDataUrl(
      report.reportId,
      report.browserEvidence?.screenshots.find((shot) => shot.label === "Desktop")?.url,
    );
    const mobileScreenshot = await assetUrlToDataUrl(
      report.reportId,
      report.browserEvidence?.screenshots.find((shot) => shot.label === "Mobile")?.url,
    );

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: Arial, sans-serif; color: #14212b; margin: 0; padding: 28px; }
            h1, h2, h3 { margin: 0 0 12px; }
            h1 { font-size: 28px; }
            h2 { font-size: 18px; margin-top: 28px; }
            p, li { line-height: 1.5; }
            .hero { padding: 24px; border-radius: 16px; background: #0f1720; color: white; }
            .hero-grid, .score-grid, .metric-grid, .image-grid { display: grid; gap: 16px; }
            .hero-grid { grid-template-columns: 1.2fr 1fr; align-items: start; }
            .score-grid { grid-template-columns: repeat(3, 1fr); }
            .metric-grid { grid-template-columns: repeat(4, 1fr); }
            .score-card, .issue { padding: 16px; border: 1px solid #dbe3e7; border-radius: 14px; background: #f8fbfb; }
            .score { font-size: 30px; font-weight: bold; margin-top: 6px; }
            .muted { color: #55707a; font-size: 12px; }
            .image-grid { grid-template-columns: 1fr 1fr; }
            img { width: 100%; border-radius: 12px; border: 1px solid #dbe3e7; }
            ul { margin: 8px 0 0 18px; }
            .issue-title { font-size: 15px; font-weight: bold; }
          </style>
        </head>
        <body>
          <section class="hero">
            <div class="hero-grid">
              <div>
                <div class="muted">Sequoia Audit report</div>
                <h1>${escapeHtml(report.siteUrl)}</h1>
                <p>Audited ${escapeHtml(new Date(report.auditedAt).toLocaleString())}</p>
                <p><strong>Overall score:</strong> ${escapeHtml(String(report.overallScore))}</p>
                <p><strong>Pages crawled:</strong> ${escapeHtml(String(report.pageCount))}</p>
              </div>
              <div class="score-card">
                <div class="muted">Top wins</div>
                <ul>${renderWins(report)}</ul>
              </div>
            </div>
          </section>

          <h2>Category scores</h2>
          <div class="score-grid">${renderCategoryCards(report)}</div>

          ${
            desktopScreenshot || mobileScreenshot
              ? `<h2>Rendered homepage</h2>
                 <div class="image-grid">
                   ${desktopScreenshot ? `<div><div class="muted">Desktop</div><img src="${desktopScreenshot}" /></div>` : ""}
                   ${mobileScreenshot ? `<div><div class="muted">Mobile</div><img src="${mobileScreenshot}" /></div>` : ""}
                 </div>`
              : ""
          }

          ${report.lighthouse ? `<h2>Lighthouse</h2>${renderLighthouse(report)}` : ""}

          <h2>Top issues</h2>
          ${renderIssues(report)}
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16px", right: "16px", bottom: "16px", left: "16px" },
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}
