import OpenAI from "openai";
import { z } from "zod";
import type { AiSummary, SiteAuditReport } from "./types.js";

const aiSummarySchema = z.object({
  executiveSummary: z.string().min(1),
  positioning: z.string().min(1),
  quickWins: z.array(z.string().min(1)).min(2).max(3),
  growthOpportunities: z.array(z.string().min(1)).min(2).max(3),
  funnelRecommendation: z.string().min(1),
});

export async function maybeGenerateAiSummary(report: SiteAuditReport): Promise<AiSummary | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  const compactReport = {
    siteUrl: report.siteUrl,
    overallScore: report.overallScore,
    categoryScores: report.categoryScores.map((category) => ({
      label: category.label,
      score: category.score,
      summary: category.summary,
    })),
    issues: report.issues.slice(0, 8).map((issue) => ({
      title: issue.title,
      severity: issue.severity,
      category: issue.category,
      recommendation: issue.recommendation,
      evidence: issue.evidence.slice(0, 3),
    })),
    wins: report.wins.slice(0, 5),
    crawlDiagnostics: {
      renderMode: report.crawlDiagnostics.renderMode,
      usedSitemapFallback: report.crawlDiagnostics.usedSitemapFallback,
      discoveredFromHtml: report.crawlDiagnostics.discoveredFromHtml,
      discoveredFromSitemap: report.crawlDiagnostics.discoveredFromSitemap,
      notes: report.crawlDiagnostics.notes.slice(0, 5),
    },
    browserEvidence: report.browserEvidence
      ? {
          status: report.browserEvidence.status,
          screenshots: report.browserEvidence.screenshots.map((shot) => ({
            label: shot.label,
            viewport: shot.viewport,
          })),
          renderedInternalLinkCount: report.browserEvidence.renderedInternalLinks.length,
          consoleErrors: report.browserEvidence.consoleErrors.slice(0, 5),
          failedRequests: report.browserEvidence.failedRequests.slice(0, 5),
          httpErrors: report.browserEvidence.httpErrors.slice(0, 5),
          brokenImageUrls: report.browserEvidence.brokenImageUrls.slice(0, 5),
          notes: report.browserEvidence.notes.slice(0, 5),
        }
      : undefined,
    lighthouse: report.lighthouse
      ? {
          status: report.lighthouse.status,
          notes: report.lighthouse.notes.slice(0, 5),
          mobile: report.lighthouse.mobile
            ? {
                categoryScores: report.lighthouse.mobile.categoryScores,
                metrics: report.lighthouse.mobile.metrics.slice(0, 6),
                opportunities: report.lighthouse.mobile.opportunities.slice(0, 5),
              }
            : undefined,
          desktop: report.lighthouse.desktop
            ? {
                categoryScores: report.lighthouse.desktop.categoryScores,
                metrics: report.lighthouse.desktop.metrics.slice(0, 6),
                opportunities: report.lighthouse.desktop.opportunities.slice(0, 5),
              }
            : undefined,
        }
      : undefined,
    homepage: report.pages[0]
      ? {
          title: report.pages[0].title,
          metaDescription: report.pages[0].metaDescription,
          wordCount: report.pages[0].wordCount,
          ctaPhrases: report.pages[0].ctaPhrases,
          trustSignals: report.pages[0].trustSignals,
          textSample: report.pages[0].textSample,
        }
      : undefined,
  };

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a senior website strategist for a design agency. Return JSON only. Be specific, concise, and grounded in the provided audit facts. Do not invent metrics, pages, or tools that were not observed.",
        },
        {
          role: "user",
          content: `Summarize this website audit for a founder or marketer.\n\n${JSON.stringify(compactReport)}`,
        },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      return undefined;
    }

    return aiSummarySchema.parse(JSON.parse(rawContent));
  } catch (error) {
    console.error("AI summary generation failed:", error);
    return undefined;
  }
}
