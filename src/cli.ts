import { auditSite } from "./lib/audit.js";

const url = process.argv[2];
const maxPagesArg = process.argv[3];

if (!url) {
  console.error("Usage: npm run audit -- <url> [maxPages]");
  process.exit(1);
}

const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;

try {
  const report = await auditSite(url, {
    maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
  });

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Audit failed.");
  process.exit(1);
}
