#!/usr/bin/env python3
"""
Gold Price Spider — Fetches XAUUSD spot price, 1-hour high/low,
USD/CNY exchange rate, and computes Chinese Gold Price (CNY/g).

Sources:
  - Swissquote public feed: real-time XAUUSD bid/ask (primary)
  - Yahoo Finance chart API: 5-min candles for 1h high/low (with crumb auth)
  - Kitco proxy: day high/low as fallback
  - open.er-api.com: USD/CNY exchange rate (free, no key)

Formula:
  Chinese Gold Price (CNY/g) = (XAUUSD ÷ 31.1034768) × USD/CNY
"""

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone

import scrapy
from scrapy.crawler import CrawlerProcess

# Troy ounce to grams
TROY_OZ_GRAMS = 31.1034768

# NanoClaw IPC config
IPC_DIR = os.environ.get(
    "NANOCLAW_IPC_DIR",
    os.path.expanduser("~/nanoclaw/data/ipc/iris/messages"),
)
TELEGRAM_JID = os.environ.get("TELEGRAM_JID", "tg:1885279478")
SEND_TELEGRAM = os.environ.get("SEND_TELEGRAM", "0") == "1"


class GoldPriceItem(scrapy.Item):
    source = scrapy.Field()
    xauusd_current = scrapy.Field()
    xauusd_1h_high = scrapy.Field()
    xauusd_1h_low = scrapy.Field()
    usd_cny = scrapy.Field()
    gold_cny_per_gram = scrapy.Field()
    gold_cny_per_gram_1h_high = scrapy.Field()
    gold_cny_per_gram_1h_low = scrapy.Field()
    timestamp = scrapy.Field()


class GoldPriceSpider(scrapy.Spider):
    name = "gold_price"
    custom_settings = {
        "LOG_LEVEL": "WARNING",
        "ROBOTSTXT_OBEY": False,
        "CONCURRENT_REQUESTS": 4,
        "DOWNLOAD_TIMEOUT": 20,
        "RETRY_TIMES": 1,
        "USER_AGENT": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "DEFAULT_REQUEST_HEADERS": {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.xauusd_current = None
        self.xauusd_1h_high = None
        self.xauusd_1h_low = None
        self.usd_cny = None
        self._emitted = False
        self._pending_requests = 3  # track how many requests are outstanding
        self._sources = []

    def start_requests(self):
        # 1) Swissquote — real-time XAUUSD bid/ask
        yield scrapy.Request(
            url="https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
            callback=self.parse_swissquote,
            errback=self.on_swissquote_error,
            dont_filter=True,
            meta={"dont_redirect": True},
        )

        # 2) Yahoo Finance — first get a crumb, then fetch candles
        yield scrapy.Request(
            url="https://query2.finance.yahoo.com/v1/test/getcrumb",
            callback=self.parse_yahoo_crumb,
            errback=self.on_yahoo_error,
            dont_filter=True,
            headers={
                "Accept": "text/plain",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
        )

        # 3) USD/CNY exchange rate — open.er-api.com
        yield scrapy.Request(
            url="https://open.er-api.com/v6/latest/USD",
            callback=self.parse_usdcny,
            errback=self.on_usdcny_error,
            dont_filter=True,
        )

    # ─── Swissquote: real-time XAUUSD ──────────────────────────────

    def parse_swissquote(self, response):
        try:
            data = json.loads(response.text)
            # Find the "standard" spread profile from the first entry
            for entry in data:
                for sp in entry.get("spreadProfilePrices", []):
                    if sp.get("spreadProfile") == "standard":
                        bid = sp["bid"]
                        ask = sp["ask"]
                        self.xauusd_current = round((bid + ask) / 2, 2)
                        self._sources.append("Swissquote")
                        self.logger.warning(
                            f"[Swissquote] XAUUSD bid={bid}, ask={ask}, mid={self.xauusd_current}"
                        )
                        break
                if self.xauusd_current is not None:
                    break

            # Fallback: use any available profile
            if self.xauusd_current is None:
                for entry in data:
                    for sp in entry.get("spreadProfilePrices", []):
                        bid = sp["bid"]
                        ask = sp["ask"]
                        self.xauusd_current = round((bid + ask) / 2, 2)
                        self._sources.append("Swissquote")
                        break
                    if self.xauusd_current is not None:
                        break
        except Exception as e:
            self.logger.error(f"[Swissquote] parse error: {e}")

        self._request_done()

    def on_swissquote_error(self, failure):
        self.logger.warning(f"[Swissquote] failed: {failure.value}")
        self._request_done()

    # ─── Yahoo Finance: crumb → candles ────────────────────────────

    def parse_yahoo_crumb(self, response):
        crumb = response.text.strip()
        if not crumb or response.status != 200:
            self.logger.warning(f"[Yahoo] Failed to get crumb (status={response.status})")
            # Try without crumb as fallback
            yield from self._fetch_yahoo_candles(crumb=None, cookies=None)
            return

        cookies = {}
        for cookie in response.headers.getlist("Set-Cookie"):
            cookie_str = cookie.decode("utf-8", errors="replace")
            for part in cookie_str.split(";"):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1)
                    if k.strip() in ("A1", "A3", "A1S"):
                        cookies[k.strip()] = v.strip()

        yield from self._fetch_yahoo_candles(crumb=crumb, cookies=cookies)

    def _fetch_yahoo_candles(self, crumb=None, cookies=None):
        url = "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=5m&range=1d"
        if crumb:
            url += f"&crumb={crumb}"

        yield scrapy.Request(
            url=url,
            callback=self.parse_yahoo_candles,
            errback=self.on_yahoo_error,
            dont_filter=True,
            cookies=cookies or {},
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
        )

    def parse_yahoo_candles(self, response):
        if response.status == 429:
            self.logger.warning("[Yahoo] Rate limited (429), trying Kitco fallback...")
            yield from self._fetch_kitco()
            return

        try:
            data = json.loads(response.text)
            result = data["chart"]["result"][0]
            meta = result["meta"]
            timestamps = result.get("timestamp", [])
            quotes = result["indicators"]["quote"][0]

            # Use Yahoo's current price as fallback if Swissquote failed
            yahoo_price = meta.get("regularMarketPrice")
            if self.xauusd_current is None and yahoo_price:
                self.xauusd_current = round(yahoo_price, 2)
                self._sources.append("Yahoo")
                self.logger.warning(f"[Yahoo] Using meta price: {self.xauusd_current}")

            # Compute 1-hour high/low from recent candles
            now_ts = int(time.time())
            one_hour_ago = now_ts - 3600

            highs, lows = [], []
            for i, ts in enumerate(timestamps):
                if ts >= one_hour_ago:
                    h = quotes["high"][i]
                    l = quotes["low"][i]
                    if h is not None:
                        highs.append(h)
                    if l is not None:
                        lows.append(l)

            if highs and lows:
                self.xauusd_1h_high = round(max(highs), 2)
                self.xauusd_1h_low = round(min(lows), 2)
                self._sources.append("Yahoo-candles")
                self.logger.warning(
                    f"[Yahoo] 1h range ({len(highs)} candles): "
                    f"high={self.xauusd_1h_high}, low={self.xauusd_1h_low}"
                )
            else:
                # No recent candles — try day range from meta
                day_high = meta.get("regularMarketDayHigh")
                day_low = meta.get("regularMarketDayLow")
                if day_high and day_low:
                    self.xauusd_1h_high = round(day_high, 2)
                    self.xauusd_1h_low = round(day_low, 2)
                    self._sources.append("Yahoo-day")
                    self.logger.warning(
                        f"[Yahoo] Market closed? Using day range: "
                        f"high={self.xauusd_1h_high}, low={self.xauusd_1h_low}"
                    )
                else:
                    self.logger.warning("[Yahoo] No candle data, trying Kitco...")
                    yield from self._fetch_kitco()
                    return

        except Exception as e:
            self.logger.error(f"[Yahoo] parse error: {e}, trying Kitco...")
            yield from self._fetch_kitco()
            return

        self._request_done()

    def on_yahoo_error(self, failure):
        self.logger.warning(f"[Yahoo] request failed: {failure.value}, trying Kitco...")
        yield from self._fetch_kitco()

    # ─── Kitco: fallback for high/low ──────────────────────────────

    def _fetch_kitco(self):
        yield scrapy.Request(
            url="https://proxy.kitco.com/getPM?symbol=AU&currency=USD&unit=ounce",
            callback=self.parse_kitco,
            errback=self.on_kitco_error,
            dont_filter=True,
            headers={
                "Accept": "*/*",
                "Origin": "https://www.kitco.com",
                "Referer": "https://www.kitco.com/",
            },
        )

    def parse_kitco(self, response):
        try:
            # CSV format: symbol,currency,unit,timestamp,bid,mid,ask,change,change%,day_low,day_high
            text = response.text.strip()
            parts = text.split(",")
            if len(parts) >= 11:
                bid = float(parts[4])
                mid = float(parts[5])
                ask = float(parts[6])
                day_low = float(parts[9])
                day_high = float(parts[10])

                if self.xauusd_current is None:
                    self.xauusd_current = round(mid, 2)
                    self._sources.append("Kitco")

                if self.xauusd_1h_high is None:
                    self.xauusd_1h_high = round(day_high, 2)
                    self.xauusd_1h_low = round(day_low, 2)
                    self._sources.append("Kitco-day")
                    self.logger.warning(
                        f"[Kitco] bid={bid}, mid={mid}, ask={ask}, "
                        f"day_low={day_low}, day_high={day_high}"
                    )
            else:
                self.logger.error(f"[Kitco] Unexpected format: {text[:200]}")
        except Exception as e:
            self.logger.error(f"[Kitco] parse error: {e}")

        self._request_done()

    def on_kitco_error(self, failure):
        self.logger.warning(f"[Kitco] failed: {failure.value}")
        self._request_done()

    # ─── USD/CNY exchange rate ─────────────────────────────────────

    def parse_usdcny(self, response):
        try:
            data = json.loads(response.text)
            self.usd_cny = data["rates"]["CNY"]
            self._sources.append("ExchangeRate-API")
            self.logger.warning(f"[ExchangeRate] USD/CNY = {self.usd_cny}")
        except Exception as e:
            self.logger.error(f"[ExchangeRate] parse error: {e}")

        self._request_done()

    def on_usdcny_error(self, failure):
        self.logger.warning(f"[ExchangeRate] failed: {failure.value}, trying Frankfurter...")
        yield scrapy.Request(
            url="https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY",
            callback=self.parse_frankfurter,
            errback=self.on_frankfurter_error,
            dont_filter=True,
        )

    def parse_frankfurter(self, response):
        try:
            data = json.loads(response.text)
            self.usd_cny = data["rates"]["CNY"]
            self._sources.append("Frankfurter")
            self.logger.warning(f"[Frankfurter] USD/CNY = {self.usd_cny}")
        except Exception as e:
            self.logger.error(f"[Frankfurter] parse error: {e}")

        self._request_done()

    def on_frankfurter_error(self, failure):
        self.logger.error(f"[Frankfurter] also failed: {failure.value}")
        self._request_done()

    # ─── Combine and output ────────────────────────────────────────

    def _request_done(self):
        """Called when a logical request chain completes. Emits when all data is ready."""
        self._pending_requests -= 1

        if self._emitted:
            return

        # Try to emit if we have enough data
        if self.xauusd_current is not None and self.usd_cny is not None:
            # We have the minimum — emit if we also have high/low OR all requests are done
            if self.xauusd_1h_high is not None or self._pending_requests <= 0:
                self._emit()
        elif self._pending_requests <= 0:
            # All requests done but missing data
            if self.xauusd_current is None:
                print("\n❌ ERROR: Could not fetch XAUUSD price from any source.")
            if self.usd_cny is None:
                print("\n❌ ERROR: Could not fetch USD/CNY exchange rate from any source.")

    def _emit(self):
        """Emit the final item with all collected data."""
        if self._emitted:
            return
        self._emitted = True

        gold_cny_per_gram = (self.xauusd_current / TROY_OZ_GRAMS) * self.usd_cny

        gold_cny_1h_high = None
        gold_cny_1h_low = None
        if self.xauusd_1h_high is not None:
            gold_cny_1h_high = (self.xauusd_1h_high / TROY_OZ_GRAMS) * self.usd_cny
        if self.xauusd_1h_low is not None:
            gold_cny_1h_low = (self.xauusd_1h_low / TROY_OZ_GRAMS) * self.usd_cny

        source_str = " + ".join(sorted(set(self._sources)))

        item = GoldPriceItem(
            source=source_str,
            xauusd_current=self.xauusd_current,
            xauusd_1h_high=self.xauusd_1h_high,
            xauusd_1h_low=self.xauusd_1h_low,
            usd_cny=self.usd_cny,
            gold_cny_per_gram=round(gold_cny_per_gram, 2),
            gold_cny_per_gram_1h_high=round(gold_cny_1h_high, 2) if gold_cny_1h_high else None,
            gold_cny_per_gram_1h_low=round(gold_cny_1h_low, 2) if gold_cny_1h_low else None,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        # ── Pretty print (console) ──
        ts = item["timestamp"]
        print("\n" + "=" * 62)
        print("  🥇  GOLD PRICE REPORT")
        print("=" * 62)
        print(f"  Timestamp (UTC)    : {ts}")
        print(f"  Data Sources       : {source_str}")
        print("-" * 62)
        print(f"  XAUUSD Current     : ${item['xauusd_current']:>10,.2f} /oz")
        if item["xauusd_1h_high"]:
            hl_label = "1h" if "candles" in source_str.lower() else "Day"
            print(f"  XAUUSD {hl_label} High    : ${item['xauusd_1h_high']:>10,.2f} /oz")
            print(f"  XAUUSD {hl_label} Low     : ${item['xauusd_1h_low']:>10,.2f} /oz")
        print(f"  USD/CNY Rate       : {item['usd_cny']:>14.4f}")
        print("-" * 62)
        print(f"  Formula: (XAUUSD ÷ {TROY_OZ_GRAMS}) × USD/CNY")
        print("=" * 62)
        print(f"  💰 Gold Price (CNY/g)      :  ¥{item['gold_cny_per_gram']:>9,.2f}")
        if item["gold_cny_per_gram_1h_high"]:
            print(f"  📈 High (CNY/g)            :  ¥{item['gold_cny_per_gram_1h_high']:>9,.2f}")
        if item["gold_cny_per_gram_1h_low"]:
            print(f"  📉 Low  (CNY/g)            :  ¥{item['gold_cny_per_gram_1h_low']:>9,.2f}")
        print("=" * 62 + "\n")

        # ── Send to Telegram via NanoClaw IPC ──
        if SEND_TELEGRAM:
            self._send_telegram(item, source_str)

        return item

    def _send_telegram(self, item, source_str):
        """Drop a JSON message into NanoClaw's IPC directory for Telegram delivery."""
        hl_label = "1h" if "candles" in source_str.lower() else "Day"

        lines = [
            "🥇 *Gold Price Report*",
            "",
            f"💰 *¥{item['gold_cny_per_gram']:,.2f} /gram*",
            "",
            f"XAUUSD: ${item['xauusd_current']:,.2f} /oz",
        ]
        if item["xauusd_1h_high"]:
            lines.append(f"📈 {hl_label} High: ${item['xauusd_1h_high']:,.2f}  →  ¥{item['gold_cny_per_gram_1h_high']:,.2f}/g")
            lines.append(f"📉 {hl_label} Low:  ${item['xauusd_1h_low']:,.2f}  →  ¥{item['gold_cny_per_gram_1h_low']:,.2f}/g")
        lines.append(f"USD/CNY: {item['usd_cny']:.4f}")

        msg_text = "\n".join(lines)

        ipc_msg = {
            "type": "message",
            "chatJid": TELEGRAM_JID,
            "text": msg_text,
        }

        os.makedirs(IPC_DIR, exist_ok=True)
        filename = f"gold-{uuid.uuid4().hex[:8]}.json"
        filepath = os.path.join(IPC_DIR, filename)

        with open(filepath, "w") as f:
            json.dump(ipc_msg, f)

        print(f"📨 Telegram message queued: {filepath}")

    # ─── Generic error handler ─────────────────────────────────────

    def errback_handler(self, failure):
        self.logger.error(f"Request failed: {failure.value}")
        self._request_done()


# ─── Run ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    process = CrawlerProcess()
    process.crawl(GoldPriceSpider)
    process.start()
