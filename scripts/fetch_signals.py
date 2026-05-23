#!/usr/bin/env python3
"""Fetch macro signals server-side and write data/signals.json.

Runs from GitHub Actions on a cron schedule (or manually). No API keys
required. Sources:
  - FRED (CSV)        : US Treasury yields (DGS2, DGS10, DGS30)
  - Yahoo Finance     : equities, FX, commodities, Indian indices, India VIX
  - Stooq             : India 10Y G-Sec yield (only realistic free source)
  - CoinGecko (JSON)  : crypto

Each signal in the output JSON has: value, previous, asof, source.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

UA = "Mozilla/5.0 (compatible; macro-signals-tracker/1.0)"


def http_get(url: str, timeout: int = 20, accept: str = "*/*") -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": accept}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def http_get_json(url: str, timeout: int = 20) -> dict:
    return json.loads(http_get(url, timeout=timeout, accept="application/json"))


# -------- FRED (CSV, public, no key) --------

def fetch_fred(series: str) -> dict | None:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
    try:
        text = http_get(url)
    except Exception as e:
        print(f"[fred {series}] {e}", file=sys.stderr)
        return None
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if len(rows) < 2:
        return None
    points: list[tuple[str, float]] = []
    for row in rows[1:]:
        if len(row) < 2:
            continue
        date, val = row[0], row[1]
        if not val or val == ".":
            continue
        try:
            points.append((date, float(val)))
        except ValueError:
            continue
    if not points:
        return None
    return {
        "value": points[-1][1],
        "previous": points[-2][1] if len(points) >= 2 else None,
        "asof": points[-1][0],
        "source": f"FRED ({series})",
    }


# -------- Yahoo Finance v8 chart API --------

def fetch_yahoo_history(symbol: str, range_: str = "60d") -> list[tuple[int, float]] | None:
    """Return list of (timestamp, close) for the given range, oldest first."""
    qs = urllib.parse.urlencode({"range": range_, "interval": "1d"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{qs}"
    try:
        data = http_get_json(url)
    except Exception as e:
        print(f"[yahoo-hist {symbol}] {e}", file=sys.stderr)
        return None
    try:
        result = data["chart"]["result"][0]
        closes = result["indicators"]["quote"][0]["close"]
        timestamps = result["timestamp"]
    except (KeyError, IndexError, TypeError) as e:
        print(f"[yahoo-hist {symbol}] bad payload: {e}", file=sys.stderr)
        return None
    return [(t, float(c)) for t, c in zip(timestamps, closes) if c is not None]


def fetch_yahoo(symbol: str) -> dict | None:
    qs = urllib.parse.urlencode({"range": "10d", "interval": "1d"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{qs}"
    try:
        data = http_get_json(url)
    except Exception as e:
        print(f"[yahoo {symbol}] {e}", file=sys.stderr)
        return None
    try:
        result = data["chart"]["result"][0]
        closes = result["indicators"]["quote"][0]["close"]
        timestamps = result["timestamp"]
    except (KeyError, IndexError, TypeError) as e:
        print(f"[yahoo {symbol}] bad payload: {e}", file=sys.stderr)
        return None
    valid = [(t, c) for t, c in zip(timestamps, closes) if c is not None]
    if not valid:
        return None
    asof = datetime.fromtimestamp(valid[-1][0], tz=timezone.utc).strftime("%Y-%m-%d")
    return {
        "value": float(valid[-1][1]),
        "previous": float(valid[-2][1]) if len(valid) >= 2 else None,
        "asof": asof,
        "source": f"Yahoo ({symbol})",
    }


# -------- Stooq CSV (server-side - no CORS issue) --------

def fetch_stooq(symbol: str) -> dict | None:
    url = (
        f"https://stooq.com/q/l/?s={urllib.parse.quote(symbol)}"
        "&f=sd2t2ohlcv&h&e=csv"
    )
    try:
        text = http_get(url)
    except Exception as e:
        print(f"[stooq {symbol}] {e}", file=sys.stderr)
        return None
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        print(f"[stooq {symbol}] empty/short body: {text!r}", file=sys.stderr)
        return None
    row = rows[1]
    # cols: Symbol,Date,Time,Open,High,Low,Close,Volume
    if len(row) < 7 or row[6] in ("", "N/D"):
        print(f"[stooq {symbol}] no close: row={row}", file=sys.stderr)
        return None
    try:
        close = float(row[6])
        open_ = float(row[3]) if row[3] not in ("", "N/D") else None
    except ValueError:
        return None
    asof = row[1] if row[1] not in ("", "N/D") else None
    return {
        "value": close,
        "previous": open_,
        "asof": asof,
        "source": f"Stooq ({symbol})",
    }


# India 10Y G-Sec: investing.com. Cloudflare-protected, so we try two
# endpoints in turn:
#   1. The HTML page, parsing __NEXT_DATA__ or DOM attributes.
#   2. The historical-data JSON API (pair id 23867 is India 10Y G-Sec).
# Both attempts log HTTP status and a snippet of the response on failure.

INVESTING_URL = "https://www.investing.com/rates-bonds/india-10-year-bond-yield"
INVESTING_API_URL = (
    "https://api.investing.com/api/financialdata/historical/23867"
    "?start-date={start}&end-date={end}&time-frame=Daily&add-missing-rows=false"
)
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _fetch_with_status(url: str, headers: dict, timeout: int = 30):
    """Returns (status_code, body_text) or raises."""
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, body


def _fetch_india_10y_html() -> dict | None:
    try:
        status, html = _fetch_with_status(INVESTING_URL, BROWSER_HEADERS)
    except Exception as e:
        print(f"[investing html] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(
            f"[investing html] HTTP {status}; first 200 chars: {html[:200]!r}",
            file=sys.stderr,
        )
        return None
    if "Just a moment" in html or "cf-chl" in html or "Attention Required" in html:
        print("[investing html] Cloudflare interstitial", file=sys.stderr)
        return None

    value: float | None = None
    previous: float | None = None
    asof: str | None = None

    m = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    if m:
        blob = m.group(1)
        m_last = re.search(r'"last(?:Price)?"\s*:\s*"?([\d,]+\.\d+)"?', blob)
        if m_last:
            try:
                value = float(m_last.group(1).replace(",", ""))
            except ValueError:
                pass
        m_prev = re.search(
            r'"(?:prevClose(?:Price)?|previousClose)"\s*:\s*"?([\d,]+\.\d+)"?',
            blob,
        )
        if m_prev:
            try:
                previous = float(m_prev.group(1).replace(",", ""))
            except ValueError:
                pass

    if value is None:
        m_v = re.search(
            r'data-test="instrument-price-last"[^>]*>\s*([\d,]+\.?\d*)\s*<',
            html,
        )
        if m_v:
            try:
                value = float(m_v.group(1).replace(",", ""))
            except ValueError:
                pass

    if value is None:
        print(
            f"[investing html] could not extract; html length={len(html)}; "
            f"first 300 chars: {html[:300]!r}",
            file=sys.stderr,
        )
        return None

    return {
        "value": value,
        "previous": previous,
        "asof": asof or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "investing.com (html)",
    }


INVESTING_API_HEADERS = {
    **BROWSER_HEADERS,
    "Accept": "application/json, text/plain, */*",
    "Domain-Id": "www",
    "Referer": INVESTING_URL,
    "Origin": "https://www.investing.com",
}

# Candidate pair IDs for India 10Y G-Sec on investing.com. The first
# that returns data wins. 23867 was tried in the previous version and
# returned empty - keeping it last so we cycle through the others first.
INDIA_10Y_PAIR_IDS = [1056564, 1056565, 23866, 23867, 941706]


def _resolve_india_10y_pair_id() -> int | None:
    """Try investing.com's search API to discover the correct pair id."""
    url = "https://api.investing.com/api/financialdata/search?query=india+10+year+bond"
    headers = {**INVESTING_API_HEADERS}
    try:
        status, body = _fetch_with_status(url, headers, timeout=20)
    except Exception as e:
        print(f"[investing search] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(
            f"[investing search] HTTP {status}; first 200 chars: {body[:200]!r}",
            file=sys.stderr,
        )
        return None
    try:
        data = json.loads(body)
    except Exception as e:
        print(f"[investing search] not JSON: {e}", file=sys.stderr)
        return None
    # The response shape varies; try a few likely paths.
    candidates: list[dict] = []
    if isinstance(data, dict):
        for key in ("data", "quotes", "results"):
            v = data.get(key)
            if isinstance(v, list):
                candidates.extend(v)
            elif isinstance(v, dict):
                for sub in v.values():
                    if isinstance(sub, list):
                        candidates.extend(sub)
    print(f"[investing search] {len(candidates)} candidates", file=sys.stderr)
    for c in candidates:
        name = (c.get("name") or c.get("description") or "").lower()
        if "india" in name and "10" in name and ("bond" in name or "yield" in name):
            for k in ("pair_ID", "pairId", "pair_id", "id"):
                if k in c:
                    pid = c[k]
                    try:
                        pid_i = int(pid)
                        print(f"[investing search] matched '{name}' -> pair_id {pid_i}", file=sys.stderr)
                        return pid_i
                    except (TypeError, ValueError):
                        continue
    return None


def _try_pair_id(pair_id: int) -> dict | None:
    from datetime import timedelta

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=14)
    url = (
        "https://api.investing.com/api/financialdata/historical/"
        f"{pair_id}?start-date={start.isoformat()}&end-date={end.isoformat()}"
        "&time-frame=Daily&add-missing-rows=false"
    )
    try:
        status, body = _fetch_with_status(url, INVESTING_API_HEADERS)
    except Exception as e:
        print(f"[investing api {pair_id}] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(
            f"[investing api {pair_id}] HTTP {status}; first 200 chars: {body[:200]!r}",
            file=sys.stderr,
        )
        return None
    try:
        data = json.loads(body)
    except Exception as e:
        print(f"[investing api {pair_id}] not JSON: {e}", file=sys.stderr)
        return None
    rows = data.get("data") if isinstance(data, dict) else None
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r.get("rowDateRaw", 0), reverse=True)
    latest = rows[0]
    prev = rows[1] if len(rows) > 1 else None
    try:
        value = float(latest.get("last_close") or latest.get("price"))
        previous = (
            float(prev.get("last_close") or prev.get("price")) if prev else None
        )
    except (TypeError, ValueError) as e:
        print(f"[investing api {pair_id}] parse: {e}; latest={latest}", file=sys.stderr)
        return None
    asof = latest.get("rowDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "value": value,
        "previous": previous,
        "asof": asof,
        "source": f"investing.com (api pair {pair_id})",
    }


def _fetch_india_10y_api() -> dict | None:
    # Step 1: try search to resolve the right pair id.
    resolved = _resolve_india_10y_pair_id()
    candidates: list[int] = []
    if resolved is not None:
        candidates.append(resolved)
    for pid in INDIA_10Y_PAIR_IDS:
        if pid not in candidates:
            candidates.append(pid)

    # Step 2: try each candidate.
    for pid in candidates:
        result = _try_pair_id(pid)
        if result:
            return result
        print(f"[investing api {pid}] empty data", file=sys.stderr)
    return None


def _fetch_india_10y_wgb() -> dict | None:
    """Scrape worldgovernmentbonds.com - more targeted regex than before."""
    url = "http://www.worldgovernmentbonds.com/country/india/"
    try:
        status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
    except Exception as e:
        print(f"[wgb india10y] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(f"[wgb india10y] HTTP {status}", file=sys.stderr)
        return None
    # The page has a row whose link text is exactly "India 10 Years" followed
    # by table cells with yield, change, change%. Target it precisely.
    m = re.search(
        r'India\s+10\s*Years.*?<td[^>]*>\s*<[^>]*>\s*([\d.]+)\s*%',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        # Alternative: same row but without nested tag
        m = re.search(
            r'India\s+10\s*Years[^<]*</a>\s*</td>\s*<td[^>]*>\s*([\d.]+)\s*%',
            html,
            re.IGNORECASE | re.DOTALL,
        )
    if not m:
        print("[wgb india10y] could not extract yield", file=sys.stderr)
        return None
    try:
        val = float(m.group(1))
    except ValueError:
        return None
    # Sanity: India 10Y is realistically 4-10% in modern times.
    if not (3.0 <= val <= 12.0):
        print(f"[wgb india10y] value {val} outside sanity range; skipping", file=sys.stderr)
        return None
    return {
        "value": val,
        "previous": None,
        "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "worldgovernmentbonds.com",
    }


# -------- Derived from Yahoo history --------

def fetch_pct_change(symbol: str, lookback_trading_days: int) -> dict | None:
    """Return the % change in `symbol`'s close over `lookback_trading_days`
    trading days, expressed as a yield-style number (e.g. 1.23 means +1.23%)."""
    hist = fetch_yahoo_history(symbol, range_="120d")
    if not hist or len(hist) < lookback_trading_days + 1:
        print(
            f"[pct-change {symbol}] insufficient history "
            f"({len(hist) if hist else 0} pts, need {lookback_trading_days + 1})",
            file=sys.stderr,
        )
        return None
    latest_t, latest = hist[-1]
    _, past = hist[-1 - lookback_trading_days]
    if past == 0:
        return None
    pct = (latest - past) / past * 100
    # previous = pct change for the prior window (shifted by one day) so
    # the dashboard's change indicator means "did the % change get
    # bigger or smaller compared to yesterday's same-window % change".
    prev_pct = None
    if len(hist) >= lookback_trading_days + 2:
        _, prev_latest = hist[-2]
        _, prev_past = hist[-2 - lookback_trading_days]
        if prev_past:
            prev_pct = (prev_latest - prev_past) / prev_past * 100
    return {
        "value": pct,
        "previous": prev_pct,
        "asof": datetime.fromtimestamp(latest_t, tz=timezone.utc).strftime("%Y-%m-%d"),
        "source": f"Yahoo ({symbol}, {lookback_trading_days}d % change)",
    }


# -------- India 5Y CDS via worldgovernmentbonds.com --------

def fetch_india_5y_cds() -> dict | None:
    url = "http://www.worldgovernmentbonds.com/cds-historical-data/india/5-years/"
    try:
        status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
    except Exception as e:
        print(f"[wgb cds india] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(f"[wgb cds india] HTTP {status}", file=sys.stderr)
        return None
    # The "Current 5Y CDS Value" is highlighted on the page as a number in bps.
    m = re.search(
        r'5\s*Years.*?(\d{1,4}(?:\.\d+)?)\s*(?:bps|basis points)',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        # Less specific fallback: number followed by " bps" anywhere near "India".
        m = re.search(r'India.*?(\d{1,4}(?:\.\d+)?)\s*bps', html, re.IGNORECASE | re.DOTALL)
    if not m:
        print("[wgb cds india] no match", file=sys.stderr)
        return None
    try:
        val = float(m.group(1))
    except ValueError:
        return None
    if not (20.0 <= val <= 2000.0):
        print(f"[wgb cds india] implausible value {val}, skipping", file=sys.stderr)
        return None
    return {
        "value": val,
        "previous": None,
        "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "worldgovernmentbonds.com (5Y CDS)",
    }


# -------- NHB refinance rate --------

def fetch_nhb_refinance() -> dict | None:
    url = "https://nhb.org.in/refinance-scheme/"
    try:
        status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
    except Exception as e:
        print(f"[nhb refi] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(f"[nhb refi] HTTP {status}", file=sys.stderr)
        return None
    # NHB rates page typically lists something like "Refinance Rate: X.XX%".
    patterns = [
        r"refinance\s+rate[^%\d]{0,40}?(\d+\.\d+)\s*%",
        r"current\s+rate[^%\d]{0,40}?(\d+\.\d+)\s*%",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            try:
                val = float(m.group(1))
            except ValueError:
                continue
            if 2.0 <= val <= 15.0:
                return {
                    "value": val,
                    "previous": None,
                    "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "source": "nhb.org.in",
                }
    print("[nhb refi] no match", file=sys.stderr)
    return None


# -------- Credit leading indicators (best-effort scrapes) --------

def fetch_sbi_mclr_1y() -> dict | None:
    """Scrape SBI 1-Year MCLR from sbi.co.in."""
    url = "https://sbi.co.in/web/interest-rates/interest-rates/mclr"
    try:
        status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
    except Exception as e:
        print(f"[sbi mclr] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(f"[sbi mclr] HTTP {status}", file=sys.stderr)
        return None
    # The MCLR table on SBI's page has rows like:
    #   <td>One Year</td> <td>8.95%</td>
    patterns = [
        r"One\s*Year[^<]*</td[^>]*>\s*<td[^>]*>\s*([\d.]+)\s*%?",
        r"1\s*Year[^<]*</td[^>]*>\s*<td[^>]*>\s*([\d.]+)\s*%?",
        r"1\s*Yr[^<]*</td[^>]*>\s*<td[^>]*>\s*([\d.]+)",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            try:
                val = float(m.group(1))
                if 6.0 <= val <= 14.0:
                    return {
                        "value": val,
                        "previous": None,
                        "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                        "source": "sbi.co.in (MCLR page)",
                    }
            except ValueError:
                continue
    print("[sbi mclr] no plausible 1Y match", file=sys.stderr)
    return None


def fetch_fbil_corporate_yield(rating: str = "AAA", tenor: str = "5") -> dict | None:
    """Best-effort scrape of FBIL corporate bond benchmark yield."""
    # FBIL publishes daily corporate bond curves; the public page lists
    # benchmark rates in a table.
    url = "https://www.fbil.org.in/#/home"
    try:
        status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
    except Exception as e:
        print(f"[fbil {rating} {tenor}y] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(f"[fbil {rating} {tenor}y] HTTP {status}", file=sys.stderr)
        return None
    # FBIL is a SPA, the homepage HTML usually has very little data
    # embedded. Mark as unsupported until a stable JSON endpoint is
    # discovered.
    print(
        f"[fbil {rating} {tenor}y] page is SPA-rendered; no stable data endpoint found",
        file=sys.stderr,
    )
    return None


def fetch_aa_aaa_spread() -> dict | None:
    aaa = fetch_fbil_corporate_yield("AAA", "5")
    aa = fetch_fbil_corporate_yield("AA", "5")
    if not aaa or not aa:
        return None
    return {
        "value": (aa["value"] - aaa["value"]) * 100,  # to bps
        "previous": None,
        "asof": aaa["asof"],
        "source": "derived (FBIL AA5y - AAA5y)",
    }


def fetch_rbi_3m_tbill() -> dict | None:
    """Best-effort: scrape latest RBI 91-day T-Bill auction cut-off."""
    # RBI publishes auction results as press releases; URL changes per
    # release so there's no stable scrape target without an index page
    # crawl. Mark as unsupported for now.
    print("[rbi 3m tbill] no stable scrape target available", file=sys.stderr)
    return None


def _extract_india_10y_from_html(html: str, source_label: str) -> dict | None:
    """Generic India 10Y G-Sec yield extractor:
      1. Anchor on the text 'India 10 Year' (or '10 Year G-Sec'), then
         take the FIRST 5.0-9.0 number that appears within ~500 chars
         after the anchor.
      2. Fall back to a list of common quote-page price patterns.
      3. Debug-dump the first few plausible 5-9% numbers found anywhere
         on the page so we can iterate if no match.
    """
    # 1. Anchored search
    anchors = [
        r"India\s*10\s*[-\s]*Year",
        r"10\s*Year\s*G\s*-\s*Sec",
        r"10\s*Yr\s*G\s*Sec",
        r"India\s*10Y",
    ]
    for anchor_pat in anchors:
        for m in re.finditer(anchor_pat, html, re.IGNORECASE):
            window = html[m.end() : m.end() + 1000]
            nm = re.search(r"\b([5-8]\.\d{2,4})\b", window)
            if nm:
                try:
                    val = float(nm.group(1))
                except ValueError:
                    continue
                if 5.0 <= val <= 9.0:
                    return {
                        "value": val,
                        "previous": None,
                        "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                        "source": source_label,
                    }

    # 2. Pattern fallback
    patterns = [
        r'class="inprice1[^"]*"[^>]*>\s*([\d,]+\.\d+)',
        r'id="b_(?:bse|nse)_quote"[^>]*>\s*([\d,]+\.\d+)',
        r'"last_price"\s*:\s*"?([\d,]+\.\d+)"?',
        r'"lastTradedPrice"\s*:\s*"?([\d,]+\.\d+)"?',
        r'data-(?:last|price)[^=]*="([\d,]+\.\d+)"',
    ]
    for pat in patterns:
        for m in re.finditer(pat, html, re.IGNORECASE):
            try:
                val = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if 5.0 <= val <= 9.0:
                return {
                    "value": val,
                    "previous": None,
                    "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "source": source_label,
                }

    # 3. Debug dump - shows what plausible numbers exist near "India 10"
    debug_hits: list[str] = []
    for anchor_pat in anchors:
        for m in re.finditer(anchor_pat, html, re.IGNORECASE):
            window = html[max(0, m.start() - 80) : m.end() + 300]
            nums = re.findall(r"\b\d+\.\d+\b", window)
            if nums:
                debug_hits.append(f"near '{m.group(0)}': {nums[:8]}")
        if debug_hits:
            break
    if debug_hits:
        print(
            f"[{source_label}] no anchored 5-9% match; debug hits: {debug_hits[:5]}",
            file=sys.stderr,
        )
    else:
        all_plausible = re.findall(r"\b([5-8]\.\d{2,4})\b", html)
        print(
            f"[{source_label}] no 'India 10 Year' anchor found; first 8 plausible "
            f"5-8.x numbers on page: {all_plausible[:8]}",
            file=sys.stderr,
        )
    return None


def _fetch_india_10y_moneycontrol() -> dict | None:
    urls = [
        "https://www.moneycontrol.com/indian-indices/india-10-year-bond-yield-87.html",
        "https://www.moneycontrol.com/markets/bond-yields/",
        "https://www.moneycontrol.com/news/business/markets/bond-yields-india",
        "https://www.moneycontrol.com/markets/global-indices/",
    ]
    for url in urls:
        try:
            status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
        except Exception as e:
            print(f"[moneycontrol {url}] network: {e}", file=sys.stderr)
            continue
        if status != 200:
            print(f"[moneycontrol {url}] HTTP {status}", file=sys.stderr)
            continue
        label = f"moneycontrol {url.rsplit('/', 1)[-1] or 'home'}"
        result = _extract_india_10y_from_html(html, label)
        if result:
            return result
    return None


def _fetch_india_10y_et() -> dict | None:
    url = "https://economictimes.indiatimes.com/markets/bonds"
    try:
        status, html = _fetch_with_status(url, BROWSER_HEADERS, timeout=20)
    except Exception as e:
        print(f"[et india10y] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(f"[et india10y] HTTP {status}", file=sys.stderr)
        return None

    # ET's /markets/bonds page lists multiple tenors up front (5Y,
    # 10Y, 14Y / 30Y) plus the RBI bank rate (8.25). The India 10Y
    # G-Sec is the MEDIAN of the distinct plausible 6.0-7.5% values:
    # the lowest is the short end (e.g. 5Y at ~6.48), the highest is
    # the long end (~7.09), and the middle one (~7.06) is the 10Y
    # benchmark.
    nums = re.findall(r"\b(\d+\.\d{2,4})\b", html[:200000])
    plausible: list[float] = []
    for n in nums:
        try:
            v = float(n)
        except ValueError:
            continue
        if 6.0 <= v <= 7.5:
            plausible.append(v)
        if len(plausible) >= 20:
            break

    if plausible:
        distinct = sorted(set(plausible))
        median = distinct[len(distinct) // 2] if len(distinct) >= 2 else distinct[0]
        if 6.0 <= median <= 7.5:
            print(
                f"[et india10y] distinct plausibles {distinct} -> median {median}",
                file=sys.stderr,
            )
            return {
                "value": median,
                "previous": None,
                "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "source": "economictimes.indiatimes.com (median plausible)",
            }

    return _extract_india_10y_from_html(html, "economictimes.indiatimes.com")


def fetch_india_10y() -> dict | None:
    """Fetch India 10Y G-Sec yield. moneycontrol first (per user
    preference), then Indian-news fallbacks. investing.com is omitted
    because its public pair-id 941706 is not the G-Sec benchmark and the
    main HTML page is Cloudflare-blocked."""
    for name, fn in (
        ("moneycontrol", _fetch_india_10y_moneycontrol),
        ("economic-times", _fetch_india_10y_et),
        ("wgb", _fetch_india_10y_wgb),
    ):
        result = fn()
        if result and result.get("value") is not None:
            v = result["value"]
            if 5.0 <= v <= 9.0:
                print(f"[india_10y] success via {name}: {v}", file=sys.stderr)
                return result
            print(
                f"[india_10y] {name} returned implausible value {v}; skipping",
                file=sys.stderr,
            )
    print("[india_10y] all sources failed", file=sys.stderr)
    return None


# -------- CoinGecko --------

def fetch_crypto() -> dict:
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
    )
    out: dict[str, dict | None] = {"btc": None, "eth": None, "sol": None}
    mapping = {"btc": "bitcoin", "eth": "ethereum", "sol": "solana"}
    try:
        data = http_get_json(url)
    except Exception as e:
        print(f"[coingecko] {e}", file=sys.stderr)
        return out
    asof = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for key, cg_id in mapping.items():
        entry = data.get(cg_id)
        if not entry or "usd" not in entry:
            continue
        close = float(entry["usd"])
        pct = float(entry.get("usd_24h_change") or 0.0)
        prev = close / (1 + pct / 100) if pct != -100 else None
        out[key] = {
            "value": close,
            "previous": prev,
            "asof": asof,
            "source": f"CoinGecko ({cg_id})",
        }
    return out


# -------- Signal registry --------

# Each entry maps a stable signal key -> fetcher spec.
# The browser reads these keys from data/signals.json.
SIGNALS: dict[str, tuple[str, str]] = {
    # Rates
    "us2y":  ("fred",   "DGS2"),
    "us10y": ("fred",   "DGS10"),
    "us30y": ("fred",   "DGS30"),
    # Equities
    "sp500":     ("yahoo", "^GSPC"),
    "nasdaq100": ("yahoo", "^NDX"),
    "dow":       ("yahoo", "^DJI"),
    "vix":       ("yahoo", "^VIX"),
    # FX & commodities
    "dxy":    ("yahoo", "DX-Y.NYB"),
    "eurusd": ("yahoo", "EURUSD=X"),
    "usdjpy": ("yahoo", "USDJPY=X"),
    "usdinr": ("yahoo", "USDINR=X"),
    "xauusd": ("yahoo", "GC=F"),
    "wti":    ("yahoo", "CL=F"),
    "brent":  ("yahoo", "BZ=F"),
    # India
    "nifty":    ("yahoo", "^NSEI"),
    "indiavix": ("yahoo", "^INDIAVIX"),
    "in10y":    ("india10y", ""),
    # Newly-automated India Credit signals
    "us_ig_oas":      ("fred",        "BAMLC0A0CM"),
    "gold_30d_pct":   ("pct_change",  "GC=F:30"),
    "nifty_wk_pct":   ("pct_change",  "^NSEI:5"),
    "india_5y_cds":   ("india5ycds",  ""),
    "nhb_refi_rate":  ("nhb",         ""),
    # Credit Leading Indicators (best-effort)
    "sbi_1y_mclr":            ("sbi_mclr",      ""),
    "aaa_5y_corp_bond_yield": ("fbil_corp",     "AAA:5"),
    "aa_aaa_spread":          ("aa_aaa_spread", ""),
    "tbill_3m_yield":         ("rbi_3m_tbill",  ""),
}


def fetch_one(kind: str, target: str) -> dict | None:
    if kind == "fred":
        return fetch_fred(target)
    if kind == "yahoo":
        return fetch_yahoo(target)
    if kind == "stooq":
        return fetch_stooq(target)
    if kind == "india10y":
        return fetch_india_10y()
    if kind == "india5ycds":
        return fetch_india_5y_cds()
    if kind == "nhb":
        return fetch_nhb_refinance()
    if kind == "pct_change":
        # target is "SYMBOL:N" where N is trading days
        sym, n = target.rsplit(":", 1)
        return fetch_pct_change(sym, int(n))
    if kind == "sbi_mclr":
        return fetch_sbi_mclr_1y()
    if kind == "fbil_corp":
        rating, tenor = target.split(":")
        return fetch_fbil_corporate_yield(rating, tenor)
    if kind == "aa_aaa_spread":
        return fetch_aa_aaa_spread()
    if kind == "rbi_3m_tbill":
        return fetch_rbi_3m_tbill()
    return None


def compute_derived(signals: dict[str, dict | None]) -> None:
    """Add derived signals (spreads, conversions)."""
    # US 10Y - 2Y spread
    us10 = signals.get("us10y")
    us2 = signals.get("us2y")
    if us10 and us2 and us10["value"] is not None and us2["value"] is not None:
        spread = us10["value"] - us2["value"]
        prev = None
        if us10.get("previous") is not None and us2.get("previous") is not None:
            prev = us10["previous"] - us2["previous"]
        signals["us10y_2y_spread"] = {
            "value": spread,
            "previous": prev,
            "asof": us10.get("asof"),
            "source": "derived (us10y - us2y)",
        }

    # India - US 10Y spread (percentage points)
    in10 = signals.get("in10y")
    if in10 and us10 and in10["value"] is not None and us10["value"] is not None:
        spread = in10["value"] - us10["value"]
        prev = None
        if in10.get("previous") is not None and us10.get("previous") is not None:
            prev = in10["previous"] - us10["previous"]
        signals["ind_us_10y_spread"] = {
            "value": spread,
            "previous": prev,
            "asof": in10.get("asof"),
            "source": "derived (in10y - us10y)",
        }

    # MCX Gold (INR per 10g) approx = XAUUSD * USDINR * 10 / 31.1035
    gold = signals.get("xauusd")
    inr = signals.get("usdinr")
    if gold and inr and gold["value"] is not None and inr["value"] is not None:
        k = 10.0 / 31.1035
        val = gold["value"] * inr["value"] * k
        prev = None
        if gold.get("previous") is not None and inr.get("previous") is not None:
            prev = gold["previous"] * inr["previous"] * k
        signals["mcx_gold_inr_10g"] = {
            "value": val,
            "previous": prev,
            "asof": gold.get("asof") or inr.get("asof"),
            "source": "derived (XAUUSD * USDINR)",
        }


def main() -> int:
    out: dict[str, dict | None] = {}
    for key, (kind, target) in SIGNALS.items():
        out[key] = fetch_one(kind, target)
        # Be polite - throttle a bit between requests.
        time.sleep(0.2)

    crypto = fetch_crypto()
    out.update(crypto)

    compute_derived(out)

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signals": out,
    }
    out_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "data", "signals.json"
    )
    out_path = os.path.normpath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")

    successes = sum(1 for v in out.values() if v is not None)
    print(f"Wrote {out_path} ({successes}/{len(out)} signals populated)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
