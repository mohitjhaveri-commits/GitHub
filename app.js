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

// ---------- Regime detection ----------

function caDetectRegime(V) {
  // Stress: extreme conditions across multiple factors at once
  if (
    V.brent != null && V.brent > 130 &&
    V.dxy != null && V.dxy > 108 &&
    V.indiavix != null && V.indiavix > 28 &&
    V.usdinrPct != null && V.usdinrPct > 3
  ) {
    return {
      id: "stress",
      label: "Stress / Risk-Off",
      text:
        "Credit markets under stress. Secondary market liquidity for A/AA NCDs will dry up. Bid-ask spreads will widen to 50–100 bps. Halt new purchases. Focus on portfolio defence — review PONV triggers (ESAF SFB), covenant breach proximity (Kaabil Finance gearing near 5x ICRA trigger), and maturity concentration. If holding unsecured MFI paper, evaluate exit even at mark-to-market loss. SDL and AAA PSU bonds are the only safe carry in this regime.",
    };
  }

  // Defensive: any one of these is enough
  if (
    (V.brent != null && V.brent > 110) ||
    (V.dxy != null && V.dxy > 105) ||
    (V.indiavix != null && V.indiavix > 22) ||
    (V.nifty != null && V.nifty < 20000)
  ) {
    return {
      id: "defensive",
      label: "Defensive / Spread Widening",
      text:
        "Risk factors elevated. Corporate bond spreads likely to widen 25–50 bps over the next 1–2 months. Reduce A-rated NBFC exposure, move up in quality to AA/AAA. Shorten duration to <2Y. Avoid MFI-linked issuers (CreditAccess, Asirvad) where asset quality stress is likely to surface first. Gold loan NBFCs remain relatively defensive but monitor LTV levels if gold corrects. Build cash for better entry points.",
    };
  }

  // Risk-on: all factors aligned
  if (
    V.brent != null && V.brent < 90 &&
    V.dxy != null && V.dxy < 100 &&
    V.indiavix != null && V.indiavix < 15 &&
    V.nifty != null && V.nifty > 23000 &&
    V.in10y != null && V.in10y < 7
  ) {
    return {
      id: "risk-on",
      label: "Risk-On / Spread Compression",
      text:
        "All macro factors aligned for credit. NCD spreads should tighten 15–25 bps over the next quarter. This is the environment to extend duration to 3–4Y, add A-rated paper, and participate in primary NCD issuances at current coupons. Gold-loan NBFCs (Muthoot, Indel, Kosamattam) are particularly well-positioned — benign gold prices provide LTV cushion while rate cuts lower their borrowing cost. Consider locking in high-coupon NCDs before the next repricing wave.",
    };
  }

  return {
    id: "neutral",
    label: "Carry-Friendly / Neutral",
    text:
      "Mixed signals — no clear directional trade. Focus on carry rather than capital gains. Stick to 1.5–2.5Y duration in AA-rated secured NCDs. Avoid reaching for yield in unsecured MFI paper. The rate cycle is supportive but global risks (crude, DXY, geopolitics) limit further spread compression. Book profits on any A-rated positions that have tightened >50 bps from entry. Reinvest in shorter-duration AA paper.",
  };
}

// ---------- Cross-asset signal matrix ----------

function caClassifyAndComment(key, V) {
  // Returns {value, level, commentary, dir}
  switch (key) {
    case "brent": {
      const v = V.brent;
      if (v == null) return null;
      let level, commentary, dir;
      if (v > 110) {
        level = "red";
        commentary =
          "Pushes India CAD wider → INR pressure → RBI forced to pause/hike → NBFC funding costs rise → NCD spreads widen. Gold-loan NBFCs partially hedged via gold collateral. Unsecured lenders (consumer/MFI) most exposed.";
        dir = "down";
      } else if (v < 85) {
        level = "green";
        commentary =
          "Supports INR, keeps inflation anchored, gives RBI room for 25–50 bps more cuts. Directly compresses NBFC borrowing costs by 15–30 bps. Most bullish single factor for performing credit.";
        dir = "up";
      } else {
        level = "amber";
        commentary =
          "Crude in normal band — macro-neutral for INR and funding costs. Watch for breakouts in either direction.";
        dir = "flat";
      }
      return { value: `$${v.toFixed(2)}`, level, commentary, dir };
    }
    case "dxy": {
      const v = V.dxy;
      if (v == null) return null;
      let level, commentary, dir;
      if (v > 103) {
        level = "red";
        commentary =
          "Strong dollar = FPI outflows from Indian debt → reduced demand for corporate bonds → wider spreads. Also signals global liquidity tightening which historically precedes EM credit events.";
        dir = "down";
      } else if (v < 100) {
        level = "green";
        commentary =
          "Weak dollar = EM tailwind. FPI flows into Indian bonds (post JP Morgan index inclusion, India now ~10% weight in GBI-EM). Demand for AAA/AA paper increases, pulling A-rated spreads tighter via the compression cascade.";
        dir = "up";
      } else {
        level = "amber";
        commentary =
          "Dollar in neutral band. FPI flows two-way; spread compression hinges on domestic catalysts.";
        dir = "flat";
      }
      return { value: v.toFixed(2), level, commentary, dir };
    }
    case "usdinr": {
      const v = V.usdinr;
      const pct = V.usdinrPct;
      if (v == null) return null;
      const pctStr = pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      let level, dir;
      if (pct != null && pct > 3) { level = "red"; dir = "down"; }
      else if (pct != null && pct > 1) { level = "amber"; dir = "flat"; }
      else { level = "green"; dir = "up"; }
      const commentary =
        `Every 1% INR depreciation adds ~10 bps to NBFC foreign-currency borrowing costs. Current spot ₹${v.toFixed(2)}/$ (Δ ${pctStr} vs prior). For NBFCs with ECB exposure (Shriram, Bajaj Finance), FX hedging costs eat into NIMs. Pure-domestic NBFCs (Muthoot, Indel, Paisalo) are insulated.`;
      return { value: `₹${v.toFixed(2)}`, level, commentary, dir };
    }
    case "indiavix": {
      const v = V.indiavix;
      if (v == null) return null;
      let level, commentary, dir;
      if (v < 15) {
        level = "green";
        commentary =
          "Low VIX = tight credit spreads. NCD primary issuances will be well-subscribed. Secondary market bid-ask spreads narrow to 10–20 bps for AA paper. Good window for portfolio rebalancing.";
        dir = "up";
      } else if (v <= 22) {
        level = "amber";
        commentary =
          "Normal range. Credit markets function but without urgency. Primary issuance may see 1.2–1.5x subscription vs 2x+ in low-VIX environments.";
        dir = "flat";
      } else {
        level = "red";
        commentary =
          "Elevated — mutual funds start gating, insurance companies pull back from corporate bonds, secondary liquidity evaporates for A-rated paper. Only AA and above trade in reasonable clip size.";
        dir = "down";
      }
      return { value: v.toFixed(2), level, commentary, dir };
    }
    case "vix": {
      const v = V.vix;
      if (v == null) return null;
      let level, dir;
      if (v > 25) { level = "red"; dir = "down"; }
      else if (v > 18) { level = "amber"; dir = "flat"; }
      else { level = "green"; dir = "up"; }
      const commentary =
        "Global risk-appetite proxy. When US VIX > 25, FPI outflows from Indian credit markets accelerate. Correlation between US VIX and Indian corporate-bond spread widening is ~0.6 with a 1–2 week lag.";
      return { value: v.toFixed(2), level, commentary, dir };
    }
    case "in10y": {
      const v = V.in10y;
      if (v == null) return null;
      let level, dir;
      if (v < 6.8) { level = "green"; dir = "up"; }
      else if (v <= 7.5) { level = "amber"; dir = "flat"; }
      else { level = "red"; dir = "down"; }
      const aa = (v + 2).toFixed(2);
      const a = (v + 3.5).toFixed(2);
      const commentary =
        `The anchor for all corporate bond pricing. A-rated NBFC NCDs trade ~300–400 bps over G-Sec; if G-Sec drops 25 bps, NCD yields follow with a 50–70% pass-through within 2–3 weeks. At ${v.toFixed(2)}% on the 10Y, AA 3Y NCDs price ~${aa}% and A-rated ~${a}%.`;
      return { value: `${v.toFixed(2)}%`, level, commentary, dir };
    }
    case "us10y": {
      const v = V.us10y;
      if (v == null) return null;
      let level, dir;
      if (v < 4.2) { level = "green"; dir = "up"; }
      else if (v <= 4.8) { level = "amber"; dir = "flat"; }
      else { level = "red"; dir = "down"; }
      const spread = V.ind_us_spread != null ? `${V.ind_us_spread.toFixed(2)}%` : "—";
      const commentary =
        `Global rate anchor. India-US 10Y spread currently ${spread}. Historically, when this spread exceeds 5.5%, India bonds attract carry-trade flows. Below 4%, FPIs prefer US Treasuries over Indian credit risk.`;
      return { value: `${v.toFixed(2)}%`, level, commentary, dir };
    }
    case "xauusd": {
      const v = V.xauusd;
      if (v == null) return null;
      const trigger = (v * 0.75).toFixed(0);
      const change = V.gold_30d;
      let level, dir;
      if (change != null && change < -10) { level = "red"; dir = "down"; }
      else if (change != null && Math.abs(change) > 5) { level = "amber"; dir = "flat"; }
      else { level = "green"; dir = "up"; }
      const commentary =
        `Gold directly determines asset quality for gold-loan NBFCs (Muthoot Fincorp, Indel Money, Kosamattam, ESAF). LTV averages 65–70%; a 20%+ drop from current would trigger mandatory margin calls and auctions. Current gold $${v.toFixed(0)} implies an auction-trigger zone below ~$${trigger}. LTV cushion is comfortable at current levels.`;
      return { value: `$${v.toFixed(0)}`, level, commentary, dir };
    }
    case "mcx_gold_inr_10g": {
      const v = V.mcxGold;
      if (v == null) return null;
      let level, dir, healthLabel;
      if (v > 60000) { level = "green"; dir = "up"; healthLabel = "healthy"; }
      else if (v >= 50000) { level = "amber"; dir = "flat"; healthLabel = "watch"; }
      else { level = "red"; dir = "down"; healthLabel = "stressed"; }
      const commentary =
        `The INR gold price is what actually matters for Indian gold-loan underwriting — even if XAU/USD falls, INR depreciation cushions the domestic price. At ₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}/10g, gold-loan NBFC portfolio quality is ${healthLabel}.`;
      return { value: `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, level, commentary, dir };
    }
    case "nifty": {
      const v = V.nifty;
      if (v == null) return null;
      let level, dir;
      if (v > 23000) { level = "green"; dir = "up"; }
      else if (v >= 20000) { level = "amber"; dir = "flat"; }
      else { level = "red"; dir = "down"; }
      const commentary =
        "Equity market strength supports NBFC equity raises and the IPO pipeline. Six MeraDhan issuers have upcoming IPOs (InCred, Fibe, Muthoot Fincorp, Navi, KreditBee, Indel Money). Post-IPO yield compression averages 30–80 bps for A-rated issuers. A strong Nifty raises IPO probability and accelerates the yield-compression trade.";
      return { value: v.toLocaleString(undefined, { maximumFractionDigits: 0 }), level, commentary, dir };
    }
    case "nifty_wk_pct": {
      const v = V.nifty_wk;
      if (v == null) return null;
      let level, dir;
      if (v > 0) { level = "green"; dir = "up"; }
      else if (v >= -2) { level = "amber"; dir = "flat"; }
      else { level = "red"; dir = "down"; }
      const commentary =
        "Short-term equity momentum. A >2% weekly drop historically correlates with 10–15 bps widening in AA NCD spreads within the following week, as mutual fund redemptions force selling across asset classes.";
      return { value: `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, level, commentary, dir };
    }
    case "ind_us_10y_spread": {
      const v = V.ind_us_spread;
      if (v == null) return null;
      let level, dir;
      if (v >= 4.5 && v <= 6) { level = "green"; dir = "up"; }
      else if ((v >= 3.5 && v < 4.5) || (v > 6 && v <= 6.5)) { level = "amber"; dir = "flat"; }
      else { level = "red"; dir = "down"; }
      const cmp = v > 5.2 ? "above" : v < 5.2 ? "below" : "at";
      const demand = v > 5.5 ? "Wide spread = foreign demand for Indian duration." : v < 4 ? "Narrow spread = domestic-only bid, slower spread compression." : "Spread in neutral band — flows are two-way.";
      const commentary =
        `The carry-trade signal. At ${v.toFixed(2)}%, this is ${cmp} the 5-year average of ~5.2%. ${demand}`;
      return { value: `${v.toFixed(2)}%`, level, commentary, dir };
    }
  }
  return null;
}

const CA_SIGNAL_KEYS = [
  ["Brent Crude", "brent"],
  ["DXY", "dxy"],
  ["USD/INR", "usdinr"],
  ["India VIX", "indiavix"],
  ["US VIX", "vix"],
  ["India 10Y G-Sec", "in10y"],
  ["US 10Y Treasury", "us10y"],
  ["Gold (XAU/USD)", "xauusd"],
  ["MCX Gold (₹/10g)", "mcx_gold_inr_10g"],
  ["Nifty 50", "nifty"],
  ["Nifty 5D Δ", "nifty_wk_pct"],
  ["India-US 10Y Spread", "ind_us_10y_spread"],
];

function renderSignalMatrix(V) {
  const body = document.getElementById("ca-signal-body");
  body.innerHTML = "";
  for (const [label, key] of CA_SIGNAL_KEYS) {
    const r = caClassifyAndComment(key, V);
    const tr = document.createElement("tr");
    if (r) tr.className = `lvl-${r.level}`;
    if (!r) {
      tr.innerHTML = `
        <td class="ca-name">${label}</td>
        <td class="ca-num">—</td>
        <td><span class="ca-level-badge lvl-amber">N/A</span></td>
        <td class="ca-commentary">Data unavailable.</td>
        <td class="ca-impact flat">→</td>
      `;
    } else {
      const arrow = r.dir === "up" ? "↑" : r.dir === "down" ? "↓" : "→";
      const dirCls = r.dir === "up" ? "up" : r.dir === "down" ? "down" : "flat";
      const lvlText = r.level === "green" ? "Supportive" : r.level === "red" ? "Stressed" : "Neutral";
      tr.innerHTML = `
        <td class="ca-name">${label}</td>
        <td class="ca-num">${r.value}</td>
        <td><span class="ca-level-badge lvl-${r.level}">${lvlText}</span></td>
        <td class="ca-commentary">${r.commentary}</td>
        <td class="ca-impact ${dirCls}">${arrow}</td>
      `;
    }
    body.appendChild(tr);
  }
}

// ---------- NBFC funding cost waterfall ----------

function renderWaterfall() {
  const root = document.getElementById("ca-waterfall");
  root.innerHTML = "";
  const rows = [
    { type: "anchor", label: "RBI Repo Rate", value: "5.25%" },
    { type: "head", label: "Funding sources" },
    { type: "add", label: "Bank lending spread to NBFCs (~150–200 bps)", value: "→ 6.75–7.25%" },
    { type: "add", label: "NCD primary issuance, AA (~200–250 bps over repo)", value: "→ 7.25–7.75%" },
    { type: "add", label: "NCD primary issuance, A (~300–400 bps over repo)", value: "→ 8.25–9.25%" },
    { type: "add", label: "CP, 90-day AA (~75–100 bps over repo)", value: "→ 6.00–6.25%" },
    { type: "total", label: "Blended NBFC borrowing cost (AA)", value: "~7.0–7.5%" },
    { type: "total", label: "Blended NBFC borrowing cost (A)", value: "~8.0–9.0%" },
    { type: "head", label: "Lending rates & NIM" },
    { type: "lend", label: "Gold loan lending rate", value: "12–18%   |   NIM 4–8%" },
    { type: "lend", label: "MFI lending rate", value: "20–24%   |   NIM 12–16%" },
    { type: "lend", label: "Consumer lending rate", value: "16–28%   |   NIM 8–18%" },
  ];
  for (const r of rows) {
    if (r.type === "head") {
      const h = document.createElement("div");
      h.className = "ca-wf-section-head";
      h.textContent = r.label;
      root.appendChild(h);
      continue;
    }
    const div = document.createElement("div");
    div.className = `ca-wf-row ca-wf-${r.type}`;
    div.innerHTML = `
      <span class="ca-wf-arrow">${r.type === "add" || r.type === "lend" ? "+" : "•"}</span>
      <span class="ca-wf-label">${r.label}</span>
      <span class="ca-wf-value">${r.value}</span>
    `;
    root.appendChild(div);
  }
}

// (legacy helper retained for backward compat)
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

const CA_RATE_CYCLE = [
  { date: "2023-02", repo: 6.50, cpi: 6.52 },
  { date: "2023-06", repo: 6.50, cpi: 4.81 },
  { date: "2023-12", repo: 6.50, cpi: 5.69 },
  { date: "2024-06", repo: 6.50, cpi: 5.08 },
  { date: "2024-12", repo: 6.50, cpi: 5.22 },
  { date: "2025-02", repo: 6.25, cpi: 4.31 },
  { date: "2025-04", repo: 6.00, cpi: 3.16 },
  { date: "2025-06", repo: 5.75, cpi: 3.54 },
  { date: "2025-08", repo: 5.50, cpi: 3.65 },
  { date: "2025-12", repo: 5.25, cpi: 3.40 },
  { date: "2026-02", repo: 5.25, cpi: 3.21 },
  { date: "2026-04", repo: 5.25, cpi: 3.48 },
];

let _caRateChart = null;
let _caRelativeChart = null;

function renderRateCycleChart() {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("ca-rate-chart");
  if (!ctx) return;
  const labels = CA_RATE_CYCLE.map((p) => p.date);
  const repo = CA_RATE_CYCLE.map((p) => p.repo);
  const cpi = CA_RATE_CYCLE.map((p) => p.cpi);
  if (_caRateChart) _caRateChart.destroy();
  _caRateChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "RBI Repo Rate",
          data: repo,
          borderColor: "#fbbf24",
          backgroundColor: "rgba(251, 191, 36, 0.12)",
          fill: true,
          tension: 0.1,
          pointBackgroundColor: "#fbbf24",
          pointBorderColor: "#0b0d12",
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
          borderWidth: 2.5,
          yAxisID: "y",
        },
        {
          label: "CPI YoY",
          data: cpi,
          borderColor: "#e6e9ef",
          backgroundColor: "rgba(230, 233, 239, 0.0)",
          borderDash: [6, 4],
          fill: false,
          tension: 0.1,
          pointBackgroundColor: "#e6e9ef",
          pointBorderColor: "#0b0d12",
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2,
          yAxisID: "y1",
        },
        {
          label: "CPI target (6%)",
          data: labels.map(() => 6),
          borderColor: "rgba(34, 197, 94, 0.45)",
          backgroundColor: "rgba(34, 197, 94, 0.06)",
          borderDash: [2, 3],
          borderWidth: 1,
          pointRadius: 0,
          fill: "+1",
          yAxisID: "y1",
        },
        {
          label: "CPI floor (2%)",
          data: labels.map(() => 2),
          borderColor: "rgba(34, 197, 94, 0.45)",
          backgroundColor: "rgba(34, 197, 94, 0)",
          borderDash: [2, 3],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#8a93a6",
            font: { family: "JetBrains Mono", size: 11 },
            filter: (item) => !item.text.startsWith("CPI target") && !item.text.startsWith("CPI floor"),
          },
        },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%`,
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
          position: "left",
          title: { display: true, text: "Repo Rate (%)", color: "#fbbf24", font: { family: "JetBrains Mono", size: 11 } },
          ticks: { color: "#fbbf24", font: { family: "JetBrains Mono", size: 11 }, callback: (v) => `${v}%` },
          grid: { color: "rgba(35, 42, 58, 0.6)" },
        },
        y1: {
          position: "right",
          title: { display: true, text: "CPI YoY (%)", color: "#e6e9ef", font: { family: "JetBrains Mono", size: 11 } },
          ticks: { color: "#e6e9ef", font: { family: "JetBrains Mono", size: 11 }, callback: (v) => `${v}%` },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

const CA_SCENARIOS = [
  {
    name: "Deep easing",
    prob: "15%",
    trigger: "CPI <3%, global slowdown",
    rate: "-75 bps",
    price: "+1.8%",
    spread: "Tighten 40–60 bps",
    action:
      "Maximum duration. Load 3–4Y A-rated NCDs. Best-case for performing credit.",
    row: "supportive",
  },
  {
    name: "Continued easing",
    prob: "40%",
    trigger: "CPI 3–4%, stable crude",
    rate: "-25 to -50 bps",
    price: "+0.6 to +1.2%",
    spread: "Tighten 15–30 bps",
    action:
      "Add duration gradually. Favour IPO-bound issuers (Indel, Fibe, KreditBee) for yield-compression kicker.",
    row: "supportive",
  },
  {
    name: "Extended pause",
    prob: "25%",
    trigger: "CPI 4–5%, crude $90–110",
    rate: "0 bps",
    price: "Carry only (10–11% coupon)",
    spread: "Stable",
    action:
      "Clip coupon. Focus on high-coupon short-duration NCDs. 10.5% on 2Y paper = attractive absolute return.",
    row: "",
  },
  {
    name: "Hawkish reversal",
    prob: "12%",
    trigger: "Oil shock >$130, INR >100",
    rate: "+50 to +75 bps",
    price: "-1.2 to -1.8%",
    spread: "Widen 30–60 bps",
    action:
      "Cut A-rated, move to AA secured. Shorten to <1.5Y. Avoid MFI names.",
    row: "cautious",
  },
  {
    name: "Stress event",
    prob: "8%",
    trigger: "Geopolitical escalation, global crisis",
    rate: "+100+ bps",
    price: "-2.4%+",
    spread: "Widen 75–150 bps",
    action:
      "Sell into any liquidity. Move to G-Sec / SDL / AAA. Check PONV triggers (ESAF). Review Kaabil covenant proximity.",
    row: "cautious",
  },
];

function renderScenarios(V) {
  const body = document.getElementById("ca-scenarios-body");
  body.innerHTML = "";
  for (const s of CA_SCENARIOS) {
    const tr = document.createElement("tr");
    if (s.row) tr.className = `row-${s.row}`;
    tr.innerHTML = `
      <td>${s.name}</td>
      <td class="ca-prob">${s.prob}</td>
      <td>${s.trigger}</td>
      <td>${s.rate}</td>
      <td>${s.price}</td>
      <td>${s.spread}</td>
      <td>${s.action}</td>
    `;
    body.appendChild(tr);
  }
  const foot = document.getElementById("ca-scenario-foot");
  const brent = V.brent != null ? `$${V.brent.toFixed(2)}` : "—";
  foot.textContent =
    `Current scenario assessment: CONTINUED EASING (40% probability) — supported by CPI ~3.48%, repo at 5.25%, and system liquidity in surplus. Primary risk factor: crude oil at ${brent}.`;
}

function renderRelativeValue(V) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("ca-relative-chart");
  if (!ctx) return;

  const rows = [
    { label: "SBI FD 1Y",              v: 6.5,  sweet: false },
    { label: "US 10Y Treasury",        v: V.us10y != null ? V.us10y : null, sweet: false },
    { label: "AAA PSU Bond 3Y",        v: 7.2,  sweet: false },
    { label: "India 10Y G-Sec",        v: V.in10y != null ? V.in10y : null, sweet: false },
    { label: "SDL 10Y",                v: 7.30, sweet: false },
    { label: "AA Corp Bond 3Y",        v: 8.5,  sweet: false },
    { label: "AA NBFC NCD 2Y",         v: 9.0,  sweet: true  },
    { label: "A+ NBFC NCD 2Y",         v: 10.0, sweet: true  },
    { label: "MeraDhan avg coupon",    v: 10.5, sweet: true  },
    { label: "A NBFC NCD 2Y",          v: 10.75, sweet: true },
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

function renderSectorRadar(V) {
  const root = document.getElementById("ca-sector-grid");
  root.innerHTML = "";

  const make = ({ cls, title, issuers, body, tag, tagText }) => {
    const c = document.createElement("div");
    c.className = `ca-sector-card ${cls}`;
    c.innerHTML = `
      <div class="ca-sector-title"></div>
      <div class="ca-sector-issuers"></div>
      <p class="ca-sector-body"></p>
      <span class="ca-sector-tag ${tag}"></span>
    `;
    c.querySelector(".ca-sector-title").textContent = title;
    c.querySelector(".ca-sector-issuers").textContent = issuers;
    c.querySelector(".ca-sector-body").textContent = body;
    c.querySelector(".ca-sector-tag").textContent = tagText;
    root.appendChild(c);
  };

  // 1. Gold-loan NBFCs
  const gold = V.xauusd;
  const mcx = V.mcxGold;
  const gold30 = V.gold_30d;
  let goldCls = "ok", goldTag = "ok", goldTagText = "Most defensive";
  let goldDetail =
    "Most defensive play in current environment. Benign gold prices provide LTV cushion while rate cuts lower borrowing cost.";
  if (gold30 != null && gold30 < -10) {
    goldCls = "stress"; goldTag = "stress"; goldTagText = "Auction risk elevated";
    goldDetail = "Sharp gold drop — reduce exposure and monitor auction trigger zone.";
  } else if (gold30 != null && Math.abs(gold30) > 5) {
    goldCls = "watch"; goldTag = "watch"; goldTagText = "Monitor LTV";
    goldDetail = "Monitor for gold correction risk; LTV cushion adequate but not generous.";
  }
  const cushion = gold == null ? "—" :
    gold30 != null && gold30 < -10 ? "thin" :
    gold30 != null && Math.abs(gold30) > 5 ? "adequate" : "healthy";
  const auctionRisk = gold30 != null && gold30 < -10 ? "elevated"
    : gold30 != null && Math.abs(gold30) > 5 ? "moderate" : "low";
  const goldStr = gold != null ? `$${gold.toFixed(0)}` : "—";
  const mcxStr = mcx != null ? `₹${mcx.toLocaleString("en-IN", { maximumFractionDigits: 0 })}/10g` : "—";
  make({
    cls: goldCls,
    title: "Gold-Loan NBFCs",
    issuers: "Muthoot · Indel · Kosamattam",
    body: `Gold at ${goldStr} (${mcxStr}). LTV cushion: ${cushion}. Auction risk: ${auctionRisk}. ${goldDetail}`,
    tag: goldTag,
    tagText: goldTagText,
  });

  // 2. Diversified NBFCs
  make({
    cls: "ok",
    title: "Diversified NBFCs",
    issuers: "Paisalo · Shriram",
    body:
      "Rate-cycle tailwind reducing funding costs. Bank credit to NBFCs strong at 26% YoY. Sector GNPA stable at 2.9%. Beneficiaries of rate cuts and credit demand — watch asset quality if growth stays >25% for an extended period.",
    tag: "ok",
    tagText: "Positive",
  });

  // 3. Small Finance Banks
  make({
    cls: "watch",
    title: "Small Finance Banks",
    issuers: "ESAF SFB",
    body:
      "SFB sector under asset-quality pressure. ESAF showing turnaround (PAT +₹24 Cr in Q4 FY26, GNPA improving to 5.41%). PONV clause remains a hard-override risk. Selective: maintain PONV monitoring. Underweight vs gold-loan NCDs.",
    tag: "watch",
    tagText: "Selective",
  });

  // 4. MFI / Consumer Lenders
  let mfiCls = "watch", mfiTag = "watch", mfiTagText = "Selective";
  if (V.indiavix != null && V.indiavix > 22) {
    mfiCls = "stress"; mfiTag = "stress"; mfiTagText = "Trim exposure";
  } else if (V.nifty != null && V.nifty > 23000 && V.indiavix != null && V.indiavix < 18) {
    mfiCls = "ok"; mfiTag = "ok"; mfiTagText = "Compelling carry";
  }
  make({
    cls: mfiCls,
    title: "MFI / Consumer Lenders",
    issuers: "CreditAccess · KreditBee · Fibe",
    body:
      "MFI sector collection efficiency recovering to ~96%. GNPA elevated at 4.1%. Karnataka ordinance impact fading. Consumer / BNPL growing but delinquency data opaque. Highest risk-reward in current environment — potential for 50–80 bps spread compression if turnaround holds, but downside severe if stress resurfaces. Position size accordingly.",
    tag: mfiTag,
    tagText: mfiTagText,
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
    xauusd: caGet(data, "xauusd"),
    mcxGold: caGet(data, "mcx_gold_inr_10g"),
    nifty: caGet(data, "nifty"),
    nifty_wk: caGet(data, "nifty_wk_pct"),
  };

  // Component 1: Regime banner
  const regime = caDetectRegime(V);
  const banner = document.getElementById("ca-regime");
  banner.className = `ca-regime ${regime.id}`;
  document.getElementById("ca-regime-pill").textContent = regime.label;
  document.getElementById("ca-regime-text").textContent = regime.text;
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  document.getElementById("ca-regime-meta").textContent =
    `Regime since: ${dateStr} · live cross-asset read`;

  // Component 2-3, 5, 7: data-driven sections (no chart deps)
  renderSignalMatrix(V);
  renderWaterfall();
  renderScenarios(V);
  renderSectorRadar(V);

  // Components 4, 6: charts (depend on Chart.js loaded with defer)
  const tryCharts = () => {
    if (typeof Chart === "undefined") {
      setTimeout(tryCharts, 100);
      return;
    }
    renderRateCycleChart();
    renderRelativeValue(V);
  };
  tryCharts();

  // Disclaimer timestamp
  const disc = document.getElementById("ca-disclaimer");
  if (data.updatedAt) {
    const d = new Date(data.updatedAt);
    const ts = d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    disc.textContent =
      `Analysis auto-generated from live market data. Not investment advice. Updated: ${ts}`;
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
refresh();
