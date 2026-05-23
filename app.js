// Macro Signals Tracker - reads data/signals.json (produced server-side
// by scripts/fetch_signals.py on a GitHub Actions cron) and renders
// each signal as a card. No external API calls from the browser, so
// no CORS issues.

const VIEW = {
  rates: [
    { key: "us2y",             label: "US 2Y Yield",     suffix: "%" },
    { key: "us10y",            label: "US 10Y Yield",    suffix: "%" },
    { key: "us30y",            label: "US 30Y Yield",    suffix: "%" },
    { key: "us10y_2y_spread",  label: "10Y - 2Y Spread", suffix: "%" },
  ],
  equities: [
    { key: "sp500",     label: "S&P 500" },
    { key: "nasdaq100", label: "Nasdaq 100" },
    { key: "dow",       label: "Dow Jones" },
    { key: "vix",       label: "VIX" },
  ],
  fxcomm: [
    { key: "dxy",    label: "DXY (Dollar Index)" },
    { key: "eurusd", label: "EUR / USD" },
    { key: "usdjpy", label: "USD / JPY" },
    { key: "xauusd", label: "Gold (XAU/USD)", prefix: "$" },
    { key: "wti",    label: "WTI Crude Oil",  prefix: "$" },
    { key: "brent",  label: "Brent Crude",    prefix: "$" },
  ],
  crypto: [
    { key: "btc", label: "Bitcoin",  prefix: "$" },
    { key: "eth", label: "Ethereum", prefix: "$" },
    { key: "sol", label: "Solana",   prefix: "$" },
  ],
};

const INDIA_LIVE_VIEW = [
  { key: "brent",             label: "Brent Crude",         prefix: "$" },
  { key: "dxy",               label: "DXY" },
  { key: "us10y",             label: "US 10Y Yield",        suffix: "%" },
  { key: "us_ig_oas",         label: "US IG OAS",           suffix: " bps" },
  { key: "usdinr",            label: "USD / INR",           suffix: " ₹" },
  { key: "indiavix",          label: "India VIX" },
  { key: "nifty",             label: "Nifty 50" },
  { key: "nifty_wk_pct",      label: "Nifty 50 Δ (5d)",     suffix: "%" },
  { key: "in10y",             label: "10Y G-Sec Yield",     suffix: "%" },
  { key: "ind_us_10y_spread", label: "India-US 10Y Spread", suffix: "%" },
  { key: "india_5y_cds",      label: "India 5Y CDS",        suffix: " bps" },
  { key: "gold_30d_pct",      label: "Gold Δ (30d)",        suffix: "%" },
  { key: "nhb_refi_rate",     label: "NHB Refinance Rate",  suffix: "%" },
  { key: "mcx_gold_inr_10g",  label: "MCX Gold (₹/10g)",    prefix: "₹" },
];

// --- formatting helpers ---

function fmtNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs < 1 ? 4 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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

// --- card construction ---

function cardEl(label, withAsof = false) {
  const el = document.createElement("div");
  el.className = "card loading";
  el.innerHTML = `
    <div class="label"></div>
    <div class="value">…</div>
    <div class="change">&nbsp;</div>
  `;
  el.querySelector(".label").textContent = label;
  if (withAsof) {
    const asof = document.createElement("div");
    asof.className = "asof missing";
    asof.innerHTML = '<span class="dot"></span><span class="txt">no data</span>';
    el.appendChild(asof);
  }
  return el;
}

function renderCard(el, view, sig) {
  el.classList.remove("loading", "error");
  if (!sig || sig.value === null || sig.value === undefined) {
    el.classList.add("error");
    el.querySelector(".value").textContent = "Unavailable";
    el.querySelector(".change").textContent = "";
    setAsof(el, "missing", "no data");
    return;
  }
  const prefix = view.prefix || "";
  const suffix = view.suffix || "";
  el.querySelector(".value").textContent = `${prefix}${fmtNumber(sig.value)}${suffix}`;

  let absChange = null;
  let pctChange = null;
  if (sig.previous !== null && sig.previous !== undefined) {
    absChange = sig.value - sig.previous;
    pctChange = sig.previous !== 0 ? (absChange / Math.abs(sig.previous)) * 100 : 0;
  }
  const ch = fmtChange(absChange, pctChange);
  const changeEl = el.querySelector(".change");
  changeEl.textContent = ch.text;
  changeEl.className = `change ${ch.cls}`;
  setAsof(el, "live", sig.asof ? `as of ${sig.asof}` : "live");
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

// --- manual India Credit cards (from data/india-credit.json) ---

function renderManualCard(el, sig) {
  if (sig.value === null || sig.value === undefined) {
    el.classList.remove("loading");
    el.querySelector(".value").textContent = "—";
    el.querySelector(".change").textContent = "";
    setAsof(el, "missing", "awaiting input");
    return;
  }
  let absChange = null;
  let pctChange = null;
  if (sig.previous !== null && sig.previous !== undefined) {
    absChange = sig.value - sig.previous;
    pctChange = sig.previous !== 0 ? (absChange / Math.abs(sig.previous)) * 100 : 0;
  }
  renderCard(el, { suffix: sig.unit ? ` ${sig.unit}` : "" }, {
    value: sig.value,
    previous: sig.previous,
    asof: sig.asof,
  });
  if (sig.invertColor && absChange !== null) {
    const ch = el.querySelector(".change");
    if (ch.classList.contains("up")) {
      ch.classList.remove("up"); ch.classList.add("down");
    } else if (ch.classList.contains("down")) {
      ch.classList.remove("down"); ch.classList.add("up");
    }
  }
  const dd = daysSince(sig.asof);
  const stale = dd !== null && dd > 45;
  setAsof(el, stale ? "manual stale" : "manual", sig.asof ? `as of ${sig.asof}` : "as of —");
}

// --- main load ---

function setUpdated(updatedAt) {
  const el = document.getElementById("updated");
  if (!updatedAt) {
    el.textContent = "No data yet — workflow has not run.";
    return;
  }
  const d = new Date(updatedAt);
  el.textContent = `Updated ${d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })}`;
}

async function loadSignals() {
  const url = `data/signals.json?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`signals.json HTTP ${res.status}`);
  return res.json();
}

async function loadManual() {
  try {
    const res = await fetch(`data/india-credit.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn("[india-credit.json]", e.message);
    return null;
  }
}

function renderTopGroups(data) {
  for (const [groupKey, views] of Object.entries(VIEW)) {
    const grid = document.querySelector(`.group[data-group="${groupKey}"] .grid`);
    grid.innerHTML = "";
    for (const view of views) {
      const el = cardEl(view.label, true);
      grid.appendChild(el);
      renderCard(el, view, data.signals[view.key]);
    }
  }
}

function renderIndia(data, manual) {
  const root = document.getElementById("india-subgroups");
  root.innerHTML = "";

  // Live Tape - always renders all cards; cards with no data show
  // "Unavailable" so you can tell which slot is empty.
  const liveWrap = document.createElement("div");
  liveWrap.className = "subgroup";
  liveWrap.innerHTML = '<h3>Live Tape</h3><div class="grid"></div>';
  const liveGrid = liveWrap.querySelector(".grid");
  root.appendChild(liveWrap);
  for (const view of INDIA_LIVE_VIEW) {
    const el = cardEl(view.label, true);
    liveGrid.appendChild(el);
    renderCard(el, view, data.signals[view.key]);
  }

  if (!manual) return;
  for (const [groupName, sigs] of Object.entries(manual.groups || {})) {
    const wrap = document.createElement("div");
    wrap.className = "subgroup";
    const h = document.createElement("h3");
    h.textContent = groupName;
    const grid = document.createElement("div");
    grid.className = "grid";
    wrap.appendChild(h);
    wrap.appendChild(grid);
    root.appendChild(wrap);

    for (const sig of sigs) {
      // Prefer live value from signals.json if present.
      const live = data.signals[sig.key];
      if (live && live.value !== null && live.value !== undefined) {
        const el = cardEl(sig.label, true);
        grid.appendChild(el);
        renderCard(el, { suffix: sig.unit ? ` ${sig.unit}` : "" }, live);
        continue;
      }
      // Otherwise use the manual value if present.
      if (sig.value === null || sig.value === undefined) continue;
      const el = cardEl(sig.label, true);
      grid.appendChild(el);
      renderManualCard(el, sig);
    }

    if (grid.children.length === 0) {
      wrap.remove();
    }
  }
}

async function refresh() {
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  document.getElementById("updated").textContent = "Loading…";
  try {
    const [data, manual] = await Promise.all([loadSignals(), loadManual()]);
    setUpdated(data.updatedAt);
    renderTopGroups(data);
    renderIndia(data, manual);
  } catch (e) {
    console.error("[refresh]", e);
    document.getElementById("updated").textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
refresh();
