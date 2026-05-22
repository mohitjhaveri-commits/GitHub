// Macro Signals Tracker - on-demand fetch from free public APIs.
//
// Sources:
//   - Stooq (CSV, CORS-enabled) for indices, yields, FX, commodities
//   - CoinGecko for crypto
//
// Each signal renders a card with the latest price and 1-day change.

const SIGNALS = {
  rates: [
    { label: "US 10Y Yield", symbol: "10usy.b", suffix: "%" },
    { label: "US 2Y Yield", symbol: "2usy.b", suffix: "%" },
    { label: "US 30Y Yield", symbol: "30usy.b", suffix: "%" },
    { label: "10Y - 2Y Spread", derived: "spread", a: "10usy.b", b: "2usy.b", suffix: "%" },
  ],
  equities: [
    { label: "S&P 500", symbol: "^spx" },
    { label: "Nasdaq 100", symbol: "^ndx" },
    { label: "Dow Jones", symbol: "^dji" },
    { label: "VIX", symbol: "^vix" },
  ],
  fxcomm: [
    { label: "DXY (Dollar Index)", symbol: "^dxy" },
    { label: "EUR / USD", symbol: "eurusd" },
    { label: "USD / JPY", symbol: "usdjpy" },
    { label: "Gold (XAU/USD)", symbol: "xauusd", prefix: "$" },
    { label: "WTI Crude Oil", symbol: "cl.f", prefix: "$" },
    { label: "Brent Crude", symbol: "cb.f", prefix: "$" },
  ],
  crypto: [
    { label: "Bitcoin", coingecko: "bitcoin", prefix: "$" },
    { label: "Ethereum", coingecko: "ethereum", prefix: "$" },
    { label: "Solana", coingecko: "solana", prefix: "$" },
  ],
};

function fmtNumber(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  let digits = 2;
  if (abs < 1) digits = 4;
  else if (abs >= 1000) digits = 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    ...opts,
  });
}

function fmtChange(absChange, pctChange) {
  if (absChange === null || pctChange === null) return { text: "—", cls: "flat" };
  const cls = absChange > 0 ? "up" : absChange < 0 ? "down" : "flat";
  const arrow = absChange > 0 ? "▲" : absChange < 0 ? "▼" : "■";
  const sign = absChange > 0 ? "+" : "";
  return {
    text: `${arrow} ${sign}${fmtNumber(absChange)} (${sign}${pctChange.toFixed(2)}%)`,
    cls,
  };
}

function cardEl(label) {
  const el = document.createElement("div");
  el.className = "card loading";
  el.innerHTML = `
    <div class="label"></div>
    <div class="value">…</div>
    <div class="change">&nbsp;</div>
  `;
  el.querySelector(".label").textContent = label;
  return el;
}

function renderCard(el, { value, absChange, pctChange, prefix = "", suffix = "" }) {
  el.classList.remove("loading", "error");
  el.querySelector(".value").textContent =
    value === null ? "—" : `${prefix}${fmtNumber(value)}${suffix}`;
  const ch = fmtChange(absChange, pctChange);
  const changeEl = el.querySelector(".change");
  changeEl.textContent = ch.text;
  changeEl.className = `change ${ch.cls}`;
}

function renderError(el, msg) {
  el.classList.remove("loading");
  el.classList.add("error");
  el.querySelector(".value").textContent = msg || "Unavailable";
  el.querySelector(".change").textContent = "";
}

async function fetchStooq(symbol) {
  // Returns { close, open } or throws.
  // Stooq CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("Empty response");
  const cols = lines[1].split(",");
  const open = parseFloat(cols[3]);
  const close = parseFloat(cols[6]);
  if (Number.isNaN(close)) throw new Error("No data");
  return { open: Number.isNaN(open) ? null : open, close };
}

async function loadStooqSignal(el, sig) {
  try {
    const { open, close } = await fetchStooq(sig.symbol);
    let absChange = null;
    let pctChange = null;
    if (open !== null && open !== 0) {
      absChange = close - open;
      pctChange = (absChange / open) * 100;
    }
    renderCard(el, {
      value: close,
      absChange,
      pctChange,
      prefix: sig.prefix || "",
      suffix: sig.suffix || "",
    });
    return { close, open };
  } catch (err) {
    renderError(el, "Unavailable");
    return null;
  }
}

async function loadSpread(el, sig, cache) {
  try {
    const a = cache[sig.a] || (await fetchStooq(sig.a));
    const b = cache[sig.b] || (await fetchStooq(sig.b));
    const spreadClose = a.close - b.close;
    const spreadOpen =
      a.open !== null && b.open !== null ? a.open - b.open : null;
    let absChange = null;
    let pctChange = null;
    if (spreadOpen !== null) {
      absChange = spreadClose - spreadOpen;
      pctChange = spreadOpen !== 0 ? (absChange / Math.abs(spreadOpen)) * 100 : 0;
    }
    renderCard(el, {
      value: spreadClose,
      absChange,
      pctChange,
      suffix: sig.suffix || "",
    });
  } catch (err) {
    renderError(el, "Unavailable");
  }
}

async function loadCrypto(cards) {
  const ids = cards.map(({ sig }) => sig.coingecko).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const { el, sig } of cards) {
      const entry = data[sig.coingecko];
      if (!entry || entry.usd === undefined) {
        renderError(el, "Unavailable");
        continue;
      }
      const close = entry.usd;
      const pctChange = entry.usd_24h_change ?? 0;
      const absChange = close - close / (1 + pctChange / 100);
      renderCard(el, {
        value: close,
        absChange,
        pctChange,
        prefix: sig.prefix || "",
      });
    }
  } catch (err) {
    for (const { el } of cards) renderError(el, "Unavailable");
  }
}

function setUpdated() {
  const now = new Date();
  const fmt = now.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  document.getElementById("updated").textContent = `Updated ${fmt}`;
}

async function loadAll() {
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  document.getElementById("updated").textContent = "Loading…";

  // Wipe and rebuild each group.
  const groups = {};
  for (const key of Object.keys(SIGNALS)) {
    const grid = document.querySelector(`.group[data-group="${key}"] .grid`);
    grid.innerHTML = "";
    groups[key] = grid;
  }

  // Build cards up front so layout is stable.
  const built = {};
  for (const [key, sigs] of Object.entries(SIGNALS)) {
    built[key] = sigs.map((sig) => {
      const el = cardEl(sig.label);
      groups[key].appendChild(el);
      return { el, sig };
    });
  }

  // Stooq-based groups: rates, equities, fxcomm.
  const stooqCache = {};
  const stooqTasks = [];
  const spreadTasks = [];
  for (const key of ["rates", "equities", "fxcomm"]) {
    for (const { el, sig } of built[key]) {
      if (sig.derived === "spread") {
        spreadTasks.push({ el, sig });
        continue;
      }
      stooqTasks.push(
        loadStooqSignal(el, sig).then((res) => {
          if (res) stooqCache[sig.symbol] = res;
        }),
      );
    }
  }
  await Promise.all(stooqTasks);
  // Spreads after their inputs.
  await Promise.all(spreadTasks.map(({ el, sig }) => loadSpread(el, sig, stooqCache)));

  // Crypto: one batched call.
  await loadCrypto(built.crypto);

  setUpdated();
  btn.disabled = false;
}

document.getElementById("refresh").addEventListener("click", loadAll);
loadAll();
