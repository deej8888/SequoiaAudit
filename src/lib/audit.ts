import { lookup } from "node:dns/promises";
import { load } from "cheerio";
import { z } from "zod";
import { maybeGenerateAiSummary } from "./ai.js";
import { captureBrowserEvidence } from "./browser-evidence.js";
import { compactBrowserErrorMessage, getPlaywrightUnavailableReason, getSharedPlaywrightBrowser } from "./browser-runtime.js";
import { runLighthouseEvidence } from "./lighthouse.js";
import { buildReportLinks, createReportId } from "./report-store.js";
import { buildCategoryScores, buildOverallScore, sortIssues } from "./scoring.js";
import type {
  AuditIssue,
  BrowserEvidence,
  CrawlDiagnostics,
  LighthouseEvidence,
  PageAudit,
  ResourceCheck,
  Severity,
  SiteAuditReport,
  SiteSignals,
} from "./types.js";

const ctaPattern = /\b(contact|book|schedule|get started|start|demo|audit|quote|request|call|buy|sign up|try|talk to sales)\b/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+?\d[\d(). -]{7,}\d)/;
const trustKeywords = [
  "testimonial",
  "testimonials",
  "review",
  "reviews",
  "client",
  "clients",
  "case study",
  "results",
  "award",
  "certified",
  "trusted by",
  "guarantee",
];
const assetExtensionPattern =
  /\.(?:avif|bmp|css|csv|docx?|eot|gif|gz|ico|jpeg|jpg|js|json|map|mjs|mov|mp[34]|pdf|png|rar|svg|tar|txt|web[mp]|woff2?|xml|zip)$/i;
const sitemapLocPattern = /<loc>(.*?)<\/loc>/gi;

const auditInputSchema = z.object({
  url: z.string().min(3),
  maxPages: z.number().int().min(1).max(10).optional(),
  renderJavascript: z.boolean().optional(),
  runLighthouse: z.boolean().optional(),
});

interface AuditOptions {
  maxPages?: number;
  renderJavascript?: boolean;
  runLighthouse?: boolean;
  reportId?: string;
}

interface FetchDocumentResult {
  body: string;
  finalUrl: URL;
  responseTimeMs: number;
  statusCode: number;
  contentType: string;
}

interface PageAuditResult {
  page: PageAudit;
  discoveredLinks: string[];
}

interface QueueItem {
  url: string;
  source: "html" | "sitemap";
}

interface SitemapDiscoveryResult {
  resourceCheck: ResourceCheck;
  pageUrls: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePublicUrl(input: string): URL {
  const withProtocol = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(withProtocol);
  parsed.hash = "";
  return parsed;
}

function normalizeForCrawl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function normalizeComparableHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isSameSiteUrl(candidate: URL, siteHostname: string): boolean {
  return normalizeComparableHostname(candidate.hostname) === normalizeComparableHostname(siteHostname);
}

function isLikelyHtmlUrl(candidate: URL): boolean {
  return !assetExtensionPattern.test(candidate.pathname);
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value === "0.0.0.0";
}

function isPrivateIp(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) {
    return true;
  }

  const parts = address.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return false;
  }

  if (parts[0] === 10 || parts[0] === 127) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }

  return false;
}

async function assertSafeTarget(targetUrl: URL): Promise<void> {
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    throw new Error("Only http and https URLs are allowed.");
  }

  if (process.env.ALLOW_PRIVATE_TARGETS === "true") {
    return;
  }

  if (isPrivateHostname(targetUrl.hostname)) {
    throw new Error("Private or local hosts are blocked.");
  }

  const addresses = await lookup(targetUrl.hostname, { all: true }).catch(() => []);
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Private network targets are blocked.");
  }
}

function buildHeaders(accept: string): HeadersInit {
  return {
    accept,
    "user-agent": "SequoiaAuditBot/0.1 (+https://github.com/)",
  };
}

async function fetchOptionalTextResource(targetUrl: URL, accept: string): Promise<FetchDocumentResult | undefined> {
  try {
    return await fetchTextDocument(targetUrl, accept);
  } catch {
    return undefined;
  }
}

async function fetchTextDocument(targetUrl: URL, accept: string): Promise<FetchDocumentResult> {
  if (process.env.ALLOW_INSECURE_TLS === "true") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  let current = new URL(targetUrl.toString());
  let redirects = 0;

  while (redirects < 5) {
    await assertSafeTarget(current);

    const startedAt = Date.now();
    const response = await fetch(current, {
      headers: buildHeaders(accept),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const responseTimeMs = Date.now() - startedAt;

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect from ${current.toString()} did not include a Location header.`);
      }

      current = new URL(location, current);
      redirects += 1;
      continue;
    }

    const body = await response.text();
    return {
      body,
      finalUrl: current,
      responseTimeMs,
      statusCode: response.status,
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  throw new Error(`Too many redirects while fetching ${targetUrl.toString()}.`);
}

async function fetchRenderedDocument(targetUrl: URL): Promise<FetchDocumentResult> {
  await assertSafeTarget(targetUrl);

  const browser = await getSharedPlaywrightBrowser();
  const context = await browser.newContext({
    ignoreHTTPSErrors: process.env.ALLOW_INSECURE_TLS === "true",
  });
  const page = await context.newPage();

  try {
    const startedAt = Date.now();
    const response = await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    const finalUrl = new URL(page.url());
    await assertSafeTarget(finalUrl);

    return {
      body: await page.content(),
      finalUrl,
      responseTimeMs: Date.now() - startedAt,
      statusCode: response?.status() ?? 200,
      contentType: response?.headers()["content-type"] ?? "text/html",
    };
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

function getHeadingOrderIssues(headings: string[]): number {
  let issues = 0;
  let previousLevel = 0;

  for (const heading of headings) {
    const level = Number.parseInt(heading.replace("h", ""), 10);
    if (previousLevel > 0 && level > previousLevel + 1) {
      issues += 1;
    }
    previousLevel = level;
  }

  return issues;
}

function collectTrustSignals(text: string): string[] {
  const lowered = text.toLowerCase();
  return trustKeywords.filter((keyword) => lowered.includes(keyword));
}

function looksLikeHtml(contentType: string): boolean {
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || contentType === "";
}

function buildEvidence(urls: string[], formatter: (url: string) => string): string[] {
  return urls.slice(0, 3).map(formatter);
}

function createIssue(
  id: string,
  category: AuditIssue["category"],
  severity: Severity,
  title: string,
  description: string,
  recommendation: string,
  evidence: string[],
  scoreImpact: number,
): AuditIssue {
  return {
    id,
    category,
    severity,
    title,
    description,
    recommendation,
    evidence,
    scoreImpact,
  };
}

function extractSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(sitemapLocPattern)]
    .map((match) => decodeXmlEntities(normalizeWhitespace(match[1] ?? "")))
    .filter(Boolean);
}

function extractRobotsSitemapUrls(robotsBody: string, siteOrigin: string): string[] {
  return robotsBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.replace(/^sitemap:\s*/i, "").trim())
    .map((value) => {
      try {
        return new URL(value, siteOrigin).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

async function discoverSitemapUrls(siteOrigin: string, siteHostname: string, robotsBody?: string): Promise<SitemapDiscoveryResult> {
  const candidateQueue = [
    new URL("/sitemap.xml", siteOrigin).toString(),
    ...extractRobotsSitemapUrls(robotsBody ?? "", siteOrigin),
  ];
  const visitedSitemaps = new Set<string>();
  const pageUrls = new Set<string>();
  let firstSuccessfulSitemap: FetchDocumentResult | undefined;

  while (candidateQueue.length > 0 && visitedSitemaps.size < 10) {
    const next = candidateQueue.shift();
    if (!next) {
      continue;
    }

    const normalized = normalizeForCrawl(next);
    if (visitedSitemaps.has(normalized)) {
      continue;
    }
    visitedSitemaps.add(normalized);

    const fetched = await fetchOptionalTextResource(new URL(normalized), "application/xml,text/xml,*/*");
    if (!fetched || fetched.statusCode >= 400) {
      continue;
    }

    if (!firstSuccessfulSitemap) {
      firstSuccessfulSitemap = fetched;
    }

    for (const loc of extractSitemapLocs(fetched.body)) {
      try {
        const parsed = new URL(loc, fetched.finalUrl);
        if (parsed.pathname.toLowerCase().endsWith(".xml")) {
          const nested = normalizeForCrawl(parsed.toString());
          if (!visitedSitemaps.has(nested)) {
            candidateQueue.push(nested);
          }
          continue;
        }

        if (isSameSiteUrl(parsed, siteHostname) && isLikelyHtmlUrl(parsed)) {
          pageUrls.add(normalizeForCrawl(parsed.toString()));
        }
      } catch {
        continue;
      }
    }
  }

  if (firstSuccessfulSitemap) {
    return {
      resourceCheck: {
        url: firstSuccessfulSitemap.finalUrl.toString(),
        exists: true,
        detail: `Found with status ${firstSuccessfulSitemap.statusCode}.`,
      },
      pageUrls: [...pageUrls],
    };
  }

  return {
    resourceCheck: {
      url: new URL("/sitemap.xml", siteOrigin).toString(),
      exists: false,
      detail: "No usable sitemap was discovered.",
    },
    pageUrls: [],
  };
}

async function auditPage(
  targetUrl: URL,
  siteHostname: string,
  renderJavascript: boolean,
  crawlDiagnostics: CrawlDiagnostics,
): Promise<PageAuditResult> {
  let fetched: FetchDocumentResult;

  if (renderJavascript) {
    try {
      fetched = await fetchRenderedDocument(targetUrl);
      crawlDiagnostics.renderMode = "playwright";
    } catch (error) {
      crawlDiagnostics.renderMode = "playwright-fallback";
      const compactReason = compactBrowserErrorMessage(error);
      const unavailableReason = getPlaywrightUnavailableReason();
      const note =
        unavailableReason || compactReason.includes('Run "npx playwright install chromium"')
          ? `Playwright rendering is unavailable. Falling back to raw HTML fetch. ${unavailableReason ?? compactReason}`
          : `Playwright rendering failed for ${targetUrl.toString()}. Falling back to raw HTML fetch. ${compactReason}`.trim();
      if (!crawlDiagnostics.notes.includes(note)) {
        crawlDiagnostics.notes.push(note);
      }
      fetched = await fetchTextDocument(targetUrl, "text/html,application/xhtml+xml");
    }
  } else {
    fetched = await fetchTextDocument(targetUrl, "text/html,application/xhtml+xml");
  }

  if (!looksLikeHtml(fetched.contentType)) {
    throw new Error(`Expected HTML at ${targetUrl.toString()}, received ${fetched.contentType || "unknown content type"}.`);
  }

  const $ = load(fetched.body);
  const bodyText = normalizeWhitespace($("body").text());
  const words = bodyText ? bodyText.split(/\s+/) : [];
  const allLinks = $("a[href]").toArray();
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();

  for (const element of allLinks) {
    const href = $(element).attr("href");
    if (!href) {
      continue;
    }

    try {
      const parsed = new URL(href, fetched.finalUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        continue;
      }

      const normalized = normalizeForCrawl(parsed.toString());

      if (isSameSiteUrl(parsed, siteHostname)) {
        if (isLikelyHtmlUrl(parsed)) {
          internalLinks.add(normalized);
        }
      } else {
        externalLinks.add(normalized);
      }
    } catch {
      continue;
    }
  }

  const buttonTexts = $("button, a, input[type='submit'], input[type='button']")
    .toArray()
    .map((element) => normalizeWhitespace($(element).text() || $(element).attr("value") || ""))
    .filter(Boolean);
  const ctaPhrases = [...new Set(buttonTexts.filter((text) => ctaPattern.test(text)).slice(0, 8))];

  const pageTitle = normalizeWhitespace($("title").first().text());
  const metaDescription =
    normalizeWhitespace($("meta[name='description']").attr("content") ?? "") ||
    normalizeWhitespace($("meta[property='og:description']").attr("content") ?? "");
  const headings = $("h1, h2, h3, h4, h5, h6")
    .toArray()
    .map((element) => element.tagName.toLowerCase());
  const htmlLang = normalizeWhitespace($("html").attr("lang") ?? "");
  const pageHtml = $.html();

  const page: PageAudit = {
    url: fetched.finalUrl.toString(),
    statusCode: fetched.statusCode,
    responseTimeMs: fetched.responseTimeMs,
    title: pageTitle,
    titleLength: pageTitle.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    h1Count: $("h1").length,
    hasViewport: $("meta[name='viewport']").length > 0,
    hasCanonical: $("link[rel='canonical']").length > 0,
    hasLang: htmlLang.length > 0,
    hasOpenGraph: $("meta[property^='og:']").length > 0,
    hasTwitterCard: $("meta[name^='twitter:']").length > 0,
    hasStructuredData: $("script[type='application/ld+json']").length > 0,
    hasFavicon: $("link[rel*='icon']").length > 0,
    hasRobotsMeta: $("meta[name='robots']").length > 0,
    wordCount: words.length,
    internalLinkCount: internalLinks.size,
    externalLinkCount: externalLinks.size,
    forms: $("form").length,
    buttonCount: $("button, a[role='button'], input[type='submit'], input[type='button']").length,
    imageCount: $("img").length,
    imagesMissingAlt: $("img")
      .toArray()
      .filter((element) => !normalizeWhitespace($(element).attr("alt") ?? "")).length,
    lazyLoadedImages: $("img")
      .toArray()
      .filter((element) => ($(element).attr("loading") ?? "").toLowerCase() === "lazy").length,
    missingImageDimensions: $("img")
      .toArray()
      .filter((element) => !$(element).attr("width") || !$(element).attr("height")).length,
    headingOrderIssues: getHeadingOrderIssues(headings),
    hasContactSignals:
      $("a[href^='mailto:']").length > 0 ||
      $("a[href^='tel:']").length > 0 ||
      emailPattern.test(pageHtml) ||
      phonePattern.test(bodyText),
    hasPrivacyLink: $("a[href]")
      .toArray()
      .some((element) => {
        const combined = `${$(element).attr("href") ?? ""} ${$(element).text()}`.toLowerCase();
        return combined.includes("privacy") || combined.includes("terms") || combined.includes("policy");
      }),
    ctaPhrases,
    trustSignals: collectTrustSignals(bodyText),
    textSample: words.slice(0, 180).join(" "),
  };

  return {
    page,
    discoveredLinks: [...internalLinks],
  };
}

async function auditSiteResource(resourceUrl: URL, accept: string, requiredText?: string): Promise<ResourceCheck> {
  try {
    const fetched = await fetchTextDocument(resourceUrl, accept);
    const exists = fetched.statusCode >= 200 && fetched.statusCode < 400;
    const hasExpectedText = requiredText ? fetched.body.toLowerCase().includes(requiredText) : true;

    return {
      url: fetched.finalUrl.toString(),
      exists: exists && hasExpectedText,
      detail: exists
        ? hasExpectedText
          ? `Found with status ${fetched.statusCode}.`
          : "Fetched successfully, but expected content was not present."
        : `Returned status ${fetched.statusCode}.`,
    };
  } catch (error) {
    return {
      url: resourceUrl.toString(),
      exists: false,
      detail: error instanceof Error ? error.message : "Unable to fetch resource.",
    };
  }
}

function buildSiteSignals(pages: PageAudit[], origin: string, robotsTxt: ResourceCheck, sitemapXml: ResourceCheck): SiteSignals {
  const totalImages = pages.reduce((sum, page) => sum + page.imageCount, 0);
  const imagesMissingAlt = pages.reduce((sum, page) => sum + page.imagesMissingAlt, 0);
  const totalResponseTime = pages.reduce((sum, page) => sum + page.responseTimeMs, 0);

  return {
    origin,
    averageResponseTimeMs: pages.length ? Math.round(totalResponseTime / pages.length) : 0,
    totalImages,
    imagesMissingAlt,
    pagesWithForms: pages.filter((page) => page.forms > 0).length,
    pagesWithStrongCtas: pages.filter((page) => page.ctaPhrases.length > 0).length,
    contactSignalsFound: pages.some((page) => page.hasContactSignals),
    privacyLinkFound: pages.some((page) => page.hasPrivacyLink),
    robotsTxt,
    sitemapXml,
  };
}

function buildWins(pages: PageAudit[], siteSignals: SiteSignals): string[] {
  const homepage = pages[0];
  const wins: string[] = [];

  if (homepage && homepage.titleLength >= 30 && homepage.titleLength <= 60 && homepage.metaDescriptionLength >= 120) {
    wins.push("Homepage metadata is present and roughly within healthy SEO ranges.");
  }

  if (siteSignals.robotsTxt.exists && siteSignals.sitemapXml.exists) {
    wins.push("Core crawlability files are present with robots.txt and sitemap.xml.");
  }

  if (siteSignals.imagesMissingAlt === 0 && siteSignals.totalImages > 0) {
    wins.push("Image alt coverage looks complete across the audited pages.");
  }

  if (pages.every((page) => page.hasViewport && page.hasLang)) {
    wins.push("Viewport and language declarations are in place across the audited pages.");
  }

  if (pages.some((page) => page.ctaPhrases.length >= 2)) {
    wins.push("The site shows clear call-to-action language instead of passive navigation only.");
  }

  if (siteSignals.contactSignalsFound && siteSignals.privacyLinkFound) {
    wins.push("Visitors can find contact and policy signals, which helps trust and lead capture.");
  }

  if (siteSignals.averageResponseTimeMs > 0 && siteSignals.averageResponseTimeMs < 800) {
    wins.push("Server response times are reasonably fast on the audited pages.");
  }

  return wins.slice(0, 6);
}

function buildIssues(pages: PageAudit[], siteSignals: SiteSignals): AuditIssue[] {
  const homepage = pages[0];
  const issues: AuditIssue[] = [];

  const pagesMissingTitle = pages.filter((page) => !page.title);
  const pagesBadTitleLength = pages.filter((page) => page.title && (page.titleLength < 30 || page.titleLength > 60));
  const pagesMissingMeta = pages.filter((page) => !page.metaDescription);
  const pagesBadMetaLength = pages.filter(
    (page) => page.metaDescription && (page.metaDescriptionLength < 120 || page.metaDescriptionLength > 160),
  );
  const pagesBadH1 = pages.filter((page) => page.h1Count !== 1);
  const pagesMissingViewport = pages.filter((page) => !page.hasViewport);
  const pagesMissingCanonical = pages.filter((page) => !page.hasCanonical);
  const pagesMissingLang = pages.filter((page) => !page.hasLang);
  const pagesMissingOpenGraph = pages.filter((page) => !page.hasOpenGraph);
  const pagesMissingTwitter = pages.filter((page) => !page.hasTwitterCard);
  const pagesWithHeadingOrderIssues = pages.filter((page) => page.headingOrderIssues > 0);
  const pagesWithoutStrongCtas = pages.filter((page) => page.ctaPhrases.length === 0);
  const pagesWithoutTrustSignals = pages.filter((page) => page.trustSignals.length === 0);
  const pagesWithoutContactSignals = pages.filter((page) => !page.hasContactSignals);
  const pagesWithoutPrivacyLinks = pages.filter((page) => !page.hasPrivacyLink);
  const pagesWithoutFavicon = pages.filter((page) => !page.hasFavicon);
  const pagesWithThinContent = pages.filter((page) => page.wordCount < 180);
  const totalMissingAlt = pages.reduce((sum, page) => sum + page.imagesMissingAlt, 0);
  const totalImages = pages.reduce((sum, page) => sum + page.imageCount, 0);
  const totalMissingImageDimensions = pages.reduce((sum, page) => sum + page.missingImageDimensions, 0);
  const totalLazyLoadedImages = pages.reduce((sum, page) => sum + page.lazyLoadedImages, 0);
  const lazyLoadCoverage = totalImages > 0 ? totalLazyLoadedImages / totalImages : 1;

  if (homepage && !homepage.url.startsWith("https://")) {
    issues.push(
      createIssue(
        "https",
        "technical",
        "high",
        "Homepage is not resolving to HTTPS",
        "The audited entry page is loading over plain HTTP, which can reduce trust and hurt browser security signals.",
        "Force HTTPS at the edge and redirect all insecure requests to the canonical secure URL.",
        [homepage.url],
        18,
      ),
    );
  }

  if (pagesMissingViewport.length > 0) {
    issues.push(
      createIssue(
        "viewport",
        "accessibility",
        "high",
        "Some pages are missing a mobile viewport declaration",
        "Without a proper viewport tag, pages can render poorly on phones and small tablets.",
        "Add a standard responsive viewport meta tag to every template.",
        buildEvidence(
          pagesMissingViewport.map((page) => page.url),
          (url) => `${url} is missing a viewport meta tag.`,
        ),
        16,
      ),
    );
  }

  if (pagesMissingLang.length > 0) {
    issues.push(
      createIssue(
        "lang",
        "accessibility",
        "medium",
        "Some pages are missing an HTML language declaration",
        "Screen readers and search engines use the page language to interpret content correctly.",
        "Set the <html lang> attribute consistently across the site.",
        buildEvidence(
          pagesMissingLang.map((page) => page.url),
          (url) => `${url} does not declare a language.`,
        ),
        8,
      ),
    );
  }

  if (totalMissingAlt > 0) {
    issues.push(
      createIssue(
        "alt-text",
        "accessibility",
        totalMissingAlt >= 4 ? "high" : "medium",
        "Some images are missing alt text",
        "Missing alt text weakens accessibility and leaves image meaning unavailable to assistive technology.",
        "Add concise, useful alt text to informative images and keep decorative images empty-alt.",
        [`${totalMissingAlt} of ${totalImages} images are missing alt text on the audited pages.`],
        totalMissingAlt >= 4 ? 16 : 10,
      ),
    );
  }

  if (pagesWithHeadingOrderIssues.length > 0) {
    issues.push(
      createIssue(
        "heading-order",
        "accessibility",
        "medium",
        "Heading hierarchy jumps between levels",
        "Skipped heading levels can make a page harder to scan and harder for assistive technology to navigate.",
        "Keep headings in a logical sequence instead of jumping from H1 to H3 or H4.",
        buildEvidence(
          pagesWithHeadingOrderIssues.map((page) => page.url),
          (url) => `${url} contains heading-order jumps.`,
        ),
        8,
      ),
    );
  }

  if (pagesMissingTitle.length > 0) {
    issues.push(
      createIssue(
        "missing-title",
        "seo",
        "high",
        "Some pages are missing a title tag",
        "Pages without title tags lose a key search signal and usually look weak in browser tabs and search results.",
        "Add a unique, descriptive title to every important page.",
        buildEvidence(
          pagesMissingTitle.map((page) => page.url),
          (url) => `${url} has no title tag.`,
        ),
        14,
      ),
    );
  } else if (pagesBadTitleLength.length > 0) {
    issues.push(
      createIssue(
        "title-length",
        "seo",
        "medium",
        "Some page titles are outside healthy length ranges",
        "Titles that are too short or too long tend to underperform in search and communicate less clearly.",
        "Aim for concise titles that usually land around 30 to 60 characters while staying specific.",
        buildEvidence(
          pagesBadTitleLength.map((page) => page.url),
          (url) => `${url} has a ${pages.find((entry) => entry.url === url)?.titleLength ?? 0}-character title.`,
        ),
        8,
      ),
    );
  }

  if (pagesMissingMeta.length > 0) {
    issues.push(
      createIssue(
        "missing-meta-description",
        "seo",
        "medium",
        "Some pages are missing a meta description",
        "Missing descriptions reduce control over how pages appear in search snippets and social previews.",
        "Write unique meta descriptions for landing pages and core content pages.",
        buildEvidence(
          pagesMissingMeta.map((page) => page.url),
          (url) => `${url} has no meta description.`,
        ),
        10,
      ),
    );
  } else if (pagesBadMetaLength.length > 0) {
    issues.push(
      createIssue(
        "meta-length",
        "seo",
        "low",
        "Some meta descriptions are too short or too long",
        "Description length does not need to be perfect, but extreme lengths reduce clarity and snippet quality.",
        "Tighten or expand descriptions so key pages explain value clearly in one sentence.",
        buildEvidence(
          pagesBadMetaLength.map((page) => page.url),
          (url) => `${url} has a ${pages.find((entry) => entry.url === url)?.metaDescriptionLength ?? 0}-character description.`,
        ),
        5,
      ),
    );
  }

  if (pagesBadH1.length > 0) {
    issues.push(
      createIssue(
        "h1",
        "content",
        "medium",
        "Some pages do not use a single clear H1",
        "Pages with zero or multiple H1 elements often feel less focused to both visitors and search engines.",
        "Use one strong H1 per page that matches the primary intent of that page.",
        buildEvidence(
          pagesBadH1.map((page) => page.url),
          (url) => `${url} has ${pages.find((entry) => entry.url === url)?.h1Count ?? 0} H1 tags.`,
        ),
        10,
      ),
    );
  }

  if (pagesMissingCanonical.length > 0) {
    issues.push(
      createIssue(
        "canonical",
        "seo",
        "low",
        "Canonical tags are missing on some pages",
        "Canonical tags help search engines understand the preferred version of a page when duplicates or parameters exist.",
        "Add a canonical tag to each indexable template.",
        buildEvidence(
          pagesMissingCanonical.map((page) => page.url),
          (url) => `${url} is missing a canonical tag.`,
        ),
        4,
      ),
    );
  }

  if (!siteSignals.robotsTxt.exists) {
    issues.push(
      createIssue(
        "robots",
        "seo",
        "medium",
        "robots.txt could not be found",
        "Search engines expect a robots file even when the site is meant to be crawlable.",
        "Publish a robots.txt file that points to the sitemap and clarifies crawl rules.",
        [siteSignals.robotsTxt.detail],
        9,
      ),
    );
  }

  if (!siteSignals.sitemapXml.exists) {
    issues.push(
      createIssue(
        "sitemap",
        "seo",
        "medium",
        "sitemap.xml could not be found",
        "A sitemap is not mandatory for every site, but it helps search engines discover important pages faster.",
        "Publish a sitemap.xml file and reference it from robots.txt.",
        [siteSignals.sitemapXml.detail],
        7,
      ),
    );
  }

  if (homepage && !homepage.hasStructuredData) {
    issues.push(
      createIssue(
        "structured-data",
        "seo",
        "low",
        "Homepage does not expose JSON-LD structured data",
        "Structured data is a useful reinforcement signal for organization, local business, product, and article pages.",
        "Add schema markup that fits the business type and important landing pages.",
        [homepage.url],
        5,
      ),
    );
  }

  if (pagesMissingOpenGraph.length > 0 || pagesMissingTwitter.length > 0) {
    issues.push(
      createIssue(
        "social-metadata",
        "conversion",
        "low",
        "Social sharing metadata is incomplete on some pages",
        "Missing Open Graph or Twitter cards leads to weak previews when links are shared in messages and social feeds.",
        "Add consistent Open Graph and Twitter metadata to key landing pages.",
        [
          `${pagesMissingOpenGraph.length} pages are missing Open Graph tags.`,
          `${pagesMissingTwitter.length} pages are missing Twitter card tags.`,
        ],
        5,
      ),
    );
  }

  if (pagesWithoutStrongCtas.length === pages.length) {
    issues.push(
      createIssue(
        "cta",
        "conversion",
        "high",
        "The audited pages do not show strong call-to-action language",
        "Visitors need a clear next step. Without visible CTA copy, traffic is more likely to bounce instead of converting.",
        "Add direct CTA language such as booking, contact, request a quote, or start now to the pages that matter most.",
        ["No CTA phrases were detected on the audited pages."],
        15,
      ),
    );
  }

  if (pagesWithThinContent.length > 0) {
    issues.push(
      createIssue(
        "thin-content",
        "content",
        "medium",
        "Some audited pages have very light content",
        "Thin pages often struggle to communicate value, rank well, and answer buyer questions.",
        "Expand key landing pages with clearer messaging, proof, FAQs, and outcome-oriented copy.",
        buildEvidence(
          pagesWithThinContent.map((page) => page.url),
          (url) => `${url} has fewer than 180 words of visible text.`,
        ),
        10,
      ),
    );
  }

  if (siteSignals.averageResponseTimeMs > 2500) {
    issues.push(
      createIssue(
        "response-time",
        "technical",
        "high",
        "Average server response time looks slow",
        "This is not full Core Web Vitals data, but slow document responses can still harm user experience and crawl efficiency.",
        "Review hosting, caching, and backend bottlenecks on the slowest landing pages.",
        [`Average document response time across audited pages: ${siteSignals.averageResponseTimeMs}ms.`],
        15,
      ),
    );
  } else if (siteSignals.averageResponseTimeMs > 1500) {
    issues.push(
      createIssue(
        "response-time",
        "technical",
        "medium",
        "Average server response time is trending slow",
        "The site responds, but the server-side document load time suggests room for caching or hosting improvements.",
        "Improve document caching and reduce backend overhead on the slowest templates.",
        [`Average document response time across audited pages: ${siteSignals.averageResponseTimeMs}ms.`],
        10,
      ),
    );
  }

  if (totalImages >= 8 && lazyLoadCoverage < 0.4) {
    issues.push(
      createIssue(
        "lazy-loading",
        "technical",
        "low",
        "Many images are not marked for lazy loading",
        "Image-heavy pages can feel slower than they need to when off-screen media loads immediately.",
        "Lazy-load non-critical below-the-fold images where appropriate.",
        [`Only ${Math.round(lazyLoadCoverage * 100)}% of audited images use loading="lazy".`],
        5,
      ),
    );
  }

  if (totalMissingImageDimensions > 0) {
    issues.push(
      createIssue(
        "image-dimensions",
        "technical",
        "low",
        "Some images are missing explicit dimensions",
        "Missing width and height attributes can contribute to layout shifts while pages load.",
        "Declare image dimensions or use components that preserve aspect ratios.",
        [`${totalMissingImageDimensions} images are missing explicit dimensions.`],
        4,
      ),
    );
  }

  if (pagesWithoutContactSignals.length === pages.length) {
    issues.push(
      createIssue(
        "contact-signals",
        "trust",
        "medium",
        "Clear contact signals were not detected",
        "Sites that hide contact information or booking paths often convert less effectively, especially for service businesses.",
        "Expose an email, phone number, booking CTA, or contact form on key pages.",
        ["No contact signals were detected in the audited pages."],
        10,
      ),
    );
  }

  if (pagesWithoutPrivacyLinks.length === pages.length) {
    issues.push(
      createIssue(
        "privacy",
        "trust",
        "medium",
        "Privacy or policy links were not detected",
        "Even small businesses benefit from visible privacy and policy links because they signal legitimacy and reduce hesitation.",
        "Add a footer privacy link and any required policy pages for your market.",
        ["No privacy, policy, or terms links were detected in the audited pages."],
        9,
      ),
    );
  }

  if (pagesWithoutTrustSignals.length === pages.length) {
    issues.push(
      createIssue(
        "trust-signals",
        "trust",
        "medium",
        "Trust-building content appears limited",
        "Testimonials, case studies, reviews, guarantees, or client references help reduce buying friction.",
        "Add proof such as testimonials, client logos, results, reviews, or case-study snippets.",
        ["No trust-related keywords were detected in the audited pages."],
        10,
      ),
    );
  }

  if (pagesWithoutFavicon.length > 0) {
    issues.push(
      createIssue(
        "favicon",
        "trust",
        "low",
        "Some pages are missing a favicon reference",
        "Favicons are small, but they still affect polish and brand recognition in tabs, bookmarks, and mobile installs.",
        "Add a favicon reference to the shared site head.",
        buildEvidence(
          pagesWithoutFavicon.map((page) => page.url),
          (url) => `${url} does not expose a favicon link.`,
        ),
        3,
      ),
    );
  }

  return sortIssues(issues);
}

export async function auditSite(rawUrl: string, options: AuditOptions = {}): Promise<SiteAuditReport> {
  const input = auditInputSchema.parse({
    url: rawUrl,
    maxPages: options.maxPages,
    renderJavascript: options.renderJavascript,
    runLighthouse: options.runLighthouse,
  });
  const maxPages = input.maxPages ?? Number(process.env.DEFAULT_MAX_PAGES ?? 4);
  const renderJavascript = input.renderJavascript ?? false;
  const runLighthouse = input.runLighthouse ?? true;
  const reportId = options.reportId ?? createReportId();
  const requestedUrl = normalizePublicUrl(input.url);
  const crawlDiagnostics: CrawlDiagnostics = {
    requestedMaxPages: maxPages,
    renderMode: renderJavascript ? "playwright-fallback" : "http",
    usedSitemapFallback: false,
    discoveredFromHtml: 0,
    discoveredFromSitemap: 0,
    notes: [],
    skippedPages: [],
  };

  const homepageResult = await auditPage(requestedUrl, requestedUrl.hostname, renderJavascript, crawlDiagnostics);
  const canonicalHostname = new URL(homepageResult.page.url).hostname;
  const siteOrigin = new URL(homepageResult.page.url).origin;
  const browserEvidence = await captureBrowserEvidence(siteOrigin, reportId);
  const visited = new Set<string>([normalizeForCrawl(homepageResult.page.url)]);
  const queued = new Set<string>();
  const queue: QueueItem[] = [];
  const pages: PageAudit[] = [homepageResult.page];
  const htmlDiscovered = new Set<string>();
  const sitemapDiscovered = new Set<string>();

  const enqueue = (url: string, source: "html" | "sitemap") => {
    const normalized = normalizeForCrawl(url);

    if (visited.has(normalized) || queued.has(normalized)) {
      return;
    }

    try {
      const parsed = new URL(normalized);
      if (!isSameSiteUrl(parsed, canonicalHostname) || !isLikelyHtmlUrl(parsed)) {
        return;
      }
    } catch {
      return;
    }

    queue.push({ url: normalized, source });
    queued.add(normalized);
  };

  for (const link of homepageResult.discoveredLinks) {
    const normalized = normalizeForCrawl(link);
    htmlDiscovered.add(normalized);
    enqueue(normalized, "html");
  }

  if (browserEvidence.status === "ok" && browserEvidence.renderedInternalLinks.length > 0) {
    for (const link of browserEvidence.renderedInternalLinks) {
      enqueue(link, "html");
    }
    crawlDiagnostics.notes.push(
      `Browser rendering found ${browserEvidence.renderedInternalLinks.length} same-site links after JavaScript execution.`,
    );
  }

  if (htmlDiscovered.size === 0) {
    crawlDiagnostics.notes.push("No crawlable internal links were found in the initial HTML response.");
  }

  const robotsFetched = await fetchOptionalTextResource(new URL("/robots.txt", siteOrigin), "text/plain,*/*");
  const robotsTxt: ResourceCheck = robotsFetched
    ? {
        url: robotsFetched.finalUrl.toString(),
        exists: robotsFetched.statusCode >= 200 && robotsFetched.statusCode < 400 && robotsFetched.body.toLowerCase().includes("user-agent"),
        detail:
          robotsFetched.statusCode >= 200 && robotsFetched.statusCode < 400
            ? `Found with status ${robotsFetched.statusCode}.`
            : `Returned status ${robotsFetched.statusCode}.`,
      }
    : {
        url: new URL("/robots.txt", siteOrigin).toString(),
        exists: false,
        detail: "Unable to fetch robots.txt.",
      };

  const sitemapDiscovery = await discoverSitemapUrls(siteOrigin, canonicalHostname, robotsFetched?.body);
  for (const url of sitemapDiscovery.pageUrls) {
    const normalized = normalizeForCrawl(url);
    sitemapDiscovered.add(normalized);
    enqueue(normalized, "sitemap");
  }

  crawlDiagnostics.discoveredFromHtml = htmlDiscovered.size;
  crawlDiagnostics.discoveredFromSitemap = sitemapDiscovered.size;
  crawlDiagnostics.usedSitemapFallback = htmlDiscovered.size === 0 && sitemapDiscovered.size > 0;

  if (crawlDiagnostics.usedSitemapFallback) {
    crawlDiagnostics.notes.push("Used sitemap discovery because the initial page did not expose crawlable internal links.");
  }

  if (sitemapDiscovered.size > 0) {
    crawlDiagnostics.notes.push(`Discovered ${sitemapDiscovered.size} same-site URLs from sitemap data.`);
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    const normalized = normalizeForCrawl(next.url);
    queued.delete(normalized);
    if (visited.has(normalized)) {
      continue;
    }

    try {
      const pageResult = await auditPage(new URL(normalized), canonicalHostname, renderJavascript, crawlDiagnostics);
      pages.push(pageResult.page);
      visited.add(normalized);

      for (const link of pageResult.discoveredLinks) {
        const discovered = normalizeForCrawl(link);
        htmlDiscovered.add(discovered);
        enqueue(discovered, "html");
      }
    } catch (error) {
      console.error(`Skipping page ${normalized}:`, error);
      crawlDiagnostics.skippedPages.push({
        url: normalized,
        reason: error instanceof Error ? error.message : "Unknown crawl error.",
        source: next.source,
      });
      visited.add(normalized);
    }
  }

  crawlDiagnostics.discoveredFromHtml = htmlDiscovered.size;
  crawlDiagnostics.discoveredFromSitemap = sitemapDiscovered.size;

  if (pages.length === 1 && maxPages > 1 && queue.length === 0 && crawlDiagnostics.skippedPages.length === 0) {
    crawlDiagnostics.notes.push("The crawl ended at the homepage because no additional same-site HTML pages were discovered.");
  }

  if (renderJavascript && crawlDiagnostics.renderMode === "playwright-fallback") {
    crawlDiagnostics.notes.push("JavaScript rendering was requested, but the crawl used raw HTML for at least part of the run.");
  }

  const sitemapXml = sitemapDiscovery.resourceCheck;
  const siteSignals = buildSiteSignals(pages, siteOrigin, robotsTxt, sitemapXml);
  const issues = buildIssues(pages, siteSignals);
  const categoryScores = buildCategoryScores(issues);
  const overallScore = buildOverallScore(categoryScores);
  const wins = buildWins(pages, siteSignals);
  const lighthouseEvidence = runLighthouse ? await runLighthouseEvidence(siteOrigin, reportId) : undefined;

  if (browserEvidence.status !== "ok") {
    crawlDiagnostics.notes.push(...browserEvidence.notes.filter((note) => !crawlDiagnostics.notes.includes(note)));
  }

  const report: SiteAuditReport = {
    reportId,
    links: buildReportLinks(reportId),
    siteUrl: siteOrigin,
    auditedAt: new Date().toISOString(),
    pageCount: pages.length,
    overallScore,
    categoryScores,
    issues,
    wins,
    pages,
    siteSignals,
    crawlDiagnostics,
    browserEvidence,
    lighthouse: lighthouseEvidence,
  };

  const aiSummary = await maybeGenerateAiSummary(report);
  if (aiSummary) {
    report.aiSummary = aiSummary;
  }

  return report;
}
