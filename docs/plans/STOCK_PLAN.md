---
status: draft
date: 2026-03-01
---


# FinShare Stock + News Lakehouse Plan

## Summary
- Build a lakehouse-first ingestion system around FinShare’s documented stock history, snapshots, A-share stock list, multi-market coverage, async batching, caching, and source routing. Phase 1 is China/HK/US stock daily K-line plus end-of-day refresh; Phase 2 is news crawling and tag linkage; documented secondary datasets come after the stock/news foundation. ([finvfamily.github.io](https://finvfamily.github.io/finshare/))
- Use Parquet as the canonical storage format on local disk and S3. Enable Parquet compression (`zstd` preferred, `snappy` acceptable). Do not wrap the live dataset in `7z`; only create optional monthly `7z` cold-archive bundles after a partition is closed, checksummed, and uploaded.
- Use a hybrid persistence model: Parquet for canonical data, SQLite for job state and manifests, and DuckDB for analytical queries that join news, tags, and price history.

## Public Interfaces
- Provide CLI entrypoints: `universe sync`, `prices backfill`, `prices update-eod`, `news crawl`, `tags rebuild`, `validate day`, and `export archive`.
- Define canonical datasets: `security_master`, `security_daily`, `news_article`, `tag_registry`, `security_tag_map`, `news_tag_map`, `news_security_link`, `ingest_manifest`, and `validation_report`.
- Reuse the protected direct-vs-bridge fetch model from [vm-auth-bridge-design.md](/home/pseudo/nanoclaw/vm-auth-bridge-design.md) and [vm-auth-bridge-implementation-plan.md](/home/pseudo/nanoclaw/vm-auth-bridge-implementation-plan.md) for Scrapy news sources that need login or rendered pages.

## Implementation Changes
- **Universe management:** A-shares come from FinShare `get_stock_list`; HK and US symbol universes come from external list imports and are normalized into one `security_master` table with `market`, `code`, `name`, `status`, `source`, `first_seen_at`, and `last_seen_at`. ([finvfamily.github.io](https://finvfamily.github.io/finshare/))
- **Price ingestion:** Build a market adapter over FinShare with a conservative rate limiter. Default backfill mode is one request at a time per source, `2.5s +/- 1s` jitter, checkpoint every 100 symbols, and automatic cool-down on repeated empty/error bursts. Store only daily `raw` K-line in v1, with one canonical schema: `code`, `market`, `trade_date`, `open_price`, `high_price`, `low_price`, `close_price`, `volume`, `amount`, `source`, `ingested_at`.
- **EOD latest updater:** Run one post-close job per exchange and write only the completed trading day; no intraday snapshots in v1. Keep per-market watermarks and symbol-level retry queues so reruns are idempotent.
- **News ingestion:** Build a Scrapy-based crawler with source adapters. Public sources fetch directly; authenticated or JavaScript-heavy sources route through the auth bridge. Normalize articles into `news_article`, dedupe by canonical URL plus title hash plus publish-time window, and persist raw HTML for debug on failures.
- **Tagging and linkage:** Start rule-based, not ML-first. Maintain a manual `tag_registry`, map tags to companies and securities, extract tags from article title/body/section/source rules, and generate `news_security_link` rows with confidence and explanation. This creates the app join path: `news -> tags -> securities -> daily prices`.
- **Validation and quality:** `validate day` accepts `market`, `code`, and `trade_date`, re-fetches that day from FinShare, compares OHLCV and amount field-by-field, and emits pass/fail plus a structured diff. Add completeness checks for missing trade dates, duplicate rows, negative prices/volumes, and sudden symbol-universe shrinkage.
- **Backlog after stock/news foundation:** Add the currently documented secondary FinShare datasets in this order: financial statements, funds/ETF/LOF, futures, specialty data, then low-priority index coverage. Options are not part of this plan. ([finvfamily.github.io](https://finvfamily.github.io/finshare/))

## Test Plan
- Unit tests for code normalization, exchange-calendar handling, rate-limiter behavior, Parquet schema enforcement, tag extraction rules, and diff generation.
- Integration tests for China/HK/US daily backfill on small symbol samples, resume-from-checkpoint after interruption, end-of-day reruns being idempotent, and S3 upload/download manifest integrity.
- News tests for direct fetch, auth-bridge fetch, duplicate suppression, article normalization, tag-to-security linking, and failure-artifact capture.
- Acceptance scenario: ingest one real news article, link it to tagged companies, query prior articles with the same tags, and retrieve the surrounding daily K-line windows from the warehouse.
- Validation acceptance: a known-good day returns no diffs, and a tampered row returns a field-level mismatch report.

## Assumptions
- FinShare remains the market-data client; external sources are allowed only for HK/US universe discovery and for news crawling. The documented FinShare surface targeted first is stock history/snapshots plus the broader stock/fund/future/financial/specialty families. ([finvfamily.github.io](https://finvfamily.github.io/finshare/))
- v1 freshness means end-of-day only: China, HK, and US run separate post-close daily jobs in each exchange’s local close window.
- Canonical warehouse format is Parquet on S3 with built-in columnar compression; optional `7z` bundles are cold backups only.
- Indexes are backlog, not a blocker for the first implementation.

