# Macro Signals Tracker

A static web dashboard that shows a daily snapshot of macro signals:
rates &amp; yields, equities &amp; volatility, FX &amp; commodities, crypto, and
an India Credit panel.

Data is fetched **server-side** by a Python script
(`scripts/fetch_signals.py`) running on a GitHub Actions cron every ~6
hours. Results are written to `data/signals.json` and committed to the
repo. The browser only reads `data/signals.json` (same-origin) — no
CORS, no API keys, no proxies.

Sources:

- [FRED](https://fred.stlouisfed.org) — US Treasury yields (DGS2/10/30)
- [Yahoo Finance](https://finance.yahoo.com) — indices, FX, commodities, India indices
- [Stooq](https://stooq.com) — India 10Y G-Sec yield
- [CoinGecko](https://www.coingecko.com) — crypto

## One-time setup

The workflow needs permission to commit `data/signals.json` back to the
repo. In repo Settings → Actions → General → **Workflow permissions**,
select **"Read and write permissions"** and Save.

Then trigger the first run: Actions tab → **Update signals** → **Run
workflow**. After it succeeds (~30s), `data/signals.json` is populated
and the dashboard will show data.

## Run locally

```sh
# Refresh data once
python3 scripts/fetch_signals.py

# Serve the site
python3 -m http.server 8000
# then open http://localhost:8000
```

## Customizing signals

- **Live signals** — edit the `SIGNALS` registry at the top of
  `scripts/fetch_signals.py` (FRED series, Yahoo ticker, or Stooq
  symbol) and the matching `VIEW` arrays in `app.js`.
- **India Credit manual signals** — edit `data/india-credit.json`.
  Each entry has `value`, `previous`, `asof`, and an optional
  `invertColor` for things like CDS spreads where higher = worse. Cards
  go yellow ("stale") after 45 days.

