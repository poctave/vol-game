// greeks-game.js — rules of the Options Lab GREEK modes. window.M1.lib.greeksGame.
// Pure logic; the view is the same terminal-options.js, which dispatches on the mode id.
//
//   gname    — a Greek's profile across spot (no scale). Type which Greek it is.
//   gdraw    — the Greek, the position, the tenor. Drag the profile into place.
//   gtenor   — a Greek WITH its scale. Type the time to expiry.
//   envelope — back-of-the-envelope ATM numbers (straddle, gamma, vega, theta, breakeven move).
//
// Runs share M1.options.runs with the strategy modes. Mastery ids: "g:<greek>" for the
// three graph modes, "e:<kind>" for the envelope.
(function () {
  "use strict";
  window.M1 = window.M1 || {};
  window.M1.lib = window.M1.lib || {};

  function GM() { return window.M1.lib.greeksMath; }

  var MODES = [
    { id: "gname", label: "NAME THE GREEK", glyph: "∂", blurb: "A Greek's profile across spot, scale hidden. Which one?" },
    { id: "gdraw", label: "DRAW THE GREEK", glyph: "✎", blurb: "Greek, option, tenor. Drag its profile into place." },
    { id: "gtenor", label: "GUESS THE MATURITY", glyph: "⧗", blurb: "A Greek with its scale. How long to expiry?" },
    { id: "envelope", label: "BACK OF THE ENVELOPE", glyph: "≈", blurb: "ATM straddle, gamma, vega, theta, breakeven — in your head." }
  ];
  function isGreekMode(id) { return MODES.some(function (m) { return m.id === id; }); }

  var VOL = 0.20, K = 100;
  var TENORS = [
    { id: "1w", days: 7, label: "1 week" }, { id: "2w", days: 14, label: "2 weeks" },
    { id: "1m", days: 30, label: "1 month" }, { id: "2m", days: 61, label: "2 months" },
    { id: "3m", days: 91, label: "3 months" }, { id: "6m", days: 182, label: "6 months" },
    { id: "1y", days: 365, label: "1 year" }
  ];
  function tenor(id) { return TENORS.filter(function (t) { return t.id === id; })[0]; }
  function years(t) { return t.days / 365; }

  var ENV = [
    { id: "straddle", label: "ATM straddle price", ask: "What does the ATM straddle cost?",
      rule: "Straddle ≈ 0.8 · S · σ · √T", unit: "" },
    { id: "call", label: "ATM call price", ask: "What does the ATM call cost?",
      rule: "ATM call ≈ 0.4 · S · σ · √T (half the straddle)", unit: "" },
    { id: "gamma", label: "ATM gamma", ask: "What is the ATM gamma (Δ per 1 point of spot)?",
      rule: "ATM gamma ≈ 0.4 / (S · σ · √T)", unit: "" },
    { id: "vega", label: "ATM vega", ask: "What is the ATM vega (value per vol point)?",
      rule: "ATM vega ≈ 0.4 · S · √T / 100", unit: "" },
    { id: "theta", label: "ATM theta", ask: "How much does the ATM call lose per day?",
      rule: "ATM theta/day ≈ 0.2 · S · σ / √T / 365 (= ½ · Γ · S² · σ² per year)", unit: "" },
    { id: "move", label: "Daily breakeven move", ask: "What daily move does a delta-hedged long straddle need to break even?",
      rule: "Breakeven move = S · σ / √365 ≈ S · σ / 19 — the one-day standard deviation", unit: "" }
  ];
  function envKind(id) { return ENV.filter(function (e) { return e.id === id; })[0]; }

  // ---------- typed Greek names ----------
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[∂/_\-.,]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function lev(a, b) { return levenshtein(a, b); }
  function levenshtein(a, b) {
    var prev = [], cur, i, k;
    for (k = 0; k <= b.length; k++) prev[k] = k;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (k = 1; k <= b.length; k++) cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // → { kind: "exact", id, fuzzy? } | { kind: "unknown" } | { kind: "empty" }
  function resolveGreek(text) {
    var q = norm(text);
    if (!q) return { kind: "empty" };
    var idx = [];
    GM().GREEKS.forEach(function (g) { g.names.forEach(function (n) { idx.push({ key: norm(n), id: g.id }); }); });
    for (var i = 0; i < idx.length; i++) if (idx[i].key === q) return { kind: "exact", id: idx[i].id };
    if (q.length < 5) return { kind: "unknown" };
    var best = Infinity, ids = {};
    idx.forEach(function (e) {
      var d = lev(q, e.key);
      if (d < best) { best = d; ids = {}; }
      if (d === best) ids[e.id] = 1;
    });
    var hit = Object.keys(ids);
    if (best <= 1 && hit.length === 1) return { kind: "exact", id: hit[0], fuzzy: true };
    return { kind: "unknown" };
  }

  // Gamma and vega draw the same bell (ν = Γ·S²·σ·T at zero rates): naming one for the
  // other scores, with the reason on the reveal. Everything else is distinguishable.
  var TWINS = { gamma: "vega", vega: "gamma" };

  // ---------- pools & deck ----------
  function greekPool(mode, prefs) {
    var off = prefs.gExcluded || [];
    return GM().GREEKS.filter(function (g) {
      if (off.indexOf(g.id) >= 0) return false;
      // maturity from a cross-Greek's scale is not a fair question
      if (mode === "gtenor" && g.tier !== 1) return false;
      return true;
    });
  }
  function envPool(prefs) {
    var off = prefs.envExcluded || [];
    return ENV.filter(function (e) { return off.indexOf(e.id) < 0; });
  }
  function poolSize(mode, prefs) { return mode === "envelope" ? envPool(prefs).length : greekPool(mode, prefs).length; }

  function pick(list, rand) { return list[Math.floor(rand() * list.length)]; }

  function makeDeck(mode, prefs, rand) {
    rand = rand || Math.random;
    var pool = mode === "envelope" ? envPool(prefs) : greekPool(mode, prefs);
    var bag = [], last = null;
    function refill() {
      bag = pool.slice();
      for (var i = bag.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = bag[i]; bag[i] = bag[j]; bag[j] = t; }
      if (bag.length > 1 && bag[bag.length - 1].id === last) { var t2 = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = t2; }
    }
    return {
      next: function () {
        if (!pool.length) return null;
        if (!bag.length) refill();
        var item = bag.pop();
        last = item.id;
        return deal(mode, item, prefs, rand);
      }
    };
  }

  function deal(mode, item, prefs, rand) {
    if (mode === "envelope") {
      var S = pick([20, 50, 80, 100, 150, 250, 400, 1000, 5000], rand);
      var vol = pick([0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.60], rand);
      var tn = tenor(pick(["1w", "1m", "3m", "6m", "1y"], rand));
      var a = GM().atm(item.id, S, vol, years(tn));
      return { mode: mode, mid: "e:" + item.id, kind: item.id, S: S, vol: vol, tenor: tn.id, exact: a.exact, rule: a.rule };
    }
    var types = prefs.gPuts === false ? ["C"] : ["C", "P"];
    var qs = mode !== "gtenor" && prefs.gShorts ? [1, -1] : [1];
    var tn2 = mode === "gtenor" ? pick(TENORS, rand) : tenor(pick(["1m", "3m", "6m"], rand));
    return {
      mode: mode, mid: "g:" + item.id, greek: item.id,
      opt: { t: pick(types, rand), q: pick(qs, rand), k: K },
      tenor: tn2.id, T: years(tn2), vol: VOL
    };
  }

  function positionText(q) {
    return (q.opt.q > 0 ? "Long " : "Short ") + q.opt.k + " " + (q.opt.t === "C" ? "call" : "put");
  }

  // ---------- grading ----------
  function gradeName(q, text) {
    var r = resolveGreek(text);
    if (r.kind === "empty") return { grade: "retry", msg: "Type a Greek." };
    if (r.kind === "unknown") return { grade: "retry", msg: "Not a Greek this game knows — delta, gamma, vega, theta, vanna, volga, charm." };
    if (r.id === q.greek) return { grade: "full", typed: r.id, fuzzy: !!r.fuzzy };
    if (TWINS[q.greek] === r.id) return { grade: "full", typed: r.id, twin: r.id };
    return { grade: "wrong", typed: r.id };
  }

  // Draw: handles across spot, symmetric scale sized to the true profile.
  var DRAW_XS = [70, 80, 90, 95, 100, 105, 110, 120, 130];
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= v - 1e-12) return steps[i] * mag;
    return 10 * mag;
  }
  function drawSpec(q) {
    var truth = GM().series(q.greek, q.opt, q.T, q.vol, DRAW_XS);
    var R = 0;
    // size the scale on the whole curve, not just the handles (a 1M gamma peaks between them)
    GM().series(q.greek, q.opt, q.T, q.vol, GM().grid(70, 130, 0.5)).forEach(function (v) { R = Math.max(R, Math.abs(v)); });
    var yMax = niceCeil(R * 1.15);
    return { xs: DRAW_XS.slice(), truth: truth, yMax: yMax, snap: yMax / 50, tol: yMax * 0.12 };
  }
  function gradeDraw(spec, ys) {
    var hits = 0;
    spec.xs.forEach(function (_x, i) { if (Math.abs((ys[i] || 0) - spec.truth[i]) <= spec.tol) hits++; });
    var n = spec.xs.length;
    return { grade: hits === n ? "full" : hits >= Math.ceil(n * 2 / 3) ? "partial" : "wrong", hits: hits, n: n };
  }

  // "3m", "2 weeks", "45d", "1y", "0.25y", "6 months" → days. A bare number has no unit: null.
  function parseTenor(text) {
    var m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-z]+)\s*$/i.exec(String(text || ""));
    if (!m) return null;
    var n = parseFloat(m[1].replace(",", ".")), u = m[2].toLowerCase();
    if (!(n > 0)) return null;
    if (/^(d|day|days)$/.test(u)) return n;
    if (/^(w|wk|wks|week|weeks)$/.test(u)) return n * 7;
    if (/^(m|mo|mos|mth|mths|month|months)$/.test(u)) return n * 365 / 12;
    if (/^(y|yr|yrs|year|years)$/.test(u)) return n * 365;
    return null;
  }
  // Within 30% = full, within ~2× = half (one tenor bucket off; 1m vs 2m is 2.005×).
  function gradeTenor(q, text) {
    var days = parseTenor(text);
    if (days == null) return { grade: "retry", msg: "Give a number and a unit — 2w, 45d, 3m, 1y." };
    var truth = tenor(q.tenor).days, r = Math.abs(Math.log(days / truth));
    return { grade: r <= Math.log(1.3) ? "full" : r <= Math.log(2.1) ? "partial" : "wrong", days: days };
  }

  function parseNumber(text) {
    var MQ = window.M1.lib.marketQuiz;
    if (MQ && MQ.parseGuess) return MQ.parseGuess(text);
    return parseFloat(String(text).replace(",", "."));
  }
  // Within 10% of exact = full, within 25% = half.
  function gradeEnvelope(q, text) {
    var v = parseNumber(text);
    if (isNaN(v)) return { grade: "retry", msg: "Type a number." };
    var off = Math.abs(v / q.exact - 1);
    return { grade: off <= 0.10 ? "full" : off <= 0.25 ? "partial" : "wrong", value: v, off: off };
  }

  function fmtNum(v) {
    var a = Math.abs(v);
    return a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : a === 0 ? "0" : String(+v.toPrecision(3));
  }

  // The reveal for gtenor: run the rule on the chart's own numbers.
  function tenorWorking(q) {
    var S = q.opt.k, v = q.vol, sT = Math.sqrt(q.T);
    if (q.greek === "delta") return "±1 sd = S·σ·√T = " + S + " × " + v + " × " + sT.toFixed(2) + " = " + (S * v * sT).toFixed(1) + " points: that is where delta reads 0.16 / 0.84.";
    if (q.greek === "gamma") return "Peak ≈ 0.4 / (" + S + " × " + v + " × " + sT.toFixed(2) + ") = " + fmtNum(0.4 / (S * v * sT)) + ".";
    if (q.greek === "vega") return "Peak ≈ 0.4 × " + S + " × " + sT.toFixed(2) + " / 100 = " + fmtNum(0.4 * S * sT / 100) + " per vol point.";
    if (q.greek === "theta") return "Trough ≈ −0.2 × " + S + " × " + v + " / " + sT.toFixed(2) + " / 365 = " + fmtNum(-0.2 * S * v / sT / 365) + " per day.";
    return "";
  }
  function envWorking(q) {
    var S = q.S, v = q.vol, sT = Math.sqrt(years(tenor(q.tenor)));
    var f = {
      straddle: "0.8 × " + S + " × " + v + " × " + sT.toFixed(3),
      call: "0.4 × " + S + " × " + v + " × " + sT.toFixed(3),
      gamma: "0.4 / (" + S + " × " + v + " × " + sT.toFixed(3) + ")",
      vega: "0.4 × " + S + " × " + sT.toFixed(3) + " / 100",
      theta: "0.2 × " + S + " × " + v + " / " + sT.toFixed(3) + " / 365",
      move: S + " × " + v + " / 19.1"
    }[q.kind];
    return f + " ≈ " + fmtNum(q.rule);
  }

  function itemName(mid) {
    if (/^g:/.test(mid)) { var g = GM().greek(mid.slice(2)); return g ? g.name : mid; }
    if (/^e:/.test(mid)) { var e = envKind(mid.slice(2)); return e ? e.label : mid; }
    return null;
  }

  window.M1.lib.greeksGame = {
    MODES: MODES, isGreekMode: isGreekMode, TENORS: TENORS, tenor: tenor, ENV: ENV, envKind: envKind,
    TWINS: TWINS, DRAW_XS: DRAW_XS,
    resolveGreek: resolveGreek, greekPool: greekPool, envPool: envPool, poolSize: poolSize,
    makeDeck: makeDeck, positionText: positionText,
    gradeName: gradeName, drawSpec: drawSpec, gradeDraw: gradeDraw,
    parseTenor: parseTenor, gradeTenor: gradeTenor, gradeEnvelope: gradeEnvelope,
    tenorWorking: tenorWorking, envWorking: envWorking, fmtNum: fmtNum, itemName: itemName
  };
})();
