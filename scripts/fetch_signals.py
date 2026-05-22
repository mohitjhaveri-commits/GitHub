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


def _fetch_india_10y_api() -> dict | None:
    from datetime import timedelta

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=14)
    url = INVESTING_API_URL.format(start=start.isoformat(), end=end.isoformat())
    headers = {
        **BROWSER_HEADERS,
        "Accept": "application/json, text/plain, */*",
        "Domain-Id": "www",
        "Referer": INVESTING_URL,
        "Origin": "https://www.investing.com",
    }
    try:
        status, body = _fetch_with_status(url, headers)
    except Exception as e:
        print(f"[investing api] network: {e}", file=sys.stderr)
        return None
    if status != 200:
        print(
            f"[investing api] HTTP {status}; first 200 chars: {body[:200]!r}",
            file=sys.stderr,
        )
        return None
    try:
        data = json.loads(body)
    except Exception as e:
        print(
            f"[investing api] not JSON: {e}; first 200 chars: {body[:200]!r}",
            file=sys.stderr,
        )
        return None
    rows = data.get("data") if isinstance(data, dict) else None
    if not rows:
        print(f"[investing api] no data rows: {str(data)[:200]!r}", file=sys.stderr)
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
        print(f"[investing api] parse: {e}; latest={latest}", file=sys.stderr)
        return None
    asof = latest.get("rowDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "value": value,
        "previous": previous,
        "asof": asof,
        "source": "investing.com (api)",
    }


def fetch_india_10y() -> dict | None:
    """Fetch India 10Y G-Sec yield from investing.com (HTML then API)."""
    for name, fn in (("html", _fetch_india_10y_html), ("api", _fetch_india_10y_api)):
        result = fn()
        if result and result.get("value") is not None:
            print(f"[india_10y] success via {name}: {result['value']}", file=sys.stderr)
            return result
    print("[india_10y] all investing.com attempts failed", file=sys.stderr)
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
