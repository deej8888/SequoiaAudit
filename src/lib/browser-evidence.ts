import type { BrowserEvidence } from "./types.js";
import { compactBrowserErrorMessage, getSharedPlaywrightBrowser } from "./browser-runtime.js";
import { writeReportAsset } from "./report-store.js";

function normalizeComparableHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isSameSiteUrl(candidate: URL, siteHostname: string): boolean {
  return normalizeComparableHostname(candidate.hostname) === normalizeComparableHostname(siteHostname);
}

function normalizeForCrawl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export async function captureBrowserEvidence(siteUrl: string, reportId: string): Promise<BrowserEvidence> {
  let browser;

  try {
    browser = await getSharedPlaywrightBrowser();
  } catch (error) {
    return {
      status: "unavailable",
      finalUrl: siteUrl,
      screenshots: [],
      renderedInternalLinks: [],
      consoleErrors: [],
      failedRequests: [],
      httpErrors: [],
      brokenImageUrls: [],
      notes: [compactBrowserErrorMessage(error)],
    };
  }

  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: process.env.ALLOW_INSECURE_TLS === "true",
  });
  const desktopPage = await desktopContext.newPage();
  const consoleErrors: BrowserEvidence["consoleErrors"] = [];
  const failedRequests: BrowserEvidence["failedRequests"] = [];
  const httpErrors: BrowserEvidence["httpErrors"] = [];

  desktopPage.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      const location = message.location();
      consoleErrors.push({
        type: message.type(),
        text: message.text(),
        location: location.url ? `${location.url}:${location.lineNumber}` : undefined,
      });
    }
  });

  desktopPage.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? "Request failed.",
    });
  });

  desktopPage.on("response", (response) => {
    if (response.status() >= 400) {
      const request = response.request();
      httpErrors.push({
        url: response.url(),
        resourceType: request.resourceType(),
        status: response.status(),
      });
    }
  });

  try {
    const response = await desktopPage.goto(siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await desktopPage.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);

    const finalUrl = desktopPage.url();
    const finalHostname = new URL(finalUrl).hostname;
    const renderedInternalLinks = await desktopPage.evaluate(
      ({ siteHostname }) =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .map((anchor) => anchor.href)
          .filter(Boolean)
          .filter((href) => {
            try {
              const parsed = new URL(href);
              return parsed.hostname.toLowerCase().replace(/^www\./, "") === siteHostname.toLowerCase().replace(/^www\./, "");
            } catch {
              return false;
            }
          }),
      { siteHostname: finalHostname },
    );

    const brokenImageUrls = await desktopPage.evaluate(() =>
      Array.from(document.images)
        .filter((image) => image.complete && image.naturalWidth === 0 && Boolean(image.currentSrc || image.src))
        .map((image) => image.currentSrc || image.src),
    );

    const desktopScreenshot = await desktopPage.screenshot({ fullPage: true, type: "png" });

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: process.env.ALLOW_INSECURE_TLS === "true",
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await mobilePage.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    const mobileScreenshot = await mobilePage.screenshot({ fullPage: true, type: "png" });
    await mobilePage.close().catch(() => undefined);
    await mobileContext.close().catch(() => undefined);

    return {
      status: "ok",
      finalUrl,
      screenshots: [
        {
          label: "Desktop",
          url: await writeReportAsset(reportId, "homepage-desktop.png", desktopScreenshot),
          viewport: "1440x960",
        },
        {
          label: "Mobile",
          url: await writeReportAsset(reportId, "homepage-mobile.png", mobileScreenshot),
          viewport: "390x844",
        },
      ],
      renderedInternalLinks: [...new Set(renderedInternalLinks.map((href) => normalizeForCrawl(href)))].filter((href) => {
        try {
          return isSameSiteUrl(new URL(href), finalHostname);
        } catch {
          return false;
        }
      }),
      consoleErrors: consoleErrors.slice(0, 12),
      failedRequests: failedRequests.slice(0, 12),
      httpErrors: httpErrors.slice(0, 12),
      brokenImageUrls: brokenImageUrls.slice(0, 12),
      notes: response?.status() && response.status() >= 400 ? [`Homepage returned status ${response.status()} in browser mode.`] : [],
    };
  } catch (error) {
    return {
      status: "failed",
      finalUrl: siteUrl,
      screenshots: [],
      renderedInternalLinks: [],
      consoleErrors: [],
      failedRequests: [],
      httpErrors: [],
      brokenImageUrls: [],
      notes: [compactBrowserErrorMessage(error)],
    };
  } finally {
    await desktopPage.close().catch(() => undefined);
    await desktopContext.close().catch(() => undefined);
  }
}
