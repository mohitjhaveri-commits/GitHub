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
    renderCreditAnalytics(data);
  } catch (e) {
    console.error("[refresh]", e);
    document.getElementById("updated").textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ============ Credit Analytics ============

function caGet(data, key) {
  const s = data.signals && data.signals[key];
  return s && s.value !== null && s.value !== undefined ? s.value : null;
}

function caPctChange(data, key) {
  const s = data.signals && data.signals[key];
  if (!s || s.value == null || s.previous == null || s.previous === 0) return null;
  return ((s.value - s.previous) / s.previous) * 100;
}

function buildCreditOutlook(V) {
  const parts = [];
  let supportive = 0;
  let cautious = 0;

  if (V.in10y != null) {
    if (V.in10y < 7) {
      parts.push("Bond markets are pricing in continued monetary easing.");
      supportive++;
    } else if (V.in10y <= 7.5) {
      parts.push("Yields are range-bound, reflecting a wait-and-watch stance.");
    } else {
      parts.push("Yields are elevated — credit spreads likely to widen.");
      cautious++;
    }
  }

  if (V.ind_us_spread != null) {
    if (V.ind_us_spread > 5.5) {
      parts.push(
        "The India-US yield differential remains attractive for carry trades, supporting demand for Indian corporate bonds.",
      );
      supportive++;
    } else if (V.ind_us_spread < 4) {
      parts.push("Compressed India-US spreads reduce FPI appetite for rupee debt.");
      cautious++;
    } else {
      parts.push("The India-US spread sits in a neutral band — flows are likely two-way.");
    }
  }

  if (V.indiavix != null) {
    if (V.indiavix < 15) {
      parts.push(
        "Domestic volatility is subdued — favourable for new NCD issuances and secondary market liquidity.",
      );
      supportive++;
    } else if (V.indiavix <= 22) {
      parts.push(
        "Moderate domestic volatility means performing credit remains well-bid but issuer selectivity matters.",
      );
    } else {
      parts.push(
        "Elevated India VIX signals risk aversion — expect spread widening in A/AA NCDs.",
      );
      cautious++;
    }
  }

  if (V.vix != null) {
    if (V.vix > 25) {
      parts.push("Global volatility is also stretched, amplifying EM credit risk.");
      cautious++;
    } else if (V.vix < 18 && V.indiavix != null && V.indiavix < 18) {
      parts.push("Cross-asset volatility remains contained globally.");
    }
  }

  if (V.brent != null) {
    if (V.brent > 110) {
      parts.push(
        "Elevated crude prices pose a risk to India's current account and could trigger INR depreciation, pressuring NBFC funding costs.",
      );
      cautious++;
    } else if (V.brent < 85) {
      parts.push(
        "Benign crude prices support India's macro stability and rate-cut expectations.",
      );
      supportive++;
    }
  }

  if (V.dxy != null) {
    if (V.dxy > 103) {
      parts.push("A strong dollar adds headwinds for EM flows.");
      cautious++;
    } else if (V.dxy < 100) {
      parts.push("A softer dollar is supportive of EM bond inflows.");
      supportive++;
    }
  }

  if (V.usdinrPct != null) {
    if (V.usdinrPct > 3) {
      parts.push("Sharp INR depreciation is putting upward pressure on landed funding costs.");
      cautious++;
    } else if (V.usdinrPct < -1) {
      parts.push("INR has firmed, easing import-cost pressures.");
    }
  }

  if (V.gold_30d != null) {
    if (V.gold_30d > 10) {
      parts.push(
        "Sharp gold rally signals global risk-off — gold-loan NBFCs benefit from LTV cushion but broader credit risk rises.",
      );
    } else if (Math.abs(V.gold_30d) < 5) {
      parts.push("Gold prices are stable — neutral for gold-loan NBFC asset quality.");
    }
  }

  if (V.nifty != null) {
    if (V.nifty > 23000) {
      parts.push(
        "Equity markets remain buoyant — positive for NBFC equity capital raises and potential IPO-driven yield compression for issuers like Indel Money, Fibe, and KreditBee.",
      );
      supportive++;
    } else if (V.nifty < 20000) {
      parts.push("Equity market weakness could spill over into corporate bond sentiment.");
      cautious++;
    }
  }

  let stance, stanceCls, action;
  if (supportive >= cautious + 2) {
    stance = "SUPPORTIVE";
    stanceCls = "supportive";
    action = "secured gold-loan NCDs and diversified NBFC exposure";
  } else if (cautious >= supportive + 2) {
    stance = "CAUTIOUS";
    stanceCls = "cautious";
    action = "defensive short-duration positioning and AAA / SDL paper";
  } else {
    stance = "NEUTRAL";
    stanceCls = "neutral";
    action = "diversified NBFC exposure with selective duration";
  }

  return {
    paragraph: parts.join(" "),
    stance,
    stanceCls,
    action,
  };
}

const CA_RISK_FACTORS = [
  {
    label: "Brent Crude",
    valueOf: (V) => V.brent,
    fmt: (v) => `$${v.toFixed(2)}`,
    cls: (v) => (v == null ? "na" : v < 85 ? "green" : v <= 110 ? "amber" : "red"),
  },
  {
    label: "DXY",
    valueOf: (V) => V.dxy,
    fmt: (v) => v.toFixed(2),
    cls: (v) => (v == null ? "na" : v < 100 ? "green" : v <= 105 ? "amber" : "red"),
  },
  {
    label: "USD/INR Δ",
    valueOf: (V) => V.usdinrPct,
    fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`,
    cls: (v) => (v == null ? "na" : v < 1 ? "green" : v <= 3 ? "amber" : "red"),
  },
  {
    label: "India VIX",
    valueOf: (V) => V.indiavix,
    fmt: (v) => v.toFixed(2),
    cls: (v) => (v == null ? "na" : v < 15 ? "green" : v <= 22 ? "amber" : "red"),
  },
  {
    label: "US VIX",
    valueOf: (V) => V.vix,
    fmt: (v) => v.toFixed(2),
    cls: (v) => (v == null ? "na" : v < 18 ? "green" : v <= 25 ? "amber" : "red"),
  },
  {
    label: "India 10Y",
    valueOf: (V) => V.in10y,
    fmt: (v) => `${v.toFixed(2)}%`,
    cls: (v) => (v == null ? "na" : v < 6.8 ? "green" : v <= 7.5 ? "amber" : "red"),
  },
  {
    label: "US 10Y",
    valueOf: (V) => V.us10y,
    fmt: (v) => `${v.toFixed(2)}%`,
    cls: (v) => (v == null ? "na" : v < 4.2 ? "green" : v <= 4.8 ? "amber" : "red"),
  },
  {
    label: "Gold 30D Δ",
    valueOf: (V) => V.gold_30d,
    fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`,
    cls: (v) =>
      v == null ? "na" : Math.abs(v) < 5 ? "green" : Math.abs(v) <= 15 ? "amber" : "red",
  },
  {
    label: "Nifty 50 Level",
    valueOf: (V) => V.nifty,
    fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    cls: (v) => (v == null ? "na" : v > 23000 ? "green" : v >= 20000 ? "amber" : "red"),
  },
  {
    label: "India-US Spread",
    valueOf: (V) => V.ind_us_spread,
    fmt: (v) => `${v.toFixed(2)}pp`,
    cls: (v) => {
      if (v == null) return "na";
      if (v >= 4.5 && v <= 6) return "green";
      if ((v >= 3.5 && v < 4.5) || (v > 6 && v <= 6.5)) return "amber";
      return "red";
    },
  },
  {
    label: "Nifty 5D Δ",
    valueOf: (V) => V.nifty_wk,
    fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`,
    cls: (v) => (v == null ? "na" : v > 0 ? "green" : v >= -2 ? "amber" : "red"),
  },
  {
    label: "VIX Diff (IN-US)",
    valueOf: (V) =>
      V.indiavix != null && V.vix != null ? V.indiavix - V.vix : null,
    fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`,
    cls: (v) => {
      if (v == null) return "na";
      if (v < 0) return "green";
      if (v <= 3) return "amber";
      if (v >= 5) return "red";
      return "amber";
    },
  },
];

function renderRiskMatrix(V) {
  const grid = document.getElementById("ca-risk-grid");
  grid.innerHTML = "";
  let g = 0, a = 0, r = 0, na = 0;
  for (const f of CA_RISK_FACTORS) {
    const v = f.valueOf(V);
    const cls = f.cls(v);
    if (cls === "green") g++;
    else if (cls === "amber") a++;
    else if (cls === "red") r++;
    else na++;
    const card = document.createElement("div");
    card.className = "ca-risk-card";
    card.innerHTML = `
      <span class="ca-dot ${cls}"></span>
      <div class="ca-factor"></div>
      <div class="ca-value"></div>
    `;
    card.querySelector(".ca-factor").textContent = f.label;
    card.querySelector(".ca-value").textContent =
      v == null ? "—" : f.fmt(v);
    grid.appendChild(card);
  }
  const total = g + a + r;
  const summary = document.getElementById("ca-risk-summary");
  const naSuffix = na > 0 ? ` · ${na} N/A` : "";
  summary.innerHTML = `
    <span><strong>${g}</strong> of ${total} green</span>
    <span><strong>${a}</strong> amber</span>
    <span><strong>${r}</strong> red${naSuffix}</span>
    <span class="ca-bar">
      <span class="g" style="flex:${g}"></span>
      <span class="a" style="flex:${a}"></span>
      <span class="r" style="flex:${r}"></span>
    </span>
  `;
}

const CA_RBI_RATES = [
  { date: "2023-02", rate: 6.5 },
  { date: "2024-06", rate: 6.5 },
  { date: "2024-10", rate: 6.5 },
  { date: "2025-02", rate: 6.25 },
  { date: "2025-04", rate: 6.0 },
  { date: "2025-06", rate: 5.75 },
  { date: "2025-08", rate: 5.5 },
  { date: "2025-12", rate: 5.25 },
  { date: "2026-02", rate: 5.25 },
];

let _caRateChart = null;
let _caRelativeChart = null;

function renderRateCycleChart() {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("ca-rate-chart");
  if (!ctx) return;
  const labels = CA_RBI_RATES.map((p) => p.date);
  const rates = CA_RBI_RATES.map((p) => p.rate);
  if (_caRateChart) _caRateChart.destroy();
  _caRateChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "RBI Repo Rate",
          data: rates,
          borderColor: "#fbbf24",
          backgroundColor: "rgba(251, 191, 36, 0.10)",
          fill: true,
          tension: 0.1,
          pointBackgroundColor: "#fbbf24",
          pointBorderColor: "#0b0d12",
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y.toFixed(2)} %`,
          },
          backgroundColor: "#141822",
          titleColor: "#e6e9ef",
          bodyColor: "#e6e9ef",
          borderColor: "#232a3a",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: "#8a93a6", font: { family: "JetBrains Mono", size: 11 } },
          grid: { color: "rgba(35, 42, 58, 0.6)" },
        },
        y: {
          beginAtZero: false,
          ticks: {
            color: "#8a93a6",
            font: { family: "JetBrains Mono", size: 11 },
            callback: (v) => `${v}%`,
          },
          grid: { color: "rgba(35, 42, 58, 0.6)" },
        },
      },
    },
  });
}

const CA_SCENARIOS = [
  {
    name: "Further easing",
    trigger: "RBI cuts 25 bps",
    rate: "-25 bps",
    price: "+0.6%",
    spread: "Tighten 10–15 bps",
    action: "Add duration",
    row: "supportive",
  },
  {
    name: "Aggressive easing",
    trigger: "RBI cuts 50 bps",
    rate: "-50 bps",
    price: "+1.2%",
    spread: "Tighten 20–30 bps",
    action: "Extend to 3–4Y paper",
    row: "supportive",
  },
  {
    name: "Status quo",
    trigger: "RBI holds",
    rate: "0 bps",
    price: "Carry only",
    spread: "Neutral",
    action: "Hold, clip coupon",
    row: "",
  },
  {
    name: "Oil shock",
    trigger: "Brent >$130",
    rate: "+50 bps",
    price: "-1.2%",
    spread: "Widen 25–40 bps",
    action: "Shorten duration",
    row: "cautious",
  },
  {
    name: "Global risk-off",
    trigger: "US recession / war",
    rate: "+75 bps",
    price: "-1.8%",
    spread: "Widen 50–75 bps",
    action: "Move to AAA / SDL",
    row: "cautious",
  },
  {
    name: "INR crisis",
    trigger: "USD/INR >100",
    rate: "+100 bps",
    price: "-2.4%",
    spread: "Widen 75–125 bps",
    action: "Exit low-rated, go secured",
    row: "cautious",
  },
];

function renderScenarios() {
  const body = document.getElementById("ca-scenarios-body");
  body.innerHTML = "";
  for (const s of CA_SCENARIOS) {
    const tr = document.createElement("tr");
    if (s.row) tr.className = `row-${s.row}`;
    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${s.trigger}</td>
      <td>${s.rate}</td>
      <td>${s.price}</td>
      <td>${s.spread}</td>
      <td>${s.action}</td>
    `;
    body.appendChild(tr);
  }
}

function renderRelativeValue(V) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("ca-relative-chart");
  if (!ctx) return;

  const rows = [
    { label: "Bank FD 1Y", v: 6.5, sweet: false },
    { label: "AAA Corp Bond 3Y", v: 7.2, sweet: false },
    {
      label: "India 10Y G-Sec",
      v: V.in10y != null ? V.in10y : null,
      sweet: false,
    },
    {
      label: "US 10Y Treasury",
      v: V.us10y != null ? V.us10y : null,
      sweet: false,
    },
    { label: "AA Corp Bond 3Y", v: 8.5, sweet: true },
    { label: "A-rated NBFC NCD 2Y", v: 10.0, sweet: true },
  ];
  const labels = rows.map((r) => r.label);
  const values = rows.map((r) => (r.v == null ? 0 : r.v));
  const colors = rows.map((r) =>
    r.sweet ? "rgba(251, 191, 36, 0.85)" : "rgba(96, 165, 250, 0.65)",
  );
  const borders = rows.map((r) =>
    r.sweet ? "#fbbf24" : "#60a5fa",
  );

  if (_caRelativeChart) _caRelativeChart.destroy();
  _caRelativeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Yield",
          data: values,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x.toFixed(2)} %`,
          },
          backgroundColor: "#141822",
          titleColor: "#e6e9ef",
          bodyColor: "#e6e9ef",
          borderColor: "#232a3a",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#8a93a6",
            font: { family: "JetBrains Mono", size: 11 },
            callback: (v) => `${v}%`,
          },
          grid: { color: "rgba(35, 42, 58, 0.6)" },
        },
        y: {
          ticks: { color: "#e6e9ef", font: { family: "JetBrains Mono", size: 12 } },
          grid: { display: false },
        },
      },
    },
  });
}

function renderCreditAnalytics(data) {
  const V = {
    in10y: caGet(data, "in10y"),
    us10y: caGet(data, "us10y"),
    ind_us_spread: caGet(data, "ind_us_10y_spread"),
    indiavix: caGet(data, "indiavix"),
    vix: caGet(data, "vix"),
    brent: caGet(data, "brent"),
    dxy: caGet(data, "dxy"),
    usdinr: caGet(data, "usdinr"),
    usdinrPct: caPctChange(data, "usdinr"),
    gold_30d: caGet(data, "gold_30d_pct"),
    nifty: caGet(data, "nifty"),
    nifty_wk: caGet(data, "nifty_wk_pct"),
  };

  document.getElementById("ca-date").textContent = new Date().toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  );

  const outlook = buildCreditOutlook(V);
  document.getElementById("ca-narrative").textContent = outlook.paragraph;
  const posEl = document.getElementById("ca-positioning");
  posEl.innerHTML = `Net assessment: <span class="ca-stance ${outlook.stanceCls}">${outlook.stance}</span> for performing credit. Favour ${outlook.action}.`;

  renderRiskMatrix(V);
  renderScenarios();

  // Charts depend on Chart.js (loaded with defer). Try now, retry shortly
  // if the library hasn't arrived yet.
  const tryCharts = () => {
    if (typeof Chart === "undefined") {
      setTimeout(tryCharts, 100);
      return;
    }
    renderRateCycleChart();
    renderRelativeValue(V);
  };
  tryCharts();
}

document.getElementById("refresh").addEventListener("click", refresh);
refresh();
