# Macro Signals Tracker

A static web dashboard that shows a daily snapshot of macro signals:
rates &amp; yields, equities &amp; volatility, FX &amp; commodities, and crypto.

Data is fetched on demand in the browser from free public APIs:

- [Stooq](https://stooq.com) — indices, yields, FX, commodities (CSV)
- [CoinGecko](https://www.coingecko.com) — crypto prices

No build step, no API keys. Open `index.html` or serve the folder
statically.

## Run locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Signals

- **Rates**: US 2Y / 10Y / 30Y Treasury yields, 10Y–2Y spread
- **Equities**: S&amp;P 500, Nasdaq 100, Dow Jones, VIX
- **FX &amp; commodities**: DXY, EUR/USD, USD/JPY, gold, WTI, Brent
- **Crypto**: BTC, ETH, SOL

Each card shows the latest price and the 1-day change. Click **Refresh**
to re-fetch.

## Customizing signals

Edit `SIGNALS` in `app.js`. For Stooq-backed signals, set `symbol` to the
[Stooq ticker](https://stooq.com). For crypto, set `coingecko` to the
CoinGecko ID.

## Notes

Quotes from Stooq may be delayed (typically 15+ minutes for US markets,
end-of-day for some series). Not investment advice.
