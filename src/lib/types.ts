export const categoryDefinitions = [
  { key: "technical", label: "Technical" },
  { key: "seo", label: "SEO" },
  { key: "accessibility", label: "Accessibility" },
  { key: "content", label: "Content" },
  { key: "conversion", label: "Conversion" },
  { key: "trust", label: "Trust" },
] as const;

export type CategoryKey = (typeof categoryDefinitions)[number]["key"];
export type Severity = "low" | "medium" | "high";

export interface AuditIssue {
  id: string;
  category: CategoryKey;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  evidence: string[];
  scoreImpact: number;
}

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  score: number;
  summary: string;
}

export interface ResourceCheck {
  url: string;
  exists: boolean;
  detail: string;
}

export interface PageAudit {
  url: string;
  statusCode: number;
  responseTimeMs: number;
  title: string;
  titleLength: number;
  metaDescription: string;
  metaDescriptionLength: number;
  h1Count: number;
  hasViewport: boolean;
  hasCanonical: boolean;
  hasLang: boolean;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasStructuredData: boolean;
  hasFavicon: boolean;
  hasRobotsMeta: boolean;
  wordCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  forms: number;
  buttonCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  lazyLoadedImages: number;
  missingImageDimensions: number;
  headingOrderIssues: number;
  hasContactSignals: boolean;
  hasPrivacyLink: boolean;
  ctaPhrases: string[];
  trustSignals: string[];
  textSample: string;
}

export interface SiteSignals {
  origin: string;
  averageResponseTimeMs: number;
  totalImages: number;
  imagesMissingAlt: number;
  pagesWithForms: number;
  pagesWithStrongCtas: number;
  contactSignalsFound: boolean;
  privacyLinkFound: boolean;
  robotsTxt: ResourceCheck;
  sitemapXml: ResourceCheck;
}

export interface AiSummary {
  executiveSummary: string;
  positioning: string;
  quickWins: string[];
  growthOpportunities: string[];
  funnelRecommendation: string;
}

export interface SiteAuditReport {
  siteUrl: string;
  auditedAt: string;
  pageCount: number;
  overallScore: number;
  categoryScores: CategoryScore[];
  issues: AuditIssue[];
  wins: string[];
  pages: PageAudit[];
  siteSignals: SiteSignals;
  aiSummary?: AiSummary;
}
