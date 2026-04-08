import { auditSite } from "./lib/audit.js";
import { closeSharedPlaywrightBrowser } from "./lib/browser-runtime.js";

const args = process.argv.slice(2);
const url = args[0];
const maxPagesArg = args.find((arg, index) => index > 0 && /^\d+$/.test(arg));
const renderJavascript = args.includes("--render");
const runLighthouse = !args.includes("--no-lighthouse");

if (!url) {
  console.error("Usage: npm run audit -- <url> [maxPages] [--render] [--no-lighthouse]");
  process.exit(1);
}

const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;

try {
  const report = await auditSite(url, {
    maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
    renderJavascript,
    runLighthouse,
  });

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Audit failed.");
  process.exit(1);
} finally {
  await closeSharedPlaywrightBrowser();
}
