const form = document.querySelector("#audit-form");
const submitButton = document.querySelector("#submit-button");
const statusPanel = document.querySelector("#status-panel");
const statusText = document.querySelector("#status-text");
const errorPanel = document.querySelector("#error-panel");
const errorText = document.querySelector("#error-text");
const results = document.querySelector("#results");
const aiSummaryCard = document.querySelector("#ai-summary-card");
const skippedPagesCard = document.querySelector("#skipped-pages-card");
const browserEvidenceCard = document.querySelector("#browser-evidence-card");
const lighthouseCard = document.querySelector("#lighthouse-card");
const shareUrl = document.querySelector("#share-url");
const copyShareLinkButton = document.querySelector("#copy-share-link");
const downloadJsonLink = document.querySelector("#download-json");
const downloadPdfLink = document.querySelector("#download-pdf");
const leadForm = document.querySelector("#lead-form");
const leadSubmitButton = document.querySelector("#lead-submit");
const leadStatus = document.querySelector("#lead-status");

let currentReport = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function severityClass(severity) {
  return {
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
  }[severity] || "badge-low";
}

function scoreTone(score) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Solid";
  if (score >= 50) return "Needs work";
  return "Weak";
}

function toAbsoluteUrl(path) {
  return new URL(path, window.location.origin).toString();
}

function formatList(items, emptyText) {
  if (!items.length) {
    return `<li>${escapeHtml(emptyText)}</li>`;
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function updateShareLinks(report) {
  const shareHref = toAbsoluteUrl(report.links.sharePath);
  shareUrl.textContent = shareHref;
  downloadJsonLink.href = toAbsoluteUrl(report.links.jsonPath);
  downloadPdfLink.href = toAbsoluteUrl(report.links.pdfPath);
  copyShareLinkButton.disabled = false;
}

function renderCategoryScores(categoryScores) {
  const container = document.querySelector("#category-grid");
  container.innerHTML = categoryScores
    .map(
      (category) => `
        <article class="category-card">
          <div class="issue-header">
            <h3 class="page-title">${escapeHtml(category.label)}</h3>
            <span class="badge ${severityClass(category.score < 50 ? "high" : category.score < 70 ? "medium" : "low")}">
              ${escapeHtml(scoreTone(category.score))}
            </span>
          </div>
          <div class="category-score">${escapeHtml(category.score)}</div>
          <p>${escapeHtml(category.summary)}</p>
        </article>
      `,
    )
    .join("");
}

function renderIssues(issues) {
  const container = document.querySelector("#issues-list");

  if (!issues.length) {
    container.innerHTML = `<div class="issue-card"><p>No major issues were detected in this crawl.</p></div>`;
    return;
  }

  container.innerHTML = issues
    .map(
      (issue) => `
        <article class="issue-card">
          <div class="issue-header">
            <h3 class="issue-title">${escapeHtml(issue.title)}</h3>
            <span class="badge ${severityClass(issue.severity)}">${escapeHtml(issue.severity)}</span>
          </div>
          <p>${escapeHtml(issue.description)}</p>
          <p><strong>Recommendation:</strong> ${escapeHtml(issue.recommendation)}</p>
          ${
            issue.evidence.length
              ? `<ul class="evidence-list">${issue.evidence
                  .map((item) => `<li>${escapeHtml(item)}</li>`)
                  .join("")}</ul>`
              : ""
          }
          <div class="badge-row">
            <span class="badge ${severityClass(issue.severity)}">${escapeHtml(issue.category)}</span>
            <span class="badge ${severityClass(issue.severity)}">-${escapeHtml(issue.scoreImpact)} pts</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderWins(wins) {
  const container = document.querySelector("#wins-list");
  container.innerHTML = wins.length
    ? wins.map((win) => `<li>${escapeHtml(win)}</li>`).join("")
    : "<li>No strong positives surfaced in this crawl yet.</li>";
}

function renderPages(pages) {
  const container = document.querySelector("#pages-grid");
  container.innerHTML = pages
    .map(
      (page) => `
        <article class="page-card">
          <div class="page-header">
            <h3 class="page-title">${escapeHtml(page.title || new URL(page.url).pathname || page.url)}</h3>
            <span class="badge ${severityClass(page.statusCode >= 400 ? "high" : page.statusCode >= 300 ? "medium" : "low")}">
              ${escapeHtml(page.statusCode)}
            </span>
          </div>
          <p><a class="page-link" href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.url)}</a></p>
          <ul class="page-metrics">
            <li>${escapeHtml(page.responseTimeMs)}ms response</li>
            <li>${escapeHtml(page.wordCount)} words</li>
            <li>${escapeHtml(page.h1Count)} H1 tags</li>
            <li>${escapeHtml(page.imageCount)} images, ${escapeHtml(page.imagesMissingAlt)} missing alt</li>
          </ul>
          ${
            page.ctaPhrases.length
              ? `<div class="badge-row">${page.ctaPhrases
                  .slice(0, 4)
                  .map((phrase) => `<span class="badge badge-low">${escapeHtml(phrase)}</span>`)
                  .join("")}</div>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

function renderAiSummary(aiSummary) {
  const container = document.querySelector("#ai-summary");

  if (!aiSummary) {
    aiSummaryCard.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  aiSummaryCard.classList.remove("hidden");
  container.innerHTML = `
    <div class="stack">
      <article class="ai-block">
        <h3 class="page-title">Executive summary</h3>
        <p>${escapeHtml(aiSummary.executiveSummary)}</p>
      </article>
      <article class="ai-block">
        <h3 class="page-title">Positioning read</h3>
        <p>${escapeHtml(aiSummary.positioning)}</p>
      </article>
      <article class="ai-block">
        <h3 class="page-title">Quick wins</h3>
        <ul class="ai-list">${aiSummary.quickWins.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="ai-block">
        <h3 class="page-title">Growth opportunities</h3>
        <ul class="ai-list">${aiSummary.growthOpportunities
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>
      </article>
      <article class="ai-block">
        <h3 class="page-title">Funnel recommendation</h3>
        <p>${escapeHtml(aiSummary.funnelRecommendation)}</p>
      </article>
    </div>
  `;
}

function renderCrawlDiagnostics(crawlDiagnostics) {
  const container = document.querySelector("#crawl-diagnostics");
  const notesContainer = document.querySelector("#crawl-notes");

  container.innerHTML = `
    <article class="crawl-card">
      <div class="crawl-label">Requested pages</div>
      <div class="crawl-value">${escapeHtml(crawlDiagnostics.requestedMaxPages)}</div>
    </article>
    <article class="crawl-card">
      <div class="crawl-label">Render mode</div>
      <div class="crawl-value">${escapeHtml(crawlDiagnostics.renderMode)}</div>
    </article>
    <article class="crawl-card">
      <div class="crawl-label">Found in HTML</div>
      <div class="crawl-value">${escapeHtml(crawlDiagnostics.discoveredFromHtml)}</div>
    </article>
    <article class="crawl-card">
      <div class="crawl-label">Found in sitemap</div>
      <div class="crawl-value">${escapeHtml(crawlDiagnostics.discoveredFromSitemap)}</div>
    </article>
    <article class="crawl-card">
      <div class="crawl-label">Sitemap fallback</div>
      <div class="crawl-value">${crawlDiagnostics.usedSitemapFallback ? "Yes" : "No"}</div>
    </article>
  `;

  notesContainer.innerHTML = crawlDiagnostics.notes.length
    ? crawlDiagnostics.notes.map((note) => `<div class="issue-card"><p>${escapeHtml(note)}</p></div>`).join("")
    : `<div class="issue-card"><p>No crawl warnings were reported.</p></div>`;
}

function renderSkippedPages(skippedPages) {
  const container = document.querySelector("#skipped-pages");

  if (!skippedPages.length) {
    skippedPagesCard.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  skippedPagesCard.classList.remove("hidden");
  container.innerHTML = skippedPages
    .map(
      (item) => `
        <article class="issue-card">
          <div class="issue-header">
            <h3 class="issue-title">${escapeHtml(item.url)}</h3>
            <span class="badge ${severityClass(item.source === "sitemap" ? "medium" : "low")}">${escapeHtml(item.source)}</span>
          </div>
          <p>${escapeHtml(item.reason)}</p>
        </article>
      `,
    )
    .join("");
}

function renderBrowserEvidence(browserEvidence) {
  const container = document.querySelector("#browser-evidence");

  if (!browserEvidence) {
    browserEvidenceCard.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  browserEvidenceCard.classList.remove("hidden");

  if (browserEvidence.status !== "ok") {
    container.innerHTML = `
      <div class="issue-card">
        <p>Browser evidence is ${escapeHtml(browserEvidence.status)}.</p>
        <ul class="evidence-list">${formatList(browserEvidence.notes, "No browser notes were recorded.")}</ul>
      </div>
    `;
    return;
  }

  const screenshotHtml = browserEvidence.screenshots.length
    ? browserEvidence.screenshots
        .map(
          (shot) => `
            <article class="evidence-card">
              <div class="issue-header">
                <h3 class="page-title">${escapeHtml(shot.label)}</h3>
                <span class="badge badge-low">${escapeHtml(shot.viewport)}</span>
              </div>
              <a href="${escapeHtml(shot.url)}" target="_blank" rel="noreferrer">
                <img class="audit-image" src="${escapeHtml(shot.url)}" alt="${escapeHtml(shot.label)} screenshot" />
              </a>
            </article>
          `,
        )
        .join("")
    : `<article class="issue-card"><p>No screenshots were saved for this report.</p></article>`;

  container.innerHTML = `
    <div class="evidence-grid">
      ${screenshotHtml}
    </div>
    <div class="stack">
      <article class="issue-card">
        <div class="issue-header">
          <h3 class="page-title">Rendered page</h3>
          <span class="badge badge-low">${escapeHtml(browserEvidence.status)}</span>
        </div>
        <p><a class="page-link" href="${escapeHtml(browserEvidence.finalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(browserEvidence.finalUrl)}</a></p>
        <ul class="evidence-list">
          <li>${escapeHtml(browserEvidence.renderedInternalLinks.length)} same-site links found after render</li>
          <li>${escapeHtml(browserEvidence.consoleErrors.length)} console warnings/errors</li>
          <li>${escapeHtml(browserEvidence.failedRequests.length)} failed requests</li>
          <li>${escapeHtml(browserEvidence.httpErrors.length)} HTTP responses >= 400</li>
          <li>${escapeHtml(browserEvidence.brokenImageUrls.length)} broken images</li>
        </ul>
      </article>
      <article class="issue-card">
        <h3 class="page-title">Console</h3>
        <ul class="evidence-list">${formatList(
          browserEvidence.consoleErrors.map((entry) =>
            `${entry.type.toUpperCase()}: ${entry.text}${entry.location ? ` (${entry.location})` : ""}`,
          ),
          "No console warnings or errors were captured.",
        )}</ul>
      </article>
      <article class="issue-card">
        <h3 class="page-title">Network failures</h3>
        <ul class="evidence-list">${formatList(
          browserEvidence.failedRequests.map(
            (item) => `${item.resourceType}: ${item.url} (${item.errorText})`,
          ),
          "No failed requests were captured.",
        )}</ul>
      </article>
      <article class="issue-card">
        <h3 class="page-title">HTTP errors</h3>
        <ul class="evidence-list">${formatList(
          browserEvidence.httpErrors.map((item) => `${item.status}: ${item.resourceType} ${item.url}`),
          "No 4xx/5xx responses were captured.",
        )}</ul>
      </article>
      <article class="issue-card">
        <h3 class="page-title">Broken images</h3>
        <ul class="evidence-list">${formatList(
          browserEvidence.brokenImageUrls,
          "No broken images were captured.",
        )}</ul>
      </article>
      ${
        browserEvidence.notes.length
          ? `<article class="issue-card">
               <h3 class="page-title">Browser notes</h3>
               <ul class="evidence-list">${formatList(browserEvidence.notes, "No browser notes were recorded.")}</ul>
             </article>`
          : ""
      }
    </div>
  `;
}

function renderLighthouseRun(run) {
  return `
    <article class="lighthouse-run">
      <div class="issue-header">
        <h3 class="page-title">${escapeHtml(run.formFactor[0].toUpperCase() + run.formFactor.slice(1))}</h3>
        <span class="badge badge-low">Lighthouse</span>
      </div>
      <p><a class="page-link" href="${escapeHtml(run.finalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(run.finalUrl)}</a></p>
      <div class="metric-grid">
        ${run.categoryScores
          .map(
            (category) => `
              <div class="metric-tile">
                <div class="score-label">${escapeHtml(category.label)}</div>
                <div class="metric-value">${escapeHtml(category.score)}</div>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="lighthouse-grid">
        <div class="issue-card">
          <h3 class="page-title">Metrics</h3>
          <ul class="evidence-list">${formatList(
            run.metrics.map((metric) => `${metric.label}: ${metric.value}`),
            "No Lighthouse metrics were captured.",
          )}</ul>
        </div>
        <div class="issue-card">
          <h3 class="page-title">Opportunities</h3>
          <ul class="evidence-list">${formatList(
            run.opportunities.map((item) => `${item.label}: ${item.displayValue}`),
            "No major opportunities were highlighted.",
          )}</ul>
        </div>
      </div>
      <div class="badge-row">
        ${
          run.reportHtmlUrl
            ? `<a class="badge badge-low" href="${escapeHtml(run.reportHtmlUrl)}" target="_blank" rel="noreferrer">HTML report</a>`
            : ""
        }
        ${
          run.reportJsonUrl
            ? `<a class="badge badge-low" href="${escapeHtml(run.reportJsonUrl)}" target="_blank" rel="noreferrer">JSON report</a>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderLighthouse(lighthouse) {
  const container = document.querySelector("#lighthouse-evidence");

  if (!lighthouse) {
    lighthouseCard.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  lighthouseCard.classList.remove("hidden");

  if (lighthouse.status !== "ok") {
    container.innerHTML = `
      <article class="issue-card">
        <p>Lighthouse is ${escapeHtml(lighthouse.status)} for this report.</p>
        <ul class="evidence-list">${formatList(lighthouse.notes, "No Lighthouse notes were recorded.")}</ul>
      </article>
    `;
    return;
  }

  const runs = [lighthouse.mobile, lighthouse.desktop].filter(Boolean);
  container.innerHTML = `
    <div class="stack">
      ${runs.map((run) => renderLighthouseRun(run)).join("")}
      ${
        lighthouse.notes.length
          ? `<article class="issue-card">
               <h3 class="page-title">Lighthouse notes</h3>
               <ul class="evidence-list">${formatList(lighthouse.notes, "No Lighthouse notes were recorded.")}</ul>
             </article>`
          : ""
      }
    </div>
  `;
}

function renderReport(report) {
  currentReport = report;
  document.querySelector("#overall-score").textContent = report.overallScore;
  document.querySelector("#overall-site").textContent = report.siteUrl;
  document.querySelector("#page-count").textContent = report.pageCount;
  document.querySelector("#response-time").textContent = `${report.siteSignals.averageResponseTimeMs}ms`;
  document.querySelector("#audit-time").textContent = `Audited ${new Date(report.auditedAt).toLocaleString()}`;
  leadStatus.textContent = "";

  updateShareLinks(report);
  renderCategoryScores(report.categoryScores);
  renderCrawlDiagnostics(report.crawlDiagnostics);
  renderIssues(report.issues);
  renderWins(report.wins);
  renderPages(report.pages);
  renderSkippedPages(report.crawlDiagnostics.skippedPages);
  renderBrowserEvidence(report.browserEvidence);
  renderLighthouse(report.lighthouse);
  renderAiSummary(report.aiSummary);

  results.classList.remove("hidden");
  const shareHref = toAbsoluteUrl(report.links.sharePath);
  if (window.location.pathname !== report.links.sharePath) {
    window.history.replaceState({ reportId: report.reportId }, "", report.links.sharePath);
  }
  document.title = `Sequoia Audit | ${report.siteUrl}`;
  shareUrl.textContent = shareHref;
}

function showStatus(message) {
  statusText.textContent = message;
  statusPanel.classList.remove("hidden");
}

function hideStatus() {
  statusPanel.classList.add("hidden");
}

function showError(message) {
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
}

function hideError() {
  errorPanel.classList.add("hidden");
}

async function loadSavedReport(reportId) {
  showStatus("Loading saved report...");
  hideError();

  try {
    const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load saved report.");
    }

    renderReport(payload);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to load saved report.");
  } finally {
    hideStatus();
  }
}

async function copyShareLink() {
  if (!currentReport) {
    return;
  }

  const shareHref = toAbsoluteUrl(currentReport.links.sharePath);

  try {
    await navigator.clipboard.writeText(shareHref);
    copyShareLinkButton.textContent = "Copied";
    window.setTimeout(() => {
      copyShareLinkButton.textContent = "Copy link";
    }, 1200);
  } catch {
    showError("Copy failed. Use the saved report URL directly.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = document.querySelector("#url").value.trim();
  const maxPages = Number(document.querySelector("#maxPages").value);
  const renderJavascript = document.querySelector("#renderJavascript").checked;
  const runLighthouse = document.querySelector("#runLighthouse").checked;

  hideError();
  results.classList.add("hidden");
  skippedPagesCard.classList.add("hidden");
  showStatus("Running audit...");
  submitButton.disabled = true;
  submitButton.textContent = "Auditing...";

  try {
    const response = await fetch("/api/audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, maxPages, renderJavascript, runLighthouse }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Audit failed.");
    }

    showStatus("Rendering report...");
    renderReport(payload);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Audit failed.");
  } finally {
    hideStatus();
    submitButton.disabled = false;
    submitButton.textContent = "Run audit";
  }
});

copyShareLinkButton.addEventListener("click", () => {
  void copyShareLink();
});

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentReport) {
    showError("Run or load a report before saving a lead.");
    return;
  }

  const email = document.querySelector("#lead-email").value.trim();
  const name = document.querySelector("#lead-name").value.trim();
  const company = document.querySelector("#lead-company").value.trim();

  leadStatus.textContent = "Saving lead...";
  leadSubmitButton.disabled = true;

  try {
    const response = await fetch(`/api/reports/${encodeURIComponent(currentReport.reportId)}/lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        name: name || undefined,
        company: company || undefined,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to save lead.");
    }

    leadStatus.textContent = `Lead saved for ${payload.lead.email}.`;
  } catch (error) {
    leadStatus.textContent = error instanceof Error ? error.message : "Failed to save lead.";
  } finally {
    leadSubmitButton.disabled = false;
  }
});

if (window.location.pathname.startsWith("/reports/")) {
  const reportId = window.location.pathname.split("/").filter(Boolean)[1];
  if (reportId) {
    void loadSavedReport(reportId);
  }
}
