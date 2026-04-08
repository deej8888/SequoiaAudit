# Sequoia Audit

Open-source, AI-assisted website auditor built for agencies, freelancers, and product teams.

It runs deterministic audits first, then optionally adds an AI-written summary if `OPENAI_API_KEY` is present. The goal is to keep the report grounded in real signals instead of made-up scores.

## What it does

- Audits a website's homepage plus a shallow crawl of internal pages
- Scores technical, SEO, accessibility, content, conversion, and trust signals
- Highlights the highest-impact issues with clear recommendations
- Generates a concise AI summary and funnel suggestions when OpenAI is configured
- Ships with both a web UI and a CLI for open-source credibility

## Included checks

- HTTPS and redirect handling
- Title, meta description, H1 usage, canonical, `lang`, viewport, favicon
- Open Graph, Twitter cards, JSON-LD structured data
- Robots.txt and sitemap.xml presence
- CTA coverage, forms, contact signals, privacy/terms links
- Image alt text, image dimensions, lazy loading coverage
- Heading-order problems and shallow content warnings
- Server response-time proxy for page responsiveness

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## CLI usage

```bash
npm run audit -- https://example.com
npm run audit -- https://example.com 6
npm run audit -- https://example.com 6 --render
```

The second argument is the max page count to crawl.
Use `--render` to enable Playwright-backed JavaScript rendering for SPA-style sites.

## Playwright setup

If you want rendered crawling, install a browser once:

```bash
npx playwright install chromium
```

If Chromium is missing, the app will fall back to raw HTML crawl mode and explain that in the report.

## Environment variables

Copy `.env.example` to `.env` if you want custom config.

```bash
PORT=3000
DEFAULT_MAX_PAGES=4
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
ALLOW_PRIVATE_TARGETS=false
ALLOW_INSECURE_TLS=false
```

If `OPENAI_API_KEY` is missing, the app still works and skips the AI summary.
`ALLOW_PRIVATE_TARGETS` and `ALLOW_INSECURE_TLS` are dev-only escape hatches for local testing.

## API

`POST /api/audit`

```json
{
  "url": "https://example.com",
  "maxPages": 4
}
```

## Security note

The server blocks obvious localhost and private-network targets so the public audit endpoint is not a trivial SSRF hole.

## Good next steps

- Add screenshot-based visual reviews
- Persist reports and email captures
- Export PDF reports
- Add Lighthouse or PageSpeed integration
- Add a multi-tenant team dashboard
