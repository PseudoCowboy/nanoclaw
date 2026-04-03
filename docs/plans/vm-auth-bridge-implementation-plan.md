uth Bridge Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a two-part scraping system where the VM runs scraping jobs and the local machine provides authenticated, JavaScript-rendered pages through a protected bridge.

**Architecture:** The implementation is split into `login/` and `scrapy/`. The `login/` service runs locally with a persistent Playwright browser profile and exposes fetch/extract APIs. The `scrapy/` side runs on the VM, decides whether to fetch directly or through the bridge, stores outputs, and saves debug artifacts.

**Tech Stack:** Python 3.11, FastAPI, Playwright, httpx, BeautifulSoup, pytest, SQLite

---

### Task 1: Bootstrap Repository Structure

**Files:**
- Create: `login/app/__init__.py`
- Create: `login/app/settings.py`
- Create: `login/requirements.txt`
- Create: `login/.env.example`
- Create: `scrapy/app/__init__.py`
- Create: `scrapy/app/settings.py`
- Create: `scrapy/requirements.txt`
- Create: `scrapy/.env.example`
- Create: `tests/login/.gitkeep`
- Create: `tests/scrapy/.gitkeep`
- Create: `tests/integration/.gitkeep`

**Step 1: Write the failing test**

```python
from login.app.settings import LoginSettings
from scrapy.app.settings import ScrapySettings


def test_settings_load_defaults():
    login_settings = LoginSettings()
    scrapy_settings = ScrapySettings()

    assert login_settings.host == "127.0.0.1"
    assert scrapy_settings.output_dir == "scrapy/output"
```

Save to `tests/integration/test_settings_bootstrap.py`.

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_settings_bootstrap.py -v`
Expected: FAIL with `ModuleNotFoundError` for `login.app.settings`

**Step 3: Write minimal implementation**

`login/app/settings.py`

```python
from pydantic_settings import BaseSettings


class LoginSettings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8787
    api_token: str = "change-me"
    profile_dir: str = "login/profile"
```

`scrapy/app/settings.py`

```python
from pydantic_settings import BaseSettings


class ScrapySettings(BaseSettings):
    bridge_base_url: str = "http://127.0.0.1:8787"
    bridge_api_token: str = "change-me"
    output_dir: str = "scrapy/output"
    database_url: str = "sqlite:///scrapy/output/jobs.db"
```

`login/requirements.txt`

```text
fastapi
uvicorn
playwright
pydantic-settings
```

`scrapy/requirements.txt`

```text
httpx
beautifulsoup4
pydantic-settings
sqlalchemy
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_settings_bootstrap.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login scrapy tests/integration/test_settings_bootstrap.py
git commit -m "chore: bootstrap auth bridge scraper structure"
```

### Task 2: Define Shared Request and Response Schemas

**Files:**
- Create: `login/app/schemas.py`
- Create: `scrapy/app/schemas.py`
- Test: `tests/integration/test_shared_schemas.py`

**Step 1: Write the failing test**

```python
from login.app.schemas import FetchRequest, FetchResponse


def test_fetch_request_supports_wait_rules():
    request = FetchRequest(
        site="example_site",
        url="https://example.com/item/1",
        auth_mode="local_bridge",
        wait_until="networkidle",
        wait_for_selector=".content",
        extract={"title": "h1"},
    )

    assert request.wait_for_selector == ".content"
    assert request.extract["title"] == "h1"


def test_fetch_response_carries_html_and_status():
    response = FetchResponse(
        status="OK",
        final_url="https://example.com/item/1",
        html="<html></html>",
        extracted={"title": "Example"},
    )

    assert response.status == "OK"
    assert response.extracted["title"] == "Example"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_shared_schemas.py -v`
Expected: FAIL with `ImportError` or missing fields

**Step 3: Write minimal implementation**

`login/app/schemas.py` and `scrapy/app/schemas.py`

```python
from typing import Dict, Literal, Optional

from pydantic import BaseModel, HttpUrl


class FetchRequest(BaseModel):
    site: str
    url: HttpUrl
    auth_mode: Literal["direct", "local_bridge"] = "direct"
    wait_until: Literal["load", "domcontentloaded", "networkidle"] = "load"
    wait_for_selector: Optional[str] = None
    extract: Dict[str, str] = {}


class FetchResponse(BaseModel):
    status: Literal[
        "OK",
        "LOGIN_REQUIRED",
        "PAGE_TIMEOUT",
        "SELECTOR_NOT_FOUND",
        "BROWSER_ERROR",
    ]
    final_url: str
    html: str = ""
    extracted: Dict[str, str] = {}
    screenshot_path: Optional[str] = None
    error: Optional[str] = None
```

Copy the same schema definitions into `scrapy/app/schemas.py` first. Refactor into a shared package only if duplication becomes painful.

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_shared_schemas.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/schemas.py scrapy/app/schemas.py tests/integration/test_shared_schemas.py
git commit -m "feat: add shared fetch schemas"
```

### Task 3: Build the Local Browser Session Manager

**Files:**
- Create: `login/app/browser_session.py`
- Test: `tests/login/test_browser_session.py`

**Step 1: Write the failing test**

```python
from login.app.browser_session import BrowserSession


def test_browser_session_uses_persistent_profile_dir(tmp_path):
    session = BrowserSession(profile_dir=str(tmp_path / "profile"))

    assert session.profile_dir.endswith("profile")
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/login/test_browser_session.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
from pathlib import Path


class BrowserSession:
    def __init__(self, profile_dir: str):
        self.profile_dir = str(Path(profile_dir))

    async def start(self):
        raise NotImplementedError("start Playwright persistent context next")

    async def stop(self):
        return None
```

After the test passes, expand `start()` to create a Playwright persistent Chromium context:

```python
from playwright.async_api import async_playwright


class BrowserSession:
    ...
    async def start(self):
        self._playwright = await async_playwright().start()
        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=self.profile_dir,
            headless=False,
        )
        return self._context
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/login/test_browser_session.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/browser_session.py tests/login/test_browser_session.py
git commit -m "feat: add persistent browser session manager"
```

### Task 4: Add the Local Fetcher for Logged-In and JS Pages

**Files:**
- Create: `login/app/page_fetcher.py`
- Test: `tests/login/test_page_fetcher.py`

**Step 1: Write the failing test**

```python
import pytest

from login.app.page_fetcher import map_timeout_error


def test_map_timeout_error_returns_page_timeout():
    assert map_timeout_error(TimeoutError()) == "PAGE_TIMEOUT"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/login/test_page_fetcher.py -v`
Expected: FAIL because `map_timeout_error` does not exist

**Step 3: Write minimal implementation**

```python
from playwright.async_api import TimeoutError as PlaywrightTimeoutError


def map_timeout_error(error: Exception) -> str:
    if isinstance(error, (TimeoutError, PlaywrightTimeoutError)):
        return "PAGE_TIMEOUT"
    return "BROWSER_ERROR"
```

Then add the main fetcher:

```python
class PageFetcher:
    def __init__(self, browser_session):
        self.browser_session = browser_session

    async def fetch(self, request):
        context = await self.browser_session.start()
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(str(request.url), wait_until=request.wait_until)
        if request.wait_for_selector:
            await page.wait_for_selector(request.wait_for_selector, timeout=15000)
        html = await page.content()
        return {
            "status": "OK",
            "final_url": page.url,
            "html": html,
        }
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/login/test_page_fetcher.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/page_fetcher.py tests/login/test_page_fetcher.py
git commit -m "feat: add local page fetcher"
```

### Task 5: Expose the Local Auth Bridge API

**Files:**
- Create: `login/app/server.py`
- Create: `login/app/extractor.py`
- Test: `tests/login/test_server.py`

**Step 1: Write the failing test**

```python
from fastapi.testclient import TestClient

from login.app.server import app


def test_health_endpoint_returns_ok():
    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/login/test_server.py -v`
Expected: FAIL because `app` does not exist

**Step 3: Write minimal implementation**

`login/app/extractor.py`

```python
from bs4 import BeautifulSoup


def extract_fields(html: str, rules: dict[str, str]) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    result = {}
    for key, selector in rules.items():
        node = soup.select_one(selector)
        result[key] = node.get_text(strip=True) if node else ""
    return result
```

`login/app/server.py`

```python
from fastapi import Depends, FastAPI, Header, HTTPException

from login.app.extractor import extract_fields
from login.app.schemas import FetchRequest, FetchResponse

app = FastAPI()


def verify_token(x_api_token: str = Header(default="")):
    if x_api_token != "change-me":
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract", response_model=FetchResponse, dependencies=[Depends(verify_token)])
async def extract(request: FetchRequest):
    html = "<html></html>"
    extracted = extract_fields(html, request.extract)
    return FetchResponse(status="OK", final_url=str(request.url), html=html, extracted=extracted)
```

After the test passes, replace the placeholder HTML with `PageFetcher.fetch()` output and add `/fetch-page`.

**Step 4: Run test to verify it passes**

Run: `pytest tests/login/test_server.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/server.py login/app/extractor.py tests/login/test_server.py
git commit -m "feat: expose local auth bridge api"
```

### Task 6: Add the VM Bridge Client

**Files:**
- Create: `scrapy/app/client.py`
- Test: `tests/scrapy/test_client.py`

**Step 1: Write the failing test**

```python
from scrapy.app.client import build_headers


def test_build_headers_includes_api_token():
    headers = build_headers("secret-token")

    assert headers["x-api-token"] == "secret-token"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_client.py -v`
Expected: FAIL because `build_headers` does not exist

**Step 3: Write minimal implementation**

```python
import httpx


def build_headers(token: str) -> dict[str, str]:
    return {"x-api-token": token}


class BridgeClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    async def fetch_page(self, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/fetch-page",
                json=payload,
                headers=build_headers(self.token),
            )
            response.raise_for_status()
            return response.json()
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_client.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/client.py tests/scrapy/test_client.py
git commit -m "feat: add vm bridge client"
```

### Task 7: Add Direct Fetch Support for Public Pages

**Files:**
- Create: `scrapy/app/direct_fetch.py`
- Test: `tests/scrapy/test_direct_fetch.py`

**Step 1: Write the failing test**

```python
from scrapy.app.direct_fetch import should_use_bridge


def test_should_use_bridge_for_local_bridge_mode():
    assert should_use_bridge("local_bridge") is True
    assert should_use_bridge("direct") is False
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_direct_fetch.py -v`
Expected: FAIL because `should_use_bridge` does not exist

**Step 3: Write minimal implementation**

```python
import httpx


def should_use_bridge(auth_mode: str) -> bool:
    return auth_mode == "local_bridge"


async def fetch_direct(url: str) -> str:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_direct_fetch.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/direct_fetch.py tests/scrapy/test_direct_fetch.py
git commit -m "feat: add direct public fetch path"
```

### Task 8: Build the VM Parser and Storage Layer

**Files:**
- Create: `scrapy/app/parser.py`
- Create: `scrapy/app/storage.py`
- Test: `tests/scrapy/test_parser.py`
- Test: `tests/scrapy/test_storage.py`

**Step 1: Write the failing test**

```python
from scrapy.app.parser import extract_fields


def test_extract_fields_reads_text_by_css_selector():
    html = "<html><body><h1>Example</h1></body></html>"

    extracted = extract_fields(html, {"title": "h1"})

    assert extracted == {"title": "Example"}
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_parser.py -v`
Expected: FAIL because `extract_fields` does not exist

**Step 3: Write minimal implementation**

`scrapy/app/parser.py`

```python
from bs4 import BeautifulSoup


def extract_fields(html: str, rules: dict[str, str]) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    result = {}
    for key, selector in rules.items():
        node = soup.select_one(selector)
        result[key] = node.get_text(strip=True) if node else ""
    return result
```

`scrapy/app/storage.py`

```python
import json
from pathlib import Path


def save_job_result(output_dir: str, job_id: str, payload: dict) -> Path:
    base = Path(output_dir)
    base.mkdir(parents=True, exist_ok=True)
    target = base / f"{job_id}.json"
    target.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return target
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_parser.py tests/scrapy/test_storage.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/parser.py scrapy/app/storage.py tests/scrapy/test_parser.py tests/scrapy/test_storage.py
git commit -m "feat: add parser and storage layer"
```

### Task 9: Build the VM Job Runner

**Files:**
- Create: `scrapy/app/runner.py`
- Create: `scrapy/app/rules.py`
- Test: `tests/scrapy/test_runner.py`

**Step 1: Write the failing test**

```python
from scrapy.app.runner import choose_fetch_mode


def test_choose_fetch_mode_matches_auth_mode():
    assert choose_fetch_mode({"auth_mode": "local_bridge"}) == "bridge"
    assert choose_fetch_mode({"auth_mode": "direct"}) == "direct"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_runner.py -v`
Expected: FAIL because `choose_fetch_mode` does not exist

**Step 3: Write minimal implementation**

```python
from scrapy.app.direct_fetch import should_use_bridge


def choose_fetch_mode(job: dict) -> str:
    return "bridge" if should_use_bridge(job["auth_mode"]) else "direct"
```

Then expand `runner.py` to:

- load a job JSON file from `scrapy/jobs`
- use `BridgeClient.fetch_page()` for `local_bridge`
- use `fetch_direct()` for `direct`
- run extraction on returned HTML
- save JSON output with `save_job_result()`

Add a simple job contract in `scrapy/app/rules.py`:

```python
REQUIRED_JOB_KEYS = {"site", "url", "auth_mode", "extract"}
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_runner.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/runner.py scrapy/app/rules.py tests/scrapy/test_runner.py
git commit -m "feat: add vm job runner"
```

### Task 10: Add End-to-End Integration Coverage

**Files:**
- Create: `tests/integration/test_bridge_flow.py`

**Step 1: Write the failing test**

```python
def test_vm_job_uses_bridge_for_authenticated_request():
    job = {
        "site": "example_site",
        "url": "https://example.com/account",
        "auth_mode": "local_bridge",
        "extract": {"title": "h1"},
    }

    assert job["auth_mode"] == "local_bridge"
```

Use dependency injection or mocks so the test can assert:

- the VM runner called the bridge client
- extraction ran on returned HTML
- output was saved

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_bridge_flow.py -v`
Expected: FAIL until runner orchestration is wired together

**Step 3: Write minimal implementation**

Wire together:

- `BridgeClient`
- `fetch_direct`
- `extract_fields`
- `save_job_result`

Expose one orchestration function in `scrapy/app/runner.py`:

```python
async def run_job(job: dict, bridge_client, output_dir: str) -> dict:
    ...
```

The function should return a payload with:

- `status`
- `final_url`
- `extracted`
- `output_path`

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_bridge_flow.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/integration/test_bridge_flow.py scrapy/app/runner.py
git commit -m "test: add integration coverage for bridge flow"
```

### Task 11: Add Operational Docs and Startup Commands

**Files:**
- Create: `README.md`
- Create: `login/README.md`
- Create: `scrapy/README.md`

**Step 1: Write the failing test**

Use a manual verification checklist instead of an automated test:

- docs explain how to install dependencies
- docs explain how to start the local bridge
- docs explain how to log in with the Playwright profile
- docs explain how to submit a VM job

**Step 2: Run manual verification to confirm the gap**

Run: open the repo root and confirm these instructions do not exist
Expected: MISSING documentation

**Step 3: Write minimal implementation**

Document:

- local setup
- `playwright install chromium`
- `uvicorn login.app.server:app --host 127.0.0.1 --port 8787`
- how to open the browser and log in
- how to send a job JSON to `scrapy/app/runner.py`
- how to inspect `scrapy/output`

Include a sample job file in the docs:

```json
{
  "site": "example_site",
  "url": "https://example.com/account/orders",
  "auth_mode": "local_bridge",
  "wait_until": "networkidle",
  "wait_for_selector": ".orders-table",
  "extract": {
    "page_title": "h1",
    "first_order": ".orders-table tr:nth-child(2)"
  }
}
```

**Step 4: Run manual verification to confirm it passes**

Run: read the three README files start to finish
Expected: a new teammate can start the bridge and run one job without guessing

**Step 5: Commit**

```bash
git add README.md login/README.md scrapy/README.md
git commit -m "docs: add setup and usage guide"
```

### Task 12: Verify the Whole System Before Claiming Success

**Files:**
- Modify: `README.md`
- Modify: `login/README.md`
- Modify: `scrapy/README.md`

**Step 1: Run the local test suites**

Run: `pytest tests/login tests/scrapy tests/integration -v`
Expected: PASS

**Step 2: Run the local bridge**

Run: `uvicorn login.app.server:app --host 127.0.0.1 --port 8787`
Expected: server starts without import errors

**Step 3: Verify browser login flow**

Run: open one target logged-in URL through the local bridge
Expected: the page loads in the persistent browser profile without a new login if the session is still valid

**Step 4: Verify one end-to-end VM job**

Run: `python -m scrapy.app.runner scrapy/jobs/example_job.json`
Expected: one JSON result file appears under `scrapy/output`

**Step 5: Commit**

```bash
git add .
git commit -m "chore: verify auth bridge scraper end to end"
```

## Notes

- If the workspace is not a git repository yet, run `git init` before the first commit.
- If Playwright cannot launch Chromium on the local machine, run `playwright install chromium`.
- Keep `headless=False` during the first version so login debugging stays easy.
- Add screenshots for failures before adding advanced retries.

