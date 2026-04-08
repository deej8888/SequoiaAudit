import { categoryDefinitions, type AuditIssue, type CategoryScore } from "./types.js";

const scoreBands = [
  { min: 85, summary: "Strong foundation with mostly minor gaps." },
  { min: 70, summary: "Solid overall, but a few meaningful fixes remain." },
  { min: 50, summary: "Noticeable weaknesses are likely hurting results." },
  { min: 0, summary: "Major issues are reducing quality and credibility." },
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function sortIssues(issues: AuditIssue[]): AuditIssue[] {
  const severityWeight: Record<AuditIssue["severity"], number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...issues].sort((left, right) => {
    if (severityWeight[right.severity] !== severityWeight[left.severity]) {
      return severityWeight[right.severity] - severityWeight[left.severity];
    }

    return right.scoreImpact - left.scoreImpact;
  });
}

export function buildCategoryScores(issues: AuditIssue[]): CategoryScore[] {
  return categoryDefinitions.map((category) => {
    const categoryIssues = issues.filter((issue) => issue.category === category.key);
    const totalImpact = categoryIssues.reduce((sum, issue) => sum + issue.scoreImpact, 0);
    const score = clampScore(100 - totalImpact);
    const band = scoreBands.find((entry) => score >= entry.min) ?? scoreBands[scoreBands.length - 1];
    const leadIssue = categoryIssues[0]?.title;

    return {
      key: category.key,
      label: category.label,
      score,
      summary: leadIssue ? `${band.summary} Main gap: ${leadIssue}.` : "No major issues detected in this category.",
    };
  });
}

export function buildOverallScore(categoryScores: CategoryScore[]): number {
  const total = categoryScores.reduce((sum, category) => sum + category.score, 0);
  return clampScore(total / categoryScores.length);
}
