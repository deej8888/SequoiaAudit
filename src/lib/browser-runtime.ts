import fs from "node:fs";
import type { Browser } from "playwright";
import { chromium } from "playwright";

let sharedBrowserPromise: Promise<Browser> | null = null;
let playwrightUnavailableReason: string | null = null;

export function compactBrowserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "Unknown browser error.";

  if (message.includes("Executable doesn't exist")) {
    return `${firstLine} Run "npx playwright install chromium" to enable browser-backed audits.`;
  }

  return firstLine;
}

export function getPlaywrightChromiumPath(): string | undefined {
  try {
    const executablePath = chromium.executablePath();
    return executablePath && fs.existsSync(executablePath) ? executablePath : undefined;
  } catch {
    return undefined;
  }
}

export function getPlaywrightUnavailableReason(): string | null {
  return playwrightUnavailableReason;
}

export async function getSharedPlaywrightBrowser(): Promise<Browser> {
  if (playwrightUnavailableReason) {
    throw new Error(playwrightUnavailableReason);
  }

  if (!sharedBrowserPromise) {
    sharedBrowserPromise = (async () => {
      try {
        return await chromium.launch({ headless: true });
      } catch (error) {
        playwrightUnavailableReason = compactBrowserErrorMessage(error);
        sharedBrowserPromise = null;
        throw new Error(playwrightUnavailableReason);
      }
    })();
  }

  return sharedBrowserPromise;
}

export async function closeSharedPlaywrightBrowser(): Promise<void> {
  if (!sharedBrowserPromise) {
    return;
  }

  try {
    const browser = await sharedBrowserPromise;
    await browser.close();
  } catch {
    // Ignore shutdown failures and reset local state either way.
  } finally {
    sharedBrowserPromise = null;
  }
}
