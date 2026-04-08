const form = document.querySelector("#audit-form");
const submitButton = document.querySelector("#submit-button");
const statusPanel = document.querySelector("#status-panel");
const statusText = document.querySelector("#status-text");
const errorPanel = document.querySelector("#error-panel");
const errorText = document.querySelector("#error-text");
const results = document.querySelector("#results");
const aiSummaryCard = document.querySelector("#ai-summary-card");

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
    : "<li>No strong positives surfaced in this shallow crawl yet.</li>";
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

function renderReport(report) {
  document.querySelector("#overall-score").textContent = report.overallScore;
  document.querySelector("#overall-site").textContent = report.siteUrl;
  document.querySelector("#page-count").textContent = report.pageCount;
  document.querySelector("#response-time").textContent = `${report.siteSignals.averageResponseTimeMs}ms`;
  document.querySelector("#audit-time").textContent = `Audited ${new Date(report.auditedAt).toLocaleString()}`;

  renderCategoryScores(report.categoryScores);
  renderIssues(report.issues);
  renderWins(report.wins);
  renderPages(report.pages);
  renderAiSummary(report.aiSummary);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = document.querySelector("#url").value.trim();
  const maxPages = Number(document.querySelector("#maxPages").value);

  errorPanel.classList.add("hidden");
  results.classList.add("hidden");
  statusPanel.classList.remove("hidden");
  statusText.textContent = "Running audit...";
  submitButton.disabled = true;
  submitButton.textContent = "Auditing...";

  try {
    const response = await fetch("/api/audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, maxPages }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Audit failed.");
    }

    statusText.textContent = "Rendering report...";
    renderReport(payload);
    results.classList.remove("hidden");
  } catch (error) {
    errorText.textContent = error instanceof Error ? error.message : "Audit failed.";
    errorPanel.classList.remove("hidden");
  } finally {
    statusPanel.classList.add("hidden");
    submitButton.disabled = false;
    submitButton.textContent = "Run audit";
  }
});
