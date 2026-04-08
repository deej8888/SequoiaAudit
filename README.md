# Sequoia Audit

Open-source, AI-assisted website auditor for agencies, freelancers, and product teams.

It combines deterministic crawl checks, browser-rendered evidence, Lighthouse runs, saved reports, PDF export, and optional AI synthesis. Scores come from real checks first. AI is only used to summarize and prioritize.

## What it does

- Audits a homepage plus a shallow internal crawl
- Falls back to `sitemap.xml` and sitemap entries from `robots.txt`
- Optionally renders pages with Playwright for JS-heavy sites
- Captures homepage screenshots, console errors, HTTP errors, broken images, and rendered internal links
- Runs Lighthouse on mobile and desktop and stores the raw reports
- Saves every audit as a shareable report with JSON and PDF endpoints
- Accepts lead capture submissions tied to a saved report
- Optionally adds an AI summary when `OPENAI_API_KEY` is configured
- Ships with both a web UI and a CLI

## Included checks

- HTTPS, crawlability, and redirect handling
- Title tags, meta descriptions, H1 usage, canonical, `lang`, viewport, favicon
- Open Graph, Twitter cards, JSON-LD structured data
- Robots.txt and sitemap.xml presence
- CTA coverage, forms, contact signals, privacy/terms links
- Image alt text, image dimensions, lazy loading coverage
- Heading-order issues and shallow content warnings
- Browser evidence for console/network/image failures
- Lighthouse performance, accessibility, best-practices, and SEO categories

## Quick start

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`.

## CLI usage

```bash
npm run audit -- https://example.com
npm run audit -- https://example.com 6 --render
npm run audit -- https://example.com 6 --render --no-lighthouse
```

- The second positional argument is the max page count.
- `--render` enables Playwright-backed crawling.
- Lighthouse is on by default in the CLI. Use `--no-lighthouse` when you want a faster run.

## Saved reports

Every web audit is persisted under `data/`:

- `data/reports` for report JSON
- `data/report-assets` for screenshots and Lighthouse artifacts
- `data/leads` for lead submissions

Each saved report exposes:

- `/reports/:reportId` for the shareable UI route
- `/api/reports/:reportId` for raw JSON
- `/api/reports/:reportId/pdf` for a PDF export
- `/api/reports/:reportId/lead` for lead capture submissions

## API

`POST /api/audit`

```json
{
  "url": "https://example.com",
  "maxPages": 4,
  "renderJavascript": true,
  "runLighthouse": true
}
```

`POST /api/reports/:reportId/lead`

```json
{
  "email": "owner@example.com",
  "name": "Jane Smith",
  "company": "Acme"
}
```

## Environment variables

Copy `.env.example` to `.env` if you want custom config.

```bash
PORT=3000
DEFAULT_MAX_PAGES=4
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
CHROME_PATH=
ALLOW_PRIVATE_TARGETS=false
ALLOW_INSECURE_TLS=false
```

- If `OPENAI_API_KEY` is missing, the app skips the AI summary.
- `CHROME_PATH` can point Lighthouse to a custom Chrome/Chromium binary.
- `ALLOW_PRIVATE_TARGETS` and `ALLOW_INSECURE_TLS` are dev-only escape hatches for local testing.

## Security note

The server blocks obvious localhost and private-network targets by default so the public audit endpoint is not a trivial SSRF hole.

## Verification

Verified locally against a fixture site with:

- `npm run check`
- `npm run build`
- `npm run audit -- http://127.0.0.1:4015 4 --render`
- `POST /api/audit`
- `GET /api/reports/:reportId`
- `POST /api/reports/:reportId/lead`
- `GET /api/reports/:reportId/pdf`
- Browser load of `/reports/:reportId`
