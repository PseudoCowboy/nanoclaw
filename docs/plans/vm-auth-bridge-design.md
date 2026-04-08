---
status: superseded
date: 2026-03-14
superseded_by: vm-auth-bridge-design.improved.md
---

uth Bridge Scraper Design

**Goal:** Build a stable scraping system where a VM handles jobs and extraction, while a local machine stays logged in and provides authenticated, JavaScript-rendered pages on demand.

**Status:** Approved design

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

## Folder Layout

```text
project/
  login/
    app/
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

  tests/
    login/
    scrapy/
    integration/

  docs/
    plans/
```

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

Use one shared job schema for both sides:

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

## Security

The local login bridge should not expose the browser profile directly.

Security rules:

- keep the Playwright profile only on the local machine
- protect the bridge with a shared token
- prefer a private network, SSH tunnel, VPN, or reverse proxy over a public open port
- never copy the full browser profile to the VM

## Technology Choices

Recommended initial stack:

- Python 3.11
- FastAPI for the local bridge
- Playwright for browser automation and session persistence
- httpx for VM-to-local API calls
- BeautifulSoup or selectolax for server-side extraction on the VM
- pytest for unit and integration tests
- SQLite or JSONL for the first storage layer

## Why This Design

This design is more stable than cookie sync because the authenticated page is opened by the same local browser environment that performed the login. It also keeps the VM useful for scheduling, orchestration, and future scaling without forcing all scraping to run on the local machine.

## Non-Goals For Version 1

To keep the first version simple, do not add:

- multiple browser engines
- distributed worker queues
- CAPTCHA solving
- dynamic workflow builders
- database clusters

Version 1 should prove one reliable path:

- login locally
- fetch authenticated page through the bridge
- extract data on the VM
- save result and debug artifacts

