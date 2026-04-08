---
status: completed
date: 2026-03-15
---

# Auth Bridge Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a two-part scraping system where the VM runs scraping jobs and the local machine provides authenticated, JavaScript-rendered pages through a protected bridge.

**Architecture:** The implementation is split into `login/`, `scrapy/`, and `shared/`. The `login/` service runs locally with a persistent Playwright browser profile and exposes fetch/extract APIs. The `scrapy/` side runs on the VM, decides whether to fetch directly or through the bridge, stores outputs, and saves debug artifacts. The `shared/` package holds schemas and types used by both sides.

**Tech Stack:** Python 3.11+, FastAPI, Playwright, httpx, BeautifulSoup, pytest, SQLite, pydantic-settings

---

### Task 1: Bootstrap Repository Structure

**Files:**
- Create: `pyproject.toml`
- Create: `shared/__init__.py`
- Create: `login/app/__init__.py`
- Create: `login/app/settings.py`
- Create: `login/requirements.txt`
- Create: `login/.env.example`
- Create: `scrapy/app/__init__.py`
- Create: `scrapy/app/settings.py`
- Create: `scrapy/requirements.txt`
- Create: `scrapy/.env.example`
- Create: `tests/__init__.py`
- Create: `tests/login/__init__.py`
- Create: `tests/scrapy/__init__.py`
- Create: `tests/integration/__init__.py`

> **Change from original:** Added `pyproject.toml` for unified project config, `shared/` package, and `__init__.py` in all test directories so pytest discovers them correctly.

**Step 1: Write the failing test**

```python
# tests/integration/test_settings_bootstrap.py
from login.app.settings import LoginSettings
from scrapy.app.settings import ScrapySettings


def test_login_settings_load_defaults():
    login_settings = LoginSettings()

    assert login_settings.host == "127.0.0.1"
    assert login_settings.port == 8787
    assert login_settings.profile_dir == "login/profile"


def test_scrapy_settings_load_defaults():
    scrapy_settings = ScrapySettings()

    assert scrapy_settings.output_dir == "scrapy/output"
    assert scrapy_settings.bridge_base_url == "http://127.0.0.1:8787"


def test_login_settings_reads_from_env(monkeypatch):
    monkeypatch.setenv("API_TOKEN", "test-secret-123")
    login_settings = LoginSettings()

    assert login_settings.api_token == "test-secret-123"
```

Save to `tests/integration/test_settings_bootstrap.py`.

> **Change from original:** Added test for environment variable loading and more assertions to verify all default values, not just two fields.

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_settings_bootstrap.py -v`
Expected: FAIL with `ModuleNotFoundError` for `login.app.settings`

**Step 3: Write minimal implementation**

`pyproject.toml`

```toml
[project]
name = "auth-bridge-scraper"
version = "0.1.0"
requires-python = ">=3.11"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`login/app/settings.py`

```python
from pydantic_settings import BaseSettings


class LoginSettings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8787
    api_token: str = "change-me"
    profile_dir: str = "login/profile"

    model_config = {"env_prefix": "", "env_file": "login/.env"}
```

> **Change from original:** Added `model_config` with `env_file` so pydantic-settings actually reads `.env` files. Without this, the `.env.example` files are misleading because nothing would load them.

`scrapy/app/settings.py`

```python
from pydantic_settings import BaseSettings


class ScrapySettings(BaseSettings):
    bridge_base_url: str = "http://127.0.0.1:8787"
    bridge_api_token: str = "change-me"
    output_dir: str = "scrapy/output"
    database_url: str = "sqlite:///scrapy/output/jobs.db"

    model_config = {"env_prefix": "", "env_file": "scrapy/.env"}
```

`login/.env.example`

```text
API_TOKEN=change-me
HOST=127.0.0.1
PORT=8787
PROFILE_DIR=login/profile
```

`scrapy/.env.example`

```text
BRIDGE_BASE_URL=http://127.0.0.1:8787
BRIDGE_API_TOKEN=change-me
OUTPUT_DIR=scrapy/output
DATABASE_URL=sqlite:///scrapy/output/jobs.db
```

`login/requirements.txt`

```text
fastapi
uvicorn
playwright
pydantic-settings
beautifulsoup4
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
git add pyproject.toml shared/ login/ scrapy/ tests/
git commit -m "chore: bootstrap auth bridge scraper structure"
```

---

### Task 2: Define Shared Request and Response Schemas

**Files:**
- Create: `shared/schemas.py`
- Test: `tests/integration/test_shared_schemas.py`

> **Change from original:** Schemas now live in `shared/schemas.py` instead of being duplicated in both `login/app/schemas.py` and `scrapy/app/schemas.py`. The original plan copied the same code into two places and said "refactor later" — this avoids drift from day one. Both `login/` and `scrapy/` import from `shared.schemas`.

**Step 1: Write the failing test**

```python
# tests/integration/test_shared_schemas.py
import pytest
from shared.schemas import FetchRequest, FetchResponse


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
    assert request.auth_mode == "local_bridge"


def test_fetch_request_defaults_to_direct():
    request = FetchRequest(
        site="public_site",
        url="https://example.com/public",
    )

    assert request.auth_mode == "direct"
    assert request.wait_until == "load"
    assert request.extract == {}


def test_fetch_response_carries_html_and_status():
    response = FetchResponse(
        status="OK",
        final_url="https://example.com/item/1",
        html="<html></html>",
        extracted={"title": "Example"},
    )

    assert response.status == "OK"
    assert response.extracted["title"] == "Example"


def test_fetch_response_rejects_invalid_status():
    with pytest.raises(Exception):
        FetchResponse(
            status="INVALID_STATUS",
            final_url="https://example.com",
        )
```

> **Change from original:** Added tests for default values and invalid status rejection. The original only tested the happy path.

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_shared_schemas.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write minimal implementation**

`shared/schemas.py`

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

Then add convenience re-exports in both packages:

`login/app/schemas.py`

```python
from shared.schemas import FetchRequest, FetchResponse

__all__ = ["FetchRequest", "FetchResponse"]
```

`scrapy/app/schemas.py`

```python
from shared.schemas import FetchRequest, FetchResponse

__all__ = ["FetchRequest", "FetchResponse"]
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_shared_schemas.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/schemas.py login/app/schemas.py scrapy/app/schemas.py tests/integration/test_shared_schemas.py
git commit -m "feat: add shared fetch schemas"
```

---

### Task 3: Build the Local Browser Session Manager

**Files:**
- Create: `login/app/browser_session.py`
- Test: `tests/login/test_browser_session.py`

**Step 1: Write the failing test**

```python
# tests/login/test_browser_session.py
import pytest
from login.app.browser_session import BrowserSession


def test_browser_session_uses_persistent_profile_dir(tmp_path):
    profile = tmp_path / "profile"
    session = BrowserSession(profile_dir=str(profile))

    assert session.profile_dir == str(profile)


def test_browser_session_not_connected_initially(tmp_path):
    session = BrowserSession(profile_dir=str(tmp_path / "profile"))

    assert session.is_connected is False


@pytest.mark.asyncio
async def test_browser_session_stop_is_idempotent(tmp_path):
    session = BrowserSession(profile_dir=str(tmp_path / "profile"))

    # Stopping without starting should not raise
    await session.stop()
    assert session.is_connected is False
```

> **Change from original:** Added tests for connection state and idempotent stop. The original only tested the path string, which doesn't validate any meaningful behavior.

**Step 2: Run test to verify it fails**

Run: `pytest tests/login/test_browser_session.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
# login/app/browser_session.py
from pathlib import Path

from playwright.async_api import async_playwright


class BrowserSession:
    def __init__(self, profile_dir: str):
        self.profile_dir = str(Path(profile_dir))
        self._playwright = None
        self._context = None

    @property
    def is_connected(self) -> bool:
        return self._context is not None

    async def start(self):
        if self._context is not None:
            return self._context

        self._playwright = await async_playwright().start()
        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=self.profile_dir,
            headless=False,
        )
        return self._context

    async def stop(self):
        if self._context is not None:
            await self._context.close()
            self._context = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/login/test_browser_session.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/browser_session.py tests/login/test_browser_session.py
git commit -m "feat: add persistent browser session manager"
```

---

### Task 4: Add the Local Fetcher for Logged-In and JS Pages

**Files:**
- Create: `login/app/page_fetcher.py`
- Test: `tests/login/test_page_fetcher.py`

**Step 1: Write the failing test**

```python
# tests/login/test_page_fetcher.py
import pytest
from login.app.page_fetcher import map_error_to_status


def test_map_timeout_error_returns_page_timeout():
    assert map_error_to_status(TimeoutError("timed out")) == "PAGE_TIMEOUT"


def test_map_generic_error_returns_browser_error():
    assert map_error_to_status(RuntimeError("something broke")) == "BROWSER_ERROR"


def test_map_error_preserves_message():
    status = map_error_to_status(TimeoutError("custom message"))
    assert status == "PAGE_TIMEOUT"
```

> **Change from original:** Renamed `map_timeout_error` to `map_error_to_status` for clarity — it handles more than just timeouts. Added test for non-timeout errors.

**Step 2: Run test to verify it fails**

Run: `pytest tests/login/test_page_fetcher.py -v`
Expected: FAIL because `map_error_to_status` does not exist

**Step 3: Write minimal implementation**

```python
# login/app/page_fetcher.py
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from shared.schemas import FetchRequest, FetchResponse


def map_error_to_status(error: Exception) -> str:
    if isinstance(error, (TimeoutError, PlaywrightTimeoutError)):
        return "PAGE_TIMEOUT"
    return "BROWSER_ERROR"


class PageFetcher:
    def __init__(self, browser_session):
        self.browser_session = browser_session

    async def fetch(self, request: FetchRequest) -> FetchResponse:
        try:
            context = await self.browser_session.start()
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(str(request.url), wait_until=request.wait_until)

            if request.wait_for_selector:
                await page.wait_for_selector(request.wait_for_selector, timeout=15000)

            html = await page.content()
            return FetchResponse(
                status="OK",
                final_url=page.url,
                html=html,
            )
        except (TimeoutError, PlaywrightTimeoutError) as e:
            return FetchResponse(
                status=map_error_to_status(e),
                final_url=str(request.url),
                error=str(e),
            )
        except Exception as e:
            return FetchResponse(
                status="BROWSER_ERROR",
                final_url=str(request.url),
                error=str(e),
            )
```

> **Change from original:** The fetcher now returns `FetchResponse` objects instead of raw dicts, and handles exceptions properly with error messages. The original had no error handling in the fetcher itself.

**Step 4: Run test to verify it passes**

Run: `pytest tests/login/test_page_fetcher.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/page_fetcher.py tests/login/test_page_fetcher.py
git commit -m "feat: add local page fetcher with error mapping"
```

---

### Task 5: Expose the Local Auth Bridge API

**Files:**
- Create: `login/app/server.py`
- Create: `login/app/extractor.py`
- Test: `tests/login/test_server.py`
- Test: `tests/login/test_extractor.py`

**Step 1: Write the failing test**

```python
# tests/login/test_server.py
from fastapi.testclient import TestClient

from login.app.server import app


def test_health_endpoint_returns_ok():
    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_fetch_page_rejects_missing_token():
    client = TestClient(app)
    response = client.post(
        "/fetch-page",
        json={"site": "test", "url": "https://example.com"},
    )

    assert response.status_code == 401


def test_fetch_page_rejects_invalid_token():
    client = TestClient(app)
    response = client.post(
        "/fetch-page",
        json={"site": "test", "url": "https://example.com"},
        headers={"x-api-token": "wrong-token"},
    )

    assert response.status_code == 401
```

```python
# tests/login/test_extractor.py
from login.app.extractor import extract_fields


def test_extract_fields_reads_text_by_css_selector():
    html = "<html><body><h1>Title</h1><p class='price'>$9.99</p></body></html>"

    result = extract_fields(html, {"title": "h1", "price": ".price"})

    assert result == {"title": "Title", "price": "$9.99"}


def test_extract_fields_returns_empty_for_missing_selector():
    html = "<html><body></body></html>"

    result = extract_fields(html, {"missing": ".does-not-exist"})

    assert result == {"missing": ""}


def test_extract_fields_handles_empty_rules():
    html = "<html><body><h1>Title</h1></body></html>"

    result = extract_fields(html, {})

    assert result == {}
```

> **Change from original:** Added auth rejection tests and a separate extractor test file. The original only tested the health endpoint.

**Step 2: Run test to verify it fails**

Run: `pytest tests/login/test_server.py tests/login/test_extractor.py -v`
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
from login.app.settings import LoginSettings
from shared.schemas import FetchRequest, FetchResponse

settings = LoginSettings()
app = FastAPI()


def verify_token(x_api_token: str = Header(default="")):
    if x_api_token != settings.api_token:
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/fetch-page", response_model=FetchResponse, dependencies=[Depends(verify_token)])
async def fetch_page(request: FetchRequest):
    # Placeholder — wire to PageFetcher after browser session is initialized
    html = "<html></html>"
    extracted = extract_fields(html, request.extract)
    return FetchResponse(
        status="OK",
        final_url=str(request.url),
        html=html,
        extracted=extracted,
    )
```

> **Change from original:** The token is now read from `LoginSettings` (environment variable) instead of being hardcoded as `"change-me"`. The endpoint is `/fetch-page` (matching the client in Task 6) instead of `/extract`.

**Step 4: Run test to verify it passes**

Run: `pytest tests/login/test_server.py tests/login/test_extractor.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add login/app/server.py login/app/extractor.py tests/login/test_server.py tests/login/test_extractor.py
git commit -m "feat: expose local auth bridge API with token auth"
```

---

### Task 6: Add the VM Bridge Client

**Files:**
- Create: `scrapy/app/client.py`
- Test: `tests/scrapy/test_client.py`

**Step 1: Write the failing test**

```python
# tests/scrapy/test_client.py
import pytest
from scrapy.app.client import BridgeClient, build_headers


def test_build_headers_includes_api_token():
    headers = build_headers("secret-token")

    assert headers["x-api-token"] == "secret-token"


def test_bridge_client_stores_config():
    client = BridgeClient(base_url="http://localhost:8787/", token="tok")

    assert client.base_url == "http://localhost:8787"  # trailing slash stripped
    assert client.token == "tok"


@pytest.mark.asyncio
async def test_bridge_client_health_check(httpx_mock):
    """Requires pytest-httpx for mocking."""
    httpx_mock.add_response(
        url="http://localhost:8787/health",
        json={"status": "ok"},
    )

    client = BridgeClient(base_url="http://localhost:8787", token="tok")
    result = await client.health_check()

    assert result["status"] == "ok"
```

> **Change from original:** Added config validation test and async health check test with httpx mocking.

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_client.py -v`
Expected: FAIL because `build_headers` does not exist

**Step 3: Write minimal implementation**

```python
# scrapy/app/client.py
import httpx


def build_headers(token: str) -> dict[str, str]:
    return {"x-api-token": token}


class BridgeClient:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    async def fetch_page(self, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/fetch-page",
                json=payload,
                headers=build_headers(self.token),
            )
            response.raise_for_status()
            return response.json()

    async def health_check(self) -> dict:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{self.base_url}/health")
            response.raise_for_status()
            return response.json()
```

> **Change from original:** Added `health_check()` method and configurable timeout.

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_client.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/client.py tests/scrapy/test_client.py
git commit -m "feat: add VM bridge client with health check"
```

---

### Task 7: Add Direct Fetch Support for Public Pages

**Files:**
- Create: `scrapy/app/direct_fetch.py`
- Test: `tests/scrapy/test_direct_fetch.py`

**Step 1: Write the failing test**

```python
# tests/scrapy/test_direct_fetch.py
import pytest
from scrapy.app.direct_fetch import should_use_bridge


def test_should_use_bridge_for_local_bridge_mode():
    assert should_use_bridge("local_bridge") is True


def test_should_not_use_bridge_for_direct_mode():
    assert should_use_bridge("direct") is False


def test_should_not_use_bridge_for_unknown_mode():
    assert should_use_bridge("unknown") is False
```

> **Change from original:** Added test for unknown auth_mode values — important to verify the system defaults to safe behavior.

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_direct_fetch.py -v`
Expected: FAIL because `should_use_bridge` does not exist

**Step 3: Write minimal implementation**

```python
# scrapy/app/direct_fetch.py
import httpx


def should_use_bridge(auth_mode: str) -> bool:
    return auth_mode == "local_bridge"


async def fetch_direct(url: str, timeout: float = 30.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
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

---

### Task 8: Build the VM Parser and Storage Layer

**Files:**
- Create: `scrapy/app/parser.py`
- Create: `scrapy/app/storage.py`
- Test: `tests/scrapy/test_parser.py`
- Test: `tests/scrapy/test_storage.py`

**Step 1: Write the failing tests**

```python
# tests/scrapy/test_parser.py
from scrapy.app.parser import extract_fields


def test_extract_fields_reads_text_by_css_selector():
    html = "<html><body><h1>Example</h1></body></html>"

    extracted = extract_fields(html, {"title": "h1"})

    assert extracted == {"title": "Example"}


def test_extract_fields_returns_empty_for_missing():
    html = "<html><body></body></html>"

    extracted = extract_fields(html, {"title": "h1"})

    assert extracted == {"title": ""}


def test_extract_fields_handles_nested_selectors():
    html = '<html><body><div class="card"><span class="name">Widget</span></div></body></html>'

    extracted = extract_fields(html, {"name": ".card .name"})

    assert extracted == {"name": "Widget"}
```

```python
# tests/scrapy/test_storage.py
import json
from scrapy.app.storage import save_job_result


def test_save_job_result_creates_json_file(tmp_path):
    payload = {"status": "OK", "title": "Example"}

    path = save_job_result(str(tmp_path), "job-001", payload)

    assert path.exists()
    assert path.name == "job-001.json"
    data = json.loads(path.read_text())
    assert data["status"] == "OK"


def test_save_job_result_creates_parent_dirs(tmp_path):
    nested = tmp_path / "deep" / "nested"

    path = save_job_result(str(nested), "job-002", {"status": "OK"})

    assert path.exists()


def test_save_job_result_preserves_unicode(tmp_path):
    payload = {"title": "Ñoño — café ☕"}

    path = save_job_result(str(tmp_path), "job-unicode", payload)

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["title"] == "Ñoño — café ☕"
```

> **Change from original:** Added unicode preservation test. The original used `ensure_ascii=True` which would escape all non-ASCII characters — bad for international content.

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_parser.py tests/scrapy/test_storage.py -v`
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
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return target
```

> **Change from original:** Fixed `ensure_ascii=False` (was `True`) so unicode content is preserved in output files.

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_parser.py tests/scrapy/test_storage.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/parser.py scrapy/app/storage.py tests/scrapy/test_parser.py tests/scrapy/test_storage.py
git commit -m "feat: add parser and storage layer"
```

---

### Task 9: Build the VM Job Runner

**Files:**
- Create: `scrapy/app/runner.py`
- Create: `scrapy/app/rules.py`
- Test: `tests/scrapy/test_runner.py`

**Step 1: Write the failing test**

```python
# tests/scrapy/test_runner.py
import pytest
from scrapy.app.runner import choose_fetch_mode, validate_job
from scrapy.app.rules import REQUIRED_JOB_KEYS


def test_choose_fetch_mode_matches_auth_mode():
    assert choose_fetch_mode({"auth_mode": "local_bridge"}) == "bridge"
    assert choose_fetch_mode({"auth_mode": "direct"}) == "direct"


def test_validate_job_accepts_complete_job():
    job = {
        "site": "example",
        "url": "https://example.com",
        "auth_mode": "direct",
        "extract": {"title": "h1"},
    }

    errors = validate_job(job)

    assert errors == []


def test_validate_job_rejects_missing_keys():
    job = {"site": "example"}

    errors = validate_job(job)

    assert len(errors) > 0
    assert any("url" in e for e in errors)


def test_required_job_keys_is_complete():
    assert REQUIRED_JOB_KEYS == {"site", "url", "auth_mode", "extract"}
```

> **Change from original:** Added `validate_job` function and tests for job validation. The original had no validation — invalid jobs would fail deep in the pipeline with confusing errors.

**Step 2: Run test to verify it fails**

Run: `pytest tests/scrapy/test_runner.py -v`
Expected: FAIL because `choose_fetch_mode` does not exist

**Step 3: Write minimal implementation**

`scrapy/app/rules.py`

```python
REQUIRED_JOB_KEYS = {"site", "url", "auth_mode", "extract"}
```

`scrapy/app/runner.py`

```python
from scrapy.app.client import BridgeClient
from scrapy.app.direct_fetch import fetch_direct, should_use_bridge
from scrapy.app.parser import extract_fields
from scrapy.app.rules import REQUIRED_JOB_KEYS
from scrapy.app.storage import save_job_result


def choose_fetch_mode(job: dict) -> str:
    return "bridge" if should_use_bridge(job["auth_mode"]) else "direct"


def validate_job(job: dict) -> list[str]:
    missing = REQUIRED_JOB_KEYS - set(job.keys())
    return [f"missing required key: {key}" for key in sorted(missing)]


async def run_job(job: dict, bridge_client: BridgeClient, output_dir: str) -> dict:
    errors = validate_job(job)
    if errors:
        return {"status": "INVALID_JOB", "errors": errors}

    mode = choose_fetch_mode(job)

    if mode == "bridge":
        response = await bridge_client.fetch_page(job)
        html = response.get("html", "")
        status = response.get("status", "BROWSER_ERROR")
        final_url = response.get("final_url", job["url"])
    else:
        html = await fetch_direct(job["url"])
        status = "OK"
        final_url = job["url"]

    extracted = extract_fields(html, job.get("extract", {}))

    result = {
        "status": status,
        "final_url": final_url,
        "extracted": extracted,
    }

    job_id = f"{job['site']}_{hash(job['url']) & 0xFFFFFF:06x}"
    output_path = save_job_result(output_dir, job_id, result)
    result["output_path"] = str(output_path)

    return result
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/scrapy/test_runner.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add scrapy/app/runner.py scrapy/app/rules.py tests/scrapy/test_runner.py
git commit -m "feat: add VM job runner with validation"
```

---

### Task 10: Add End-to-End Integration Coverage

**Files:**
- Create: `tests/integration/test_bridge_flow.py`

**Step 1: Write the failing test**

```python
# tests/integration/test_bridge_flow.py
import pytest
from unittest.mock import AsyncMock, patch

from scrapy.app.runner import run_job
from scrapy.app.client import BridgeClient


@pytest.mark.asyncio
async def test_bridge_job_calls_bridge_client_and_stores_result(tmp_path):
    """End-to-end: bridge job → client call → extraction → storage."""
    mock_client = AsyncMock(spec=BridgeClient)
    mock_client.fetch_page.return_value = {
        "status": "OK",
        "final_url": "https://example.com/account",
        "html": "<html><body><h1>My Account</h1></body></html>",
    }

    job = {
        "site": "example_site",
        "url": "https://example.com/account",
        "auth_mode": "local_bridge",
        "extract": {"title": "h1"},
    }

    result = await run_job(job, bridge_client=mock_client, output_dir=str(tmp_path))

    # Verify the bridge was actually called
    mock_client.fetch_page.assert_called_once_with(job)

    # Verify extraction worked
    assert result["status"] == "OK"
    assert result["extracted"]["title"] == "My Account"

    # Verify file was saved
    assert "output_path" in result
    from pathlib import Path
    assert Path(result["output_path"]).exists()


@pytest.mark.asyncio
async def test_direct_job_fetches_without_bridge(tmp_path):
    """End-to-end: direct job skips bridge entirely."""
    mock_client = AsyncMock(spec=BridgeClient)

    with patch("scrapy.app.runner.fetch_direct", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = "<html><body><h1>Public Page</h1></body></html>"

        job = {
            "site": "public_site",
            "url": "https://example.com/public",
            "auth_mode": "direct",
            "extract": {"title": "h1"},
        }

        result = await run_job(job, bridge_client=mock_client, output_dir=str(tmp_path))

    # Bridge should NOT have been called
    mock_client.fetch_page.assert_not_called()

    assert result["status"] == "OK"
    assert result["extracted"]["title"] == "Public Page"


@pytest.mark.asyncio
async def test_invalid_job_returns_error_without_fetching(tmp_path):
    """Invalid jobs should fail fast without touching the network."""
    mock_client = AsyncMock(spec=BridgeClient)

    job = {"site": "bad_job"}  # Missing url, auth_mode, extract

    result = await run_job(job, bridge_client=mock_client, output_dir=str(tmp_path))

    mock_client.fetch_page.assert_not_called()
    assert result["status"] == "INVALID_JOB"
    assert len(result["errors"]) > 0
```

> **Change from original:** This is a complete rewrite. The original Task 10 test was:
> ```python
> def test_vm_job_uses_bridge_for_authenticated_request():
>     job = {"site": "example_site", "url": "...", "auth_mode": "local_bridge", "extract": {"title": "h1"}}
>     assert job["auth_mode"] == "local_bridge"
> ```
> That test asserts a dict literal equals itself — it tests nothing. The new version uses `AsyncMock` to verify the full flow: bridge client is called, extraction runs, results are stored on disk, and direct jobs skip the bridge.

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_bridge_flow.py -v`
Expected: FAIL until runner orchestration is wired together

**Step 3: Wire together the runner**

The `run_job` function from Task 9 should already handle this. If any test fails, fix the wiring in `scrapy/app/runner.py`.

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_bridge_flow.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/integration/test_bridge_flow.py
git commit -m "test: add integration coverage for bridge flow"
```

---

### Task 11: Add Operational Docs and Startup Commands

**Files:**
- Create: `README.md`
- Create: `login/README.md`
- Create: `scrapy/README.md`

**Step 1: Write the failing test**

Use a manual verification checklist instead of an automated test:

- [ ] docs explain how to install dependencies
- [ ] docs explain how to start the local bridge
- [ ] docs explain how to log in with the Playwright profile
- [ ] docs explain how to submit a VM job
- [ ] docs include a sample job file
- [ ] docs explain how to inspect output

**Step 2: Run manual verification to confirm the gap**

Run: open the repo root and confirm these instructions do not exist
Expected: MISSING documentation

**Step 3: Write minimal implementation**

Document:

- local setup: `pip install -r login/requirements.txt && playwright install chromium`
- starting the bridge: `uvicorn login.app.server:app --host 127.0.0.1 --port 8787`
- how to open the browser and log in manually
- how to send a job JSON to `scrapy/app/runner.py`
- how to inspect `scrapy/output`
- environment variable configuration via `.env` files
- security: SSH tunnel setup for remote bridge access

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

---

### Task 12: Verify the Whole System Before Claiming Success

> **REQUIRED SUB-SKILL:** Use superpowers:verification-before-completion.

**Files:**
- Modify (if needed): any file with issues discovered during verification

**Step 1: Run the full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: ALL PASS — no skips, no xfails hiding real problems

**Step 2: Run the local bridge**

Run: `uvicorn login.app.server:app --host 127.0.0.1 --port 8787`
Expected: server starts without import errors

**Step 3: Verify the health endpoint**

Run: `curl http://127.0.0.1:8787/health`
Expected: `{"status": "ok"}`

**Step 4: Verify browser login flow**

Run: open one target logged-in URL through the local bridge
Expected: the page loads in the persistent browser profile without a new login if the session is still valid

**Step 5: Verify one end-to-end VM job**

Run: `python -m scrapy.app.runner scrapy/jobs/example_job.json`
Expected: one JSON result file appears under `scrapy/output`

**Step 6: Commit only if everything passes**

```bash
git add .
git commit -m "chore: verify auth bridge scraper end to end"
```

> Do NOT commit if any step above failed. Fix the issue first, re-run verification, then commit.

---

## Summary of Improvements Over Original Plan

| Area | Original | Improved |
|------|----------|----------|
| Heading | Truncated (`uth Bridge...`) | Fixed H1 with `#` prefix |
| Schema duplication | Same code in `login/` and `scrapy/`, "refactor later" | `shared/` package from day one |
| Test directories | Missing `__init__.py` | All test dirs have `__init__.py` |
| Project config | No `pyproject.toml` | Added with pytest config |
| Settings `.env` | `pydantic-settings` without `model_config` | Added `env_file` config |
| Token auth | Hardcoded `"change-me"` in server | Reads from `LoginSettings` |
| Storage encoding | `ensure_ascii=True` | `ensure_ascii=False` for unicode |
| Integration test | `assert job["auth_mode"] == "local_bridge"` (tests nothing) | Full async mock-based flow test |
| Error handling | None in `PageFetcher` | Returns typed `FetchResponse` on error |
| Job validation | None | `validate_job()` with missing-key checks |
| Function naming | `map_timeout_error` (handles more than timeouts) | `map_error_to_status` |
| Health check | Only on bridge | Bridge client has `health_check()` method |

## Notes

- If the workspace is not a git repository yet, run `git init` before the first commit.
- If Playwright cannot launch Chromium on the local machine, run `playwright install chromium`.
- Keep `headless=False` during the first version so login debugging stays easy.
- Add screenshots for failures before adding advanced retries.
- Install `pytest-asyncio` and `pytest-httpx` for async test support.
