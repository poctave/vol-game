// options-game.js — rules of the Options Lab game . window.M1.lib.optionsGame.
// Pure logic + persistence; the view (lib/views/terminal-options.js) only renders state.
//
// Four quiz modes, all typed or built — no multiple choice:
//   payoff — see the expiry P&L, type the strategy's name
//   greeks — see Δ Γ ν Θ and the premium (or just their signs), type the name
//   build  — given a name, assemble the legs
//   draw   — given the legs, drag the expiry P&L into place
// plus the LAB (free builder that names whatever you assemble).
//
// A typed answer that is a DIFFERENT strategy still scores when it is indistinguishable
// from the evidence on screen — iron butterfly for a butterfly payoff, short put for a
// covered call — because by put-call parity it is the same trade. The reveal says so.
//
// Storage: runs in M1.options.runs (capped, merged by `at` across devices — per-strategy
// mastery is derived from them, so it merges for free), preferences in M1.options.prefs.
(function () {
  "use strict";
  window.M1 = window.M1 || {};
  window.M1.lib = window.M1.lib || {};

  var RUNS_KEY = "M1.options.runs";
  var PREFS_KEY = "M1.options.prefs";
  var RUNS_CAP = 300;

  function M() { return window.M1.lib.optionsMath; }
  function D() { return window.M1.data.optionStrategies; }

  var MODES = [
    { id: "payoff", label: "NAME THE PAYOFF", glyph: "⌒", blurb: "An expiry P&L appears. Type the strategy." },
    { id: "greeks", label: "GREEKS DETECTIVE", glyph: "Δ", blurb: "Δ Γ ν Θ and the premium. Who is it?" },
    { id: "build", label: "BUILD IT", glyph: "⊕", blurb: "A name. Assemble the legs at any strikes that work." },
    { id: "draw", label: "DRAW THE PAYOFF", glyph: "✎", blurb: "The legs. Drag the expiry P&L into place." }
  ];

  // Bare words that name a family, not a trade. "straddle" for a long straddle earns a
  // nudge ("long or short?"), not the points.
  var FAMILIES = {
    "call": ["long-call", "short-call"], "put": ["long-put", "short-put"],
    "straddle": ["long-straddle", "short-straddle"], "strangle": ["long-strangle", "short-strangle"],
    "synthetic": ["synthetic-long", "synthetic-short"],
    "vertical": ["call-spread", "put-spread", "bull-put-spread", "bear-call-spread"],
    "vertical spread": ["call-spread", "put-spread", "bull-put-spread", "bear-call-spread"],
    "credit spread": ["bull-put-spread", "bear-call-spread"],
    "debit spread": ["call-spread", "put-spread"],
    "ratio spread": ["put-ratio", "call-ratio"], "ratio": ["put-ratio", "call-ratio"],
    "1x2": ["put-ratio", "call-ratio"], "1x2 spread": ["put-ratio", "call-ratio"],
    "spread": ["call-spread", "put-spread", "bull-put-spread", "bear-call-spread"]
  };

  // ---------- name matching ----------
  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/×/g, "x")
      .replace(/(\d)\s*(?:x|by)\s*(\d)/g, "$1x$2")    // "1 x 2", "1 by 2" → "1x2"
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(an|a|the|option|options|position|strategy)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length, prev = [], cur = [];
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur = [i];
      for (var k = 1; k <= n; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  var INDEX = null;
  function index() {
    if (INDEX) return INDEX;
    INDEX = [];
    D().strategies.forEach(function (s) {
      s.names.concat([s.name]).forEach(function (n) { INDEX.push({ key: norm(n), id: s.id }); });
    });
    return INDEX;
  }

  // → { kind: "exact", id } | { kind: "family", ids } | { kind: "unknown" } | { kind: "empty" }
  // Typos are forgiven (1 edit from 6 letters, 2 from 10) only when exactly one strategy
  // is that close — "strip" and "strap" are one letter apart and both real.
  function resolve(text) {
    var q = norm(text);
    if (!q) return { kind: "empty" };
    var idx = index(), i;
    for (i = 0; i < idx.length; i++) if (idx[i].key === q) return { kind: "exact", id: idx[i].id };
    if (FAMILIES[q]) return { kind: "family", ids: FAMILIES[q].slice() };
    var allowed = q.length >= 10 ? 2 : q.length >= 6 ? 1 : 0;
    if (!allowed) return { kind: "unknown" };
    var best = Infinity, ids = {};
    for (i = 0; i < idx.length; i++) {
      var d = lev(q, idx[i].key);
      if (d < best) { best = d; ids = {}; }
      if (d === best) ids[idx[i].id] = 1;
    }
    var hit = Object.keys(ids);
    if (best <= allowed && hit.length === 1) return { kind: "exact", id: hit[0], fuzzy: true };
    return { kind: "unknown" };
  }

  // ---------- pool ----------
  function strategies() { return D().strategies; }
  function poolFor(mode, prefs) {
    var tiers = prefs.tiers || [1, 2, 3], off = prefs.excluded || [];
    return strategies().filter(function (s) {
      if (tiers.indexOf(s.tier) < 0 || off.indexOf(s.id) >= 0) return false;
      if (mode === "draw" && s.noDraw) return false;
      return true;
    });
  }

  // Deal a strike set: mostly C2's own (so the reference numbers stay familiar), sometimes
  // shifted or re-winged so nobody wins by memorising one picture.
  function dealParams(s, rand) {
    rand = rand || Math.random;
    if (rand() < 0.4) return { c: s.def.c, w: s.def.w };
    var grid = M().paramGrid(s, { cs: [95, 100, 105], ws: [5, 10, 15] });
    if (!grid.length) return { c: s.def.c, w: s.def.w };
    return grid[Math.floor(rand() * grid.length)];
  }

  // A shuffle-bag deck: every strategy in the pool once before any repeats, never the same
  // one twice in a row across a bag boundary.
  function makeDeck(pool, rand) {
    rand = rand || Math.random;
    var bag = [], last = null;
    function refill() {
      bag = pool.slice();
      for (var i = bag.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1)), t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
      if (bag.length > 1 && last && bag[bag.length - 1].id === last) {
        var t2 = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = t2;
      }
    }
    return {
      next: function () {
        if (!pool.length) return null;
        if (!bag.length) refill();
        var s = bag.pop();
        last = s.id;
        var params = dealParams(s, rand);
        return { id: s.id, params: params, pos: M().instantiate(s, params) };
      }
    };
  }

  // ---------- grading ----------
  // Every grade: { grade: "full" | "partial" | "wrong" | "retry", msg, twin? }
  // "retry" = not scored (unknown name, or a bare family) — the view lets you type again.

  function gradeName(mode, q, text, opts) {
    opts = opts || {};
    var r = resolve(text);
    if (r.kind === "empty") return { grade: "retry", msg: "Type a strategy name." };
    if (r.kind === "unknown") return { grade: "retry", msg: "Not a strategy in the book — check the spelling." };
    if (r.kind === "family") {
      if (r.ids.indexOf(q.id) >= 0) return { grade: "retry", family: true, msg: "Close — be specific (long or short? which one?)." };
      return { grade: "wrong", typed: r.ids[0], msg: "Not that family." };
    }
    if (r.id === q.id) return { grade: "full", typed: r.id, fuzzy: !!r.fuzzy };
    // A different name that fits the evidence equally well is still right.
    var M_ = M(), pred = null;
    if (mode === "payoff") pred = function (p) { return M_.samePnl(p, q.pos); };
    else if (mode === "greeks" && opts.signsOnly) {
      var target = M_.signProfile(q.pos);
      pred = function (p) { return M_.sameSigns(M_.signProfile(p), target); };
    } else if (mode === "greeks") {
      var prem = M_.netPremium(q.pos);
      pred = function (p) { return M_.closeGreeks(p, q.pos) && Math.abs(M_.netPremium(p) - prem) < 0.006; };
    }
    if (pred && M_.canMatch(r.id, pred)) return { grade: "full", typed: r.id, twin: r.id };
    return { grade: "wrong", typed: r.id };
  }

  // Build: the legs must BE the strategy (classifier), or be a parity twin with the same
  // payoff shape (half credit — right trade, wrong instruments).
  function gradeBuild(q, legs) {
    var M_ = M(), pos = M_.normalize(legs || []);
    if (!pos.length) return { grade: "retry", msg: "Add some legs first." };
    var ids = M_.classify(pos);
    if (ids.indexOf(q.id) >= 0) return { grade: "full", built: q.id };
    var target = M_.strategy(q.id);
    var shapeTwin = M_.canMatch(q.id, function (p) { return M_.sameShape(p, pos); });
    if (shapeTwin) {
      return { grade: "partial", built: ids[0] || null, msg: "Right payoff shape, different instruments — " +
        "a parity twin. The book builds a " + target.name.toLowerCase() + " differently." };
    }
    return { grade: "wrong", built: ids[0] || null };
  }

  // ---------- draw ----------
  // Handles sit at the chart edges and at every strike: the expiry P&L is a straight line
  // between them, so those heights ARE the payoff.
  var DRAW_LO = 70, DRAW_HI = 130;
  function drawSpec(pos, inclPremium) {
    var M_ = M();
    var xs = [DRAW_LO].concat(M_.strikesOf(pos).filter(function (k) { return k > DRAW_LO && k < DRAW_HI; }), [DRAW_HI]);
    var truth = xs.map(function (x) {
      return inclPremium ? M_.pnlAtExpiry(pos, x) : M_.intrinsicAtExpiry(pos, x);
    });
    var R = 0;
    truth.forEach(function (v) { R = Math.max(R, Math.abs(v)); });
    var steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
    var yMax = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= R * 1.2 + 1) { yMax = steps[i]; break; }
    var snap = yMax <= 20 ? 0.5 : 1;
    // With the premium in, the player prices the legs in their head (the prompt names only
    // the trade), so the band is wider than for the pure payoff.
    var tol = inclPremium ? Math.max(1.0, yMax * 0.06) : Math.max(0.6, yMax * 0.04);
    return { xs: xs, truth: truth, yMax: yMax, snap: snap, tol: tol };
  }

  // "100/85 put spread", "85/95/105/115 iron condor", "105 covered call": the trade as a
  // desk would say it — strikes in the order the legs are written, then the name.
  function tradeLabel(q) {
    var ks = [];
    q.pos.forEach(function (l) { if (l.t !== "S" && ks.indexOf(l.k) < 0) ks.push(l.k); });
    return (ks.length ? ks.join("/") + " " : "") + M().strategy(q.id).name.toLowerCase();
  }
  function gradeDraw(spec, ys) {
    var hits = 0, off = [];
    spec.xs.forEach(function (_x, i) {
      var d = Math.abs((ys[i] || 0) - spec.truth[i]);
      off.push(d);
      if (d <= spec.tol) hits++;
    });
    var n = spec.xs.length;
    var grade = hits === n ? "full" : hits >= Math.ceil(n / 2) ? "partial" : "wrong";
    return { grade: grade, hits: hits, n: n, off: off };
  }

  // ---------- hints ----------
  // A hint caps the answer at half points (the view downgrades a "full" to "partial").
  // Name modes (payoff, greeks): four choices — the answer plus three strategies that are
  // NOT also right on the evidence shown (a parity twin would be a second correct answer),
  // drawn from those closest in leg count and tier so the choice still takes thought.
  function shuffle(a, rand) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function hintChoices(mode, q, opts, rand) {
    rand = rand || Math.random;
    var me = M().strategy(q.id);
    var cands = strategies().filter(function (s) {
      return s.id !== q.id && gradeName(mode, q, s.name, opts).grade === "wrong";
    }).map(function (s) {
      return { s: s, d: Math.abs(s.legs.length - me.legs.length) + 0.5 * Math.abs(s.tier - me.tier) + 1.5 * rand() };
    });
    cands.sort(function (a, b) { return a.d - b.d; });
    var out = cands.slice(0, 3).map(function (c) { return { label: c.s.name, value: c.s.name }; });
    out.push({ label: me.name, value: me.name });
    return shuffle(out, rand);
  }
  // Build mode: what kinds of legs the textbook version uses, not their sides or strikes.
  function legHint(q) {
    var n = { C: 0, P: 0, S: 0 };
    q.pos.forEach(function (l) { n[l.t] += Math.abs(l.q); });
    var parts = [];
    if (n.C) parts.push(n.C + " call" + (n.C > 1 ? "s" : ""));
    if (n.P) parts.push(n.P + " put" + (n.P > 1 ? "s" : ""));
    if (n.S) parts.push(n.S + " share" + (n.S > 1 ? "s" : "") + " of stock");
    var fronts = q.pos.some(function (l) { return l.exp === "F"; });
    return parts.join(" + ") + (fronts ? " · two maturities" : "");
  }

  // ---------- scoring ----------
  // 100 for a clean answer, 50 for partial. A streak of clean answers adds +10 per link,
  // capped at +50.
  function score(grade, streakBefore) {
    if (grade === "wrong") return 0;
    if (grade === "partial") return 50;
    return 100 + 10 * Math.min(5, streakBefore || 0);
  }

  // ---------- persistence ----------
  function ls() { try { return window.localStorage || null; } catch (_e) { return null; } }
  function readJson(key, dflt) {
    var s = ls();
    if (!s) return dflt;
    try { var v = JSON.parse(s.getItem(key)); return v == null ? dflt : v; } catch (_e) { return dflt; }
  }
  function writeJson(key, v) {
    var s = ls();
    if (!s) return;
    try { s.setItem(key, JSON.stringify(v)); } catch (_e) {}
  }

  // g*/env* drive the Greek modes (greeksGame): excluded Greeks, puts and short positions
  // in the deal, excluded back-of-the-envelope kinds. Advanced cross Greeks start off.
  var DEFAULT_PREFS = { mode: "payoff", format: 10, tiers: [1, 2], excluded: [], signsOnly: false, inclPremium: true,
    gExcluded: ["vanna", "volga", "charm"], gPuts: true, gShorts: false, envExcluded: [],
    // MIXED runs deal each question from one of these modes, at random
    mix: ["payoff", "greeks", "build", "gname", "envelope"] };
  function loadPrefs() {
    var p = readJson(PREFS_KEY, {}), out = {};
    Object.keys(DEFAULT_PREFS).forEach(function (k) { out[k] = p[k] != null ? p[k] : DEFAULT_PREFS[k]; });
    if (!Array.isArray(out.tiers)) out.tiers = DEFAULT_PREFS.tiers.slice();
    ["excluded", "gExcluded", "envExcluded", "mix"].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = DEFAULT_PREFS[k].slice();
    });
    return out;
  }
  function savePrefs(p) { writeJson(PREFS_KEY, p); }

  function loadRuns() {
    var r = readJson(RUNS_KEY, []);
    return Array.isArray(r) ? r : [];
  }
  // run: { at, mode, format, n, correct, partial, points, bestStreak, durationSec, per: [{id, g}] }
  function saveRun(run) {
    var runs = loadRuns();
    runs.push(run);
    if (runs.length > RUNS_CAP) runs = runs.slice(runs.length - RUNS_CAP);
    writeJson(RUNS_KEY, runs);
  }

  // Per-strategy hit rate across every run (full = 1, partial = ½).
  function mastery() {
    var out = {};
    loadRuns().forEach(function (r) {
      (r.per || []).forEach(function (e) {
        var m = out[e.id] || (out[e.id] = { seen: 0, ok: 0 });
        m.seen++;
        m.ok += e.g === "full" ? 1 : e.g === "partial" ? 0.5 : 0;
      });
    });
    Object.keys(out).forEach(function (id) { out[id].rate = out[id].ok / out[id].seen; });
    return out;
  }

  function bestFor(mode, format) {
    var best = null;
    loadRuns().forEach(function (r) {
      if (r.mode === mode && String(r.format) === String(format) && (best == null || r.points > best)) best = r.points;
    });
    return best;
  }

  function summary() {
    var runs = loadRuns(), m = mastery();
    var answered = 0, ok = 0;
    runs.forEach(function (r) { answered += r.n || 0; ok += (r.correct || 0) + 0.5 * (r.partial || 0); });
    // the strategy book only — Greek ("g:") and envelope ("e:") items have their own board
    var mastered = Object.keys(m).filter(function (id) {
      return /^[a-z0-9-]+$/.test(id) && m[id].seen >= 3 && m[id].rate >= 0.8;
    }).length;
    var bestStreak = 0;
    runs.forEach(function (r) { bestStreak = Math.max(bestStreak, r.bestStreak || 0); });
    return {
      runs: runs.length, answered: answered,
      accuracy: answered ? ok / answered : null,
      mastered: mastered, total: strategies().length,
      bestStreak: bestStreak,
      last: runs.length ? runs[runs.length - 1] : null
    };
  }

  // The OPS frame's cross-module ledger reads this shape (startedAt, durationSec, mode).
  function loadHistory() {
    return loadRuns().map(function (r) {
      return { startedAt: r.at, durationSec: r.durationSec || 0, mode: r.mode, accuracy: r.n ? ((r.correct || 0) + 0.5 * (r.partial || 0)) / r.n : 0, points: r.points || 0 };
    });
  }
  function sessionXp(s) { return Math.round((s.points || 0) / 20); }

  // Rank titles by career points — a desk ladder, for the setup screen's flavour line.
  var RANKS = [
    [0, "INTERN"], [1500, "ANALYST"], [5000, "ASSOCIATE"], [12000, "VOL TRADER"],
    [25000, "HEAD OF EXOTICS"], [50000, "GAMMA GOD"]
  ];
  function rank() {
    var pts = 0;
    loadRuns().forEach(function (r) { pts += r.points || 0; });
    var cur = RANKS[0], next = null;
    for (var i = 0; i < RANKS.length; i++) {
      if (pts >= RANKS[i][0]) { cur = RANKS[i]; next = RANKS[i + 1] || null; }
    }
    return { points: pts, title: cur[1], next: next ? { at: next[0], title: next[1] } : null, floor: cur[0] };
  }

  window.M1.lib.optionsGame = {
    MODES: MODES, FAMILIES: FAMILIES, DRAW_LO: DRAW_LO, DRAW_HI: DRAW_HI,
    norm: norm, resolve: resolve,
    poolFor: poolFor, dealParams: dealParams, makeDeck: makeDeck,
    hintChoices: hintChoices, legHint: legHint,
    gradeName: gradeName, gradeBuild: gradeBuild, drawSpec: drawSpec, tradeLabel: tradeLabel, gradeDraw: gradeDraw, score: score,
    loadPrefs: loadPrefs, savePrefs: savePrefs, loadRuns: loadRuns, saveRun: saveRun,
    mastery: mastery, bestFor: bestFor, summary: summary, rank: rank,
    loadHistory: loadHistory, sessionXp: sessionXp,
    _keys: { runs: RUNS_KEY, prefs: PREFS_KEY }
  };
})();
