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

// ---------- India Credit ----------

const INDIA_LIVE = [
  { key: "brent",       label: "Brent Crude",        symbol: "cb.f",    prefix: "$" },
  { key: "dxy",         label: "DXY",                symbol: "^dxy" },
  { key: "us10y",       label: "US 10Y Yield",       symbol: "10usy.b", suffix: "%" },
  { key: "usdinr",      label: "USD / INR",          symbol: "usdinr",  suffix: " ₹" },
  { key: "indiavix",    label: "India VIX",          symbol: "^indiavix" },
  { key: "nifty",       label: "Nifty 50",           symbol: "^nsei" },
  { key: "in10y",       label: "10Y G-Sec Yield",    symbol: "10iny.b", suffix: "%" },
];

const INDIA_LIVE_DERIVED = [
  {
    key: "ind_us_spread",
    label: "India-US 10Y Spread",
    suffix: " bps",
    needs: ["in10y", "us10y"],
    compute: (c) => {
      const close = (c.in10y.close - c.us10y.close) * 100;
      const open =
        c.in10y.open !== null && c.us10y.open !== null
          ? (c.in10y.open - c.us10y.open) * 100
          : null;
      return { close, open };
    },
  },
  {
    key: "mcx_gold",
    label: "MCX Gold (₹/10g, est.)",
    prefix: "₹",
    needs: ["xauusd", "usdinr"],
    fetchExtra: { xauusd: "xauusd" },
    compute: (c) => {
      // ₹ per 10g ≈ USD/oz × USDINR × 10 / 31.1035
      const k = 10 / 31.1035;
      const close = c.xauusd.close * c.usdinr.close * k;
      const open =
        c.xauusd.open !== null && c.usdinr.open !== null
          ? c.xauusd.open * c.usdinr.open * k
          : null;
      return { close, open };
    },
  },
];

function cardWithMeta(label) {
  const el = cardEl(label);
  const asof = document.createElement("div");
  asof.className = "asof missing";
  asof.innerHTML = '<span class="dot"></span><span class="txt">no data</span>';
  el.appendChild(asof);
  return el;
}

function setAsof(el, kind, text) {
  const asof = el.querySelector(".asof");
  if (!asof) return;
  asof.className = `asof ${kind}`;
  asof.querySelector(".txt").textContent = text;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function renderManualCard(el, sig) {
  if (sig.value === null || sig.value === undefined) {
    renderCard(el, { value: null, absChange: null, pctChange: null });
    setAsof(el, "missing", "awaiting input");
    return;
  }
  let absChange = null;
  let pctChange = null;
  if (sig.previous !== null && sig.previous !== undefined) {
    absChange = sig.value - sig.previous;
    pctChange = sig.previous !== 0 ? (absChange / Math.abs(sig.previous)) * 100 : 0;
    if (sig.invertColor) {
      // Flip the change sign so a "bad" direction shows red.
      // We swap by negating change in display: easier to invert via flipping the value used for color via DOM class.
    }
  }
  renderCard(el, {
    value: sig.value,
    absChange,
    pctChange,
    suffix: sig.unit ? ` ${sig.unit}` : "",
  });
  if (sig.invertColor && absChange !== null) {
    const ch = el.querySelector(".change");
    // swap up <-> down
    if (ch.classList.contains("up")) {
      ch.classList.remove("up");
      ch.classList.add("down");
    } else if (ch.classList.contains("down")) {
      ch.classList.remove("down");
      ch.classList.add("up");
    }
  }
  const dd = daysSince(sig.asof);
  const dateLabel = sig.asof ? `as of ${sig.asof}` : "as of —";
  const stale = dd !== null && dd > 45;
  setAsof(el, stale ? "manual stale" : "manual", dateLabel);
}

async function loadIndia() {
  const root = document.getElementById("india-subgroups");
  root.innerHTML = "";

  // ----- Live block (Stooq + derived) -----
  const liveWrap = document.createElement("div");
  liveWrap.className = "subgroup";
  liveWrap.innerHTML = '<h3>Live Tape</h3><div class="grid"></div>';
  const liveGrid = liveWrap.querySelector(".grid");
  root.appendChild(liveWrap);

  const liveCards = {};
  for (const sig of INDIA_LIVE) {
    const el = cardWithMeta(sig.label);
    liveGrid.appendChild(el);
    liveCards[sig.key] = { el, sig };
  }
  const derivedCards = {};
  for (const d of INDIA_LIVE_DERIVED) {
    const el = cardWithMeta(d.label);
    liveGrid.appendChild(el);
    derivedCards[d.key] = { el, d };
  }

  const cache = {};
  await Promise.all(
    INDIA_LIVE.map(async (sig) => {
      try {
        const res = await fetchStooq(sig.symbol);
        cache[sig.key] = res;
        let absChange = null;
        let pctChange = null;
        if (res.open !== null && res.open !== 0) {
          absChange = res.close - res.open;
          pctChange = (absChange / res.open) * 100;
        }
        renderCard(liveCards[sig.key].el, {
          value: res.close,
          absChange,
          pctChange,
          prefix: sig.prefix || "",
          suffix: sig.suffix || "",
        });
        setAsof(liveCards[sig.key].el, "live", "live · Stooq");
      } catch (e) {
        renderError(liveCards[sig.key].el, "Unavailable");
        setAsof(liveCards[sig.key].el, "missing", "no data");
      }
    }),
  );

  // Extra fetches needed by derived signals (e.g. xauusd).
  const extras = {};
  for (const d of INDIA_LIVE_DERIVED) {
    if (!d.fetchExtra) continue;
    for (const [k, sym] of Object.entries(d.fetchExtra)) {
      if (cache[k] || extras[k]) continue;
      extras[k] = fetchStooq(sym).then((r) => (cache[k] = r)).catch(() => null);
    }
  }
  await Promise.all(Object.values(extras));

  for (const d of INDIA_LIVE_DERIVED) {
    const { el } = derivedCards[d.key];
    const ok = d.needs.every((k) => cache[k]);
    if (!ok) {
      renderError(el, "Unavailable");
      setAsof(el, "missing", "no data");
      continue;
    }
    try {
      const { close, open } = d.compute(cache);
      let absChange = null;
      let pctChange = null;
      if (open !== null && open !== 0) {
        absChange = close - open;
        pctChange = (absChange / Math.abs(open)) * 100;
      }
      renderCard(el, {
        value: close,
        absChange,
        pctChange,
        prefix: d.prefix || "",
        suffix: d.suffix || "",
      });
      setAsof(el, "live", "live · derived");
    } catch (e) {
      renderError(el, "Unavailable");
      setAsof(el, "missing", "no data");
    }
  }

  // ----- Manual JSON groups -----
  let manual;
  try {
    const res = await fetch("data/india-credit.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manual = await res.json();
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "subgroup";
    warn.innerHTML =
      '<h3>Manual signals</h3><p class="india-sub">Could not load <code>data/india-credit.json</code>.</p>';
    root.appendChild(warn);
    return;
  }

  for (const [groupName, sigs] of Object.entries(manual.groups || {})) {
    const wrap = document.createElement("div");
    wrap.className = "subgroup";
    const grid = document.createElement("div");
    grid.className = "grid";
    const h = document.createElement("h3");
    h.textContent = groupName;
    wrap.appendChild(h);
    wrap.appendChild(grid);
    root.appendChild(wrap);

    for (const sig of sigs) {
      const el = cardWithMeta(sig.label);
      grid.appendChild(el);
      renderManualCard(el, sig);
    }
  }
}

document.getElementById("refresh").addEventListener("click", async () => {
  await loadAll();
  await loadIndia();
});

(async () => {
  await loadAll();
  await loadIndia();
})();
