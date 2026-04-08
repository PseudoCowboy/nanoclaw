---
status: completed
date: 2026-03-11
---

# Financial Data Collection System — Design Document

**Date:** 2026-03-11
**Status:** Approved

## Goal

Collect all available financial data from AKShare (25 categories) and finshare, store as Parquet files on this machine, with a resumable task-registry architecture that supports daily incremental updates.

## Constraints

- Storage: `/home/pseudo/financial-data/` (~16GB available)
- Rate limiting: 2-5 second randomized delay between API calls
- History depth: All available (some sources go back 20+ years)
- Must be resumable — initial collection takes ~4-5 days
- Parquet format, easy to append for daily scraping

## Architecture: Task-Registry with SQLite Tracker

### Overview

```
task_generator.py  →  tasks.db (SQLite)  →  collector.py  →  /home/pseudo/financial-data/**/*.parquet
                                                ↑
                                         daily_scraper.py
                                         (generates incremental tasks)
```

### Directory Structure

```
/home/pseudo/financial-data/
├── db/
│   └── tasks.db                          # SQLite task registry
├── akshare/
│   ├── stock/
│   │   ├── stock_zh_a_hist/
│   │   │   ├── 000001.parquet            # One file per symbol
│   │   │   ├── 000002.parquet
│   │   │   └── ...
│   │   ├── stock_zh_a_spot_em/
│   │   │   └── latest.parquet            # Snapshot, replaced daily
│   │   ├── stock_financial_abstract_em/
│   │   │   ├── 000001.parquet
│   │   │   └── ...
│   │   └── ... (all stock sub-categories)
│   ├── futures/
│   ├── bond/
│   ├── option/
│   ├── fund/
│   ├── macro/
│   ├── index/
│   ├── fx/
│   ├── crypto/
│   ├── interest_rate/
│   ├── energy/
│   └── commodity/
├── finshare/
│   ├── historical/
│   │   ├── 000001.SZ.parquet
│   │   └── ...
│   ├── snapshots/
│   │   └── latest.parquet
│   └── stock_list/
│       └── latest.parquet
├── scripts/
│   ├── collector.py                      # Main runner
│   ├── task_generator.py                 # Generates tasks into SQLite
│   ├── daily_scraper.py                  # Daily incremental update
│   ├── config.py                         # Rate limits, paths, constants
│   └── utils.py                          # Parquet I/O, dedup helpers
└── logs/
    └── collector.log
```

### SQLite Task Registry Schema

```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,              -- 'akshare' or 'finshare'
    category TEXT NOT NULL,            -- 'stock', 'futures', 'bond', etc.
    function_name TEXT NOT NULL,       -- 'stock_zh_a_hist'
    params TEXT NOT NULL DEFAULT '{}', -- JSON parameters
    output_path TEXT NOT NULL,         -- relative path to parquet file
    append_mode TEXT NOT NULL,         -- 'append', 'replace', 'date_partition'
    dedup_columns TEXT,                -- JSON array of columns for dedup, e.g. '["日期"]'
    status TEXT NOT NULL DEFAULT 'pending', -- pending/running/done/failed/skipped
    error_message TEXT,
    rows_collected INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_source_category ON tasks(source, category);
CREATE UNIQUE INDEX idx_tasks_dedup ON tasks(source, function_name, params);
```

### Runner Logic (collector.py)

1. Pick next task: `SELECT * FROM tasks WHERE status='pending' ORDER BY id LIMIT 1`
2. Mark `running`, set `started_at`
3. Call API function dynamically: `getattr(akshare, function_name)(**params)`
4. On success:
   - If `append_mode='append'`: read existing parquet, concat, deduplicate on `dedup_columns`, sort, write
   - If `append_mode='replace'`: overwrite parquet
   - If `append_mode='date_partition'`: write to date-specific file
   - Mark `done`, set `rows_collected` and `completed_at`
5. On failure:
   - Increment `retry_count`, set `error_message`
   - If `retry_count < 3`: mark `pending` (will retry)
   - If `retry_count >= 3`: mark `failed`
6. Rate limiting:
   - Normal: `random.uniform(2, 5)` seconds between calls
   - On HTTP 429 / ConnectionError: exponential backoff (30s → 60s → 120s → 240s)
   - On repeated failures of same source: pause 5 minutes
7. Log every action to `logs/collector.log`

### Data Scope

#### AKShare Categories (all 25)

| Category | Example Functions | Task Type |
|----------|-------------------|-----------|
| **Stock — A-share** | `stock_zh_a_hist`, `stock_zh_a_spot_em`, `stock_individual_info_em` | Per-symbol + market-wide |
| **Stock — Financials** | `stock_balance_sheet_by_report_em`, `stock_profit_sheet_by_report_em`, `stock_cash_flow_sheet_by_report_em` | Per-symbol |
| **Stock — Capital Flow** | `stock_individual_fund_flow`, `stock_market_fund_flow` | Per-symbol + market-wide |
| **Stock — Shareholders** | `stock_gdfx_top_10_em`, `stock_gdfx_free_top_10_em` | Per-symbol |
| **Stock — Board/Sector** | `stock_board_concept_name_em`, `stock_board_industry_name_em` | Per-board |
| **Stock — Margin** | Margin trading functions | Market-wide |
| **Stock — IPO** | `stock_xgsg_ipo_em` | By date |
| **Stock — Dividends** | `stock_fhps_em` | Market-wide by date |
| **Stock — Limit Up/Down** | `stock_zt_pool_em` | By date |
| **Stock — Block Trades** | `stock_dzjy_*` | By date |
| **Stock — Connect** | `stock_hsgt_*` | Market-wide |
| **Stock — HK** | `stock_hk_*` | Per-symbol |
| **Stock — US** | `stock_us_*` | Per-symbol |
| **Stock — B-share** | `stock_zh_b_*` | Per-symbol |
| **Stock — ESG** | `stock_esg_*` | Per-symbol |
| **Futures** | `futures_*` | Per-contract |
| **Bonds** | `bond_*` | Per-bond + market-wide |
| **Options** | `option_*` | Per-contract |
| **FX** | `fx_*` | Per-pair |
| **Fund (Public)** | `fund_*` | Per-fund |
| **Fund (Private)** | `fund_private_*` | Per-fund |
| **Index** | `index_*` | Per-index |
| **Macro** | `macro_*` | Per-indicator |
| **Crypto** | `crypto_*` | Per-coin |
| **Interest Rate** | SHIBOR, LPR, repo | Market-wide |
| **Energy** | Oil, gas, coal | Market-wide |
| **Commodity** | Spot prices | Per-commodity |

#### finshare

| Function | Description |
|----------|-------------|
| `get_stock_list()` | Full stock list |
| `get_historical_data(symbol)` | K-line for all symbols |
| `get_snapshot_data(symbol)` | Real-time snapshot |
| `get_batch_snapshots(symbols)` | Batch snapshots |

### Parquet Append Strategy

- **Per-symbol files** (e.g., `stock_zh_a_hist/000001.parquet`):
  Read existing → `pd.concat([existing, new])` → deduplicate on date column → sort → write
- **Snapshot files** (e.g., `stock_zh_a_spot_em/latest.parquet`):
  Overwrite entirely each run
- **Date-partitioned files** (e.g., `stock_zt_pool_em/20260311.parquet`):
  One file per date, never appended

### Estimated Scale

- ~5,000 A-share symbols × ~20 per-symbol functions = ~100,000 stock tasks
- ~2,000 HK symbols × ~5 functions = ~10,000 HK tasks
- ~5,000 US symbols × ~5 functions = ~25,000 US tasks
- Market-wide + other categories = ~10,000 tasks
- **Total: ~150,000 tasks**
- At 3s average delay: ~5 days for initial collection

## Plan 1: Daily Scraper for Chinese Data

A cron job / systemd timer running after market close (4:30 PM CST):

1. Check trading calendar (`tool_trade_date_hist_sina()`) — skip non-trading days
2. Generate incremental tasks:
   - Today's price data for all A-share, HK, B-share symbols
   - Today's capital flow, margin, block trades
   - Today's limit-up/down pools
   - Today's fund NAV
   - Today's macro indicators (if released)
   - Today's futures settlement
3. Run collector on these tasks (~30 min)
4. Log results, send notification on completion/failure

## Plan 2: American Stock Data (Equivalent Datasets)

### Recommended Libraries

| Library | What It Covers | Free? |
|---------|---------------|-------|
| **yfinance** | US/global stock prices, financials, options, institutional holders, dividends | Yes |
| **alpha_vantage** | US stocks intraday/daily, forex, crypto, economic indicators | Free tier (25 req/day) |
| **fredapi** | US macro (GDP, CPI, unemployment, rates, money supply) — 800k+ series | Yes (API key) |
| **sec-edgar-downloader** | SEC filings (10-K, 10-Q, 8-K, 13-F) | Yes |
| **polygon.io** | US stocks, options, forex, crypto tick data | Free tier limited |
| **finnhub** | US stock prices, financials, SEC filings, IPO calendar | Free tier |
| **AKShare** | `stock_us_hist()`, `stock_us_daily()` for US stocks via EastMoney | Yes |

### Recommended Combination

- **yfinance** — Primary source for US stock historical data, financials, options chains
- **fredapi** — All US macro data (comprehensive Federal Reserve database)
- **sec-edgar-downloader** — Company filings
- **AKShare US functions** — Supplementary US stock data

### Same Architecture

The same task-registry + collector architecture works. Just add:
- `us_task_generator.py` — enumerates S&P 500, NASDAQ 100, Russell 2000 symbols
- New category directories under `/home/pseudo/financial-data/us/`
- Different rate limits per source (yfinance: 1-2s, FRED: 0.5s, SEC: 10s)

## Dependencies

```
pip install akshare finshare pandas pyarrow
# For US data (Plan 2):
pip install yfinance fredapi sec-edgar-downloader
```
