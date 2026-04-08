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

export interface SkippedPage {
  url: string;
  reason: string;
  source: "html" | "sitemap";
}

export interface CrawlDiagnostics {
  requestedMaxPages: number;
  renderMode: "http" | "playwright" | "playwright-fallback";
  usedSitemapFallback: boolean;
  discoveredFromHtml: number;
  discoveredFromSitemap: number;
  notes: string[];
  skippedPages: SkippedPage[];
}

export interface ReportLinkSet {
  sharePath: string;
  jsonPath: string;
  pdfPath: string;
}

export interface BrowserConsoleEntry {
  type: string;
  text: string;
  location?: string;
}

export interface BrowserRequestFailure {
  url: string;
  resourceType: string;
  errorText: string;
}

export interface BrowserHttpError {
  url: string;
  resourceType: string;
  status: number;
}

export interface ScreenshotAsset {
  label: string;
  url: string;
  viewport: string;
}

export interface BrowserEvidence {
  status: "ok" | "unavailable" | "failed";
  finalUrl: string;
  screenshots: ScreenshotAsset[];
  renderedInternalLinks: string[];
  consoleErrors: BrowserConsoleEntry[];
  failedRequests: BrowserRequestFailure[];
  httpErrors: BrowserHttpError[];
  brokenImageUrls: string[];
  notes: string[];
}

export interface LighthouseCategoryScore {
  id: "performance" | "accessibility" | "best-practices" | "seo";
  label: string;
  score: number;
}

export interface LighthouseMetric {
  id: string;
  label: string;
  value: string;
}

export interface LighthouseOpportunity {
  id: string;
  label: string;
  displayValue: string;
}

export interface LighthouseRun {
  formFactor: "mobile" | "desktop";
  finalUrl: string;
  categoryScores: LighthouseCategoryScore[];
  metrics: LighthouseMetric[];
  opportunities: LighthouseOpportunity[];
  reportHtmlUrl?: string;
  reportJsonUrl?: string;
}

export interface LighthouseEvidence {
  status: "ok" | "unavailable" | "failed";
  notes: string[];
  mobile?: LighthouseRun;
  desktop?: LighthouseRun;
}

export interface LeadCapture {
  id: string;
  reportId: string;
  email: string;
  name?: string;
  company?: string;
  createdAt: string;
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
  reportId: string;
  links: ReportLinkSet;
  siteUrl: string;
  auditedAt: string;
  pageCount: number;
  overallScore: number;
  categoryScores: CategoryScore[];
  issues: AuditIssue[];
  wins: string[];
  pages: PageAudit[];
  siteSignals: SiteSignals;
  crawlDiagnostics: CrawlDiagnostics;
  browserEvidence?: BrowserEvidence;
  lighthouse?: LighthouseEvidence;
  aiSummary?: AiSummary;
}
