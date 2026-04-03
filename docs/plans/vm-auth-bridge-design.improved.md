# Auth Bridge Scraper Design

**Goal:** Build a stable scraping system where a VM handles jobs and extraction, while a local machine stays logged in and provides authenticated, JavaScript-rendered pages on demand.

**Status:** Approved design

---

## Table of Contents

- [Problem](#problem)
- [Recommended Architecture](#recommended-architecture)
- [Folder Layout](#folder-layout)
- [Runtime Flow](#runtime-flow)
- [Request Format](#request-format)
- [Public vs Authenticated Routing](#public-vs-authenticated-routing)
- [Error Handling](#error-handling)
- [Retry Strategy](#retry-strategy)
- [Concurrency and Rate Limiting](#concurrency-and-rate-limiting)
- [Security](#security)
- [Observability](#observability)
- [Technology Choices](#technology-choices)
- [Why This Design](#why-this-design)
- [Non-Goals For Version 1](#non-goals-for-version-1)

---

## Problem

The target websites may require:

- a real logged-in browser session
- JavaScript rendering before the page content appears
- stable behavior over long periods of time

Copying cookies or browser profiles from a local machine to a VM is fragile. Sessions can be tied to IP, browser fingerprint, CSRF state, local storage, or device history. The most stable option is to keep the login state on the local machine and let the VM ask for authenticated pages when needed.

## Recommended Architecture

Use a hybrid model:

- `login/` runs on the local machine
- `scrapy/` runs on the VM

The local machine owns:

- the persistent Playwright browser profile
- manual login
- page rendering for JavaScript-heavy pages
- authenticated fetches

The VM owns:

- job scheduling
- URL routing
- extraction rules
- retries
- result storage
- logging

This keeps the authentication boundary clean while letting the VM remain the main automation host.

### Sequence Diagram

```
VM (scrapy/)                          Local Machine (login/)
    │                                         │
    │  1. Load job JSON                       │
    │  2. Check auth_mode                     │
    │                                         │
    │── auth_mode=local_bridge ──────────────>│
    │   POST /fetch-page                      │
    │   {site, url, wait_until, extract}      │
    │                                         │
    │                          3. Open page   │
    │                             in Playwright│
    │                          4. Wait for     │
    │                             selector     │
    │                          5. Extract HTML │
    │                          6. Run extract  │
    │                             rules        │
    │                                         │
    │<── FetchResponse ──────────────────────│
    │   {status, html, extracted, final_url}  │
    │                                         │
    │  7. Parse response                      │
    │  8. Save result + debug artifacts       │
    │                                         │
```

For `auth_mode=direct`, the VM fetches the page itself with `httpx` and skips the bridge entirely.

## Folder Layout

```text
project/
  login/
    app/
      __init__.py
      server.py
      browser_session.py
      page_fetcher.py
      extractor.py
      schemas.py
      settings.py
    profile/
    requirements.txt
    .env.example

  scrapy/
    app/
      __init__.py
      runner.py
      scheduler.py
      client.py
      direct_fetch.py
      parser.py
      storage.py
      rules.py
      schemas.py
      settings.py
    jobs/
    output/
    requirements.txt
    .env.example

  shared/
    __init__.py
    schemas.py

  tests/
    __init__.py
    login/
      __init__.py
    scrapy/
      __init__.py
    integration/
      __init__.py

  pyproject.toml
  docs/
    plans/
```

> **Change from original:** Added `shared/` package for schemas used by both sides, `__init__.py` in all test directories, and `pyproject.toml` for unified dependency management. This avoids duplicating schema definitions across `login/` and `scrapy/`.

## Runtime Flow

1. A job is created on the VM with:
   - target URL
   - site name
   - authentication mode
   - wait rules
   - extraction rules
2. The VM decides how to fetch:
   - public and simple page: fetch directly from the VM
   - logged-in or JavaScript-heavy page: send the request to the local bridge
3. The local bridge opens the page in Playwright using the saved browser profile.
4. The local bridge waits for page readiness, then returns:
   - rendered HTML
   - optional screenshot path or bytes
   - optional extracted JSON
5. The VM parses and stores the result, plus debug artifacts for failures.

## Request Format

Use one shared job schema for both sides (defined in `shared/schemas.py`):

```json
{
  "site": "example_site",
  "url": "https://example.com/page/123",
  "auth_mode": "local_bridge",
  "wait_until": "networkidle",
  "wait_for_selector": ".content",
  "extract": {
    "title": "h1",
    "price": ".price",
    "rows": ".table tr"
  }
}
```

## Public vs Authenticated Routing

The VM should use a simple rule:

- `auth_mode=direct` for public pages that do not need the local browser
- `auth_mode=local_bridge` for logged-in or JavaScript-heavy pages

This creates a future-friendly workflow:

1. Start the local login service.
2. Log in once in the persistent browser profile.
3. Submit page jobs to the VM.
4. Let the VM decide whether to fetch directly or through the bridge.

## Error Handling

The local bridge should return explicit statuses:

- `OK`
- `LOGIN_REQUIRED`
- `PAGE_TIMEOUT`
- `SELECTOR_NOT_FOUND`
- `BROWSER_ERROR`

The VM should translate those into operational states:

- `bridge_offline`
- `session_expired`
- `page_structure_changed`
- `retryable_timeout`
- `extraction_failed`

For failures, the VM should save:

- raw HTML
- screenshot
- job configuration
- error log

This makes site changes and expired sessions easier to diagnose.

## Retry Strategy

Not all errors should be retried. The VM should classify errors before deciding:

| Bridge Status       | VM State                | Retryable | Action                          |
|---------------------|-------------------------|-----------|---------------------------------|
| `OK`                | —                       | N/A       | Proceed                         |
| `PAGE_TIMEOUT`      | `retryable_timeout`     | Yes       | Retry up to 3 times with backoff |
| `SELECTOR_NOT_FOUND`| `page_structure_changed`| No        | Save debug artifacts, alert     |
| `LOGIN_REQUIRED`    | `session_expired`       | No        | Pause job queue, notify user    |
| `BROWSER_ERROR`     | `bridge_offline`        | Yes       | Retry after 30s, then alert     |
| Connection refused  | `bridge_offline`        | Yes       | Retry after 60s, then alert     |

Backoff schedule for retryable errors: 5s → 15s → 45s (exponential with jitter).

## Concurrency and Rate Limiting

The local bridge runs a single browser instance. Concurrent requests must be controlled:

- **Bridge side:** Use an `asyncio.Semaphore` to limit concurrent page fetches (default: 1). Queued requests wait rather than spawning parallel browser tabs.
- **VM side:** The job runner should submit requests sequentially per site. Cross-site parallelism is fine since different sites use independent sessions.
- **Per-site rate limits:** The VM should enforce a configurable minimum delay between requests to the same site (default: 2 seconds) to avoid triggering anti-scraping defenses.

## Security

The local login bridge should not expose the browser profile directly.

Security rules:

- keep the Playwright profile only on the local machine
- protect the bridge with a shared API token loaded from environment variables (not hardcoded)
- prefer a private network, SSH tunnel, VPN, or reverse proxy over a public open port
- never copy the full browser profile to the VM
- use HTTPS or SSH tunnel for bridge communication — the API token is sent in headers and must not traverse the network in plaintext
- rotate the API token periodically; both sides read it from `.env` so rotation only requires updating the file and restarting

> **Change from original:** Added transport encryption requirement and token rotation guidance. A plaintext token over HTTP on an untrusted network defeats the purpose of token-based auth.

## Observability

For version 1, keep observability simple but present:

- **Structured logging:** Both `login/` and `scrapy/` should log JSON lines to stdout. Include `job_id`, `site`, `auth_mode`, `status`, and `duration_ms` in every log entry.
- **Metrics file:** The VM should append one JSON line per completed job to `scrapy/output/metrics.jsonl` with timing, status, and retry count.
- **Health check:** The bridge exposes `GET /health` which returns `{"status": "ok", "browser_connected": true}`. The VM should poll this before starting a batch.

## Technology Choices

Recommended initial stack:

- Python 3.11+
- FastAPI for the local bridge
- Playwright for browser automation and session persistence
- httpx for VM-to-local API calls
- BeautifulSoup or selectolax for server-side extraction on the VM
- pytest for unit and integration tests
- SQLite or JSONL for the first storage layer
- pydantic-settings for configuration (with `.env` file support)

## Why This Design

This design is more stable than cookie sync because the authenticated page is opened by the same local browser environment that performed the login. It also keeps the VM useful for scheduling, orchestration, and future scaling without forcing all scraping to run on the local machine.

## Non-Goals For Version 1

To keep the first version simple, do not add:

- multiple browser engines
- distributed worker queues
- CAPTCHA solving
- dynamic workflow builders
- database clusters
- automatic session refresh (user logs in manually)
- multi-user support

Version 1 should prove one reliable path:

- login locally
- fetch authenticated page through the bridge
- extract data on the VM
- save result and debug artifacts

### Candidates for Version 2

These are explicitly deferred, not forgotten:

- **Automatic session health checks** — periodically verify the login is still valid by fetching a known authenticated page
- **Job scheduling with cron expressions** — allow recurring scrape jobs
- **Webhook notifications** — notify external systems on job completion or failure
- **Multi-site browser profiles** — separate Playwright profiles per target site
- **Result diffing** — detect when extracted data changes between runs
