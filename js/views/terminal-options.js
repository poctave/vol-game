// terminal-options.js — #/terminal/options: the Options Lab game, one console route with an
// internal setup → play → results machine (same shape as terminal-market.js), plus the LAB
// sandbox: build anything, see its payoff and Greeks, get it named.
//
// Logic lives in optionsGame (rules, grading, storage) and optionsMath (pricing, payoff,
// classifier). This file renders state and wires input — including the draggable payoff
// chart of the DRAW mode, which updates its SVG in place while dragging (a full re-render
// would drop the pointer capture mid-drag) and re-renders once on release.
//
// State is module-scoped: the frame remounts on focus / storage, and a remount must
// not eat a half-typed answer or a half-built position.
(function () {
  "use strict";
  function F() { return window.M1.lib.terminalFrame; }
  function G() { return window.M1.lib.optionsGame; }
  function GG() { return window.M1.lib.greeksGame; }
  function GM() { return window.M1.lib.greeksMath; }
  function M() { return window.M1.lib.optionsMath; }
  function LV() { return window.M1.lib.optionsLabView; }
  function D() { return window.M1.data.optionStrategies; }
  function esc(s) { return F().esc(s); }

  var LIVES = 3;
  var state = null;

  function freshState() {
    return {
      screen: "setup",      // setup | play | done | lab
      prefs: G().loadPrefs(),
      showBook: false,      // the per-strategy include/exclude list is folded by default
      decks: null, modes: null, qmode: null, q: null, qn: 0,
      input: "", note: null, revealed: false, res: null,
      legs: [],             // build mode
      draw: null,           // draw mode: { spec, ys, sel }
      streak: 0, bestStreak: 0, points: 0, lastPts: 0, lives: LIVES,
      answers: [], startedAt: 0, elapsed: 0, newBest: false
    };
  }

  function strat(id) { return M().strategy(id); }
  function fmtClock(sec) { var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function sgnStr(v, dp) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dp); }
  // MIXED is a meta-mode: each question is dealt from one of the ticked modes (prefs.mix).
  var MIX = { id: "mix", label: "MIXED", glyph: "⁂", blurb: "Tick any modes below — every question is dealt from one of them." };
  function allModes() { return G().MODES.concat(GG().MODES); }
  function modeDef(id) { return id === "mix" ? MIX : allModes().filter(function (m) { return m.id === id; })[0]; }
  // The mode of the question on screen (differs per question in a MIXED run), else the chosen one.
  function qm() { return (state.screen === "play" && state.qmode) || state.prefs.mode; }
  function isGreek(mode) { return GG().isGreekMode(mode || qm()); }
  function isDrawMode() { return qm() === "draw" || qm() === "gdraw"; }
  function modePool(mode) { return GG().isGreekMode(mode) ? GG().poolSize(mode, state.prefs) : G().poolFor(mode, state.prefs).length; }
  // Modes a MIXED run can actually deal from (ticked and with a non-empty pool).
  function mixModes() {
    return allModes().map(function (m) { return m.id; }).filter(function (id) {
      return state.prefs.mix.indexOf(id) >= 0 && modePool(id) > 0;
    });
  }
  function poolCount() { return state.prefs.mode === "mix" ? mixModes().length : modePool(state.prefs.mode); }
  // display name of any mastery id: a strategy, "g:<greek>" or "e:<envelope kind>"
  function itemName(id) { var s = strat(id); return s ? s.name : (GG().itemName(id) || id); }
  function isSurvival() { return state.prefs.format === "survival"; }

  // ======================================================================
  // payoff chart (inline SVG)
  // ======================================================================
  var LEG_COLORS = ["var(--t-purple)", "var(--t-amber)", "var(--t-src-mental-math)", "var(--t-src-classes)", "var(--t-src-masters)"];
  var chartSeq = 0;

  function niceStep(range) {
    var raw = range / 4, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  // opts: { lo, hi, legs, today, yMax (symmetric fixed), user: [ys] + xs (draw), truth, handles,
  //         hideCurve, ghost (second position drawn faint), compact }
  function chart(pos, opts) {
    opts = opts || {};
    var Mm = M(), W = 600, H = opts.compact ? 190 : 250, L = 40, R = 12, T = 12, B = 24;
    var lo = opts.lo != null ? opts.lo : 70, hi = opts.hi != null ? opts.hi : 130;
    var xs = [];
    for (var x = lo; x <= hi + 1e-9; x += 0.5) xs.push(x);
    var exp = pos && pos.length ? xs.map(function (v) { return Mm.pnlAtExpiry(pos, v); }) : [];
    var tod = opts.today && pos && pos.length ? xs.map(function (v) { return Mm.pnlToday(pos, v); }) : [];
    var ghost = opts.ghost ? xs.map(function (v) { return Mm.pnlAtExpiry(opts.ghost, v); }) : [];

    var yMin, yMax;
    if (opts.yMax) { yMin = -opts.yMax; yMax = opts.yMax; }
    else {
      var all = [0].concat(exp, tod, ghost);
      yMin = Math.min.apply(null, all); yMax = Math.max.apply(null, all);
      var pad = Math.max(1, (yMax - yMin) * 0.12);
      yMin -= pad; yMax += pad;
    }
    var sx = function (v) { return L + (v - lo) / (hi - lo) * (W - L - R); };
    var sy = function (v) { return T + (yMax - v) / (yMax - yMin) * (H - T - B); };
    var line = function (vals) {
      return vals.map(function (v, i) { return sx(xs[i]).toFixed(1) + "," + sy(v).toFixed(1); }).join(" ");
    };
    var id = "oc" + (++chartSeq);
    var out = '<svg class="opt-svg' + (opts.handles ? " is-draw" : "") + '" viewBox="0 0 ' + W + " " + H +
      '" preserveAspectRatio="xMidYMid meet" data-lo="' + lo + '" data-hi="' + hi + '" data-ymin="' + yMin +
      '" data-ymax="' + yMax + '" data-l="' + L + '" data-r="' + R + '" data-t="' + T + '" data-b="' + B + '">';

    // grid + axes
    var step = niceStep(yMax - yMin);
    for (var g = Math.ceil(yMin / step) * step; g <= yMax + 1e-9; g += step) {
      var gy = sy(g).toFixed(1);
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" style="stroke:var(--t-line);" stroke-width="1"/>' +
        '<text x="' + (L - 5) + '" y="' + (+gy + 3) + '" text-anchor="end" class="opt-ax">' + (Math.abs(g) < 1e-9 ? "0" : +g.toFixed(1)) + '</text>';
    }
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(0).toFixed(1) + '" y2="' + sy(0).toFixed(1) + '" style="stroke:var(--t-dim);" stroke-width="1"/>';
    var spotX = sx(D().spot).toFixed(1);
    out += '<line x1="' + spotX + '" x2="' + spotX + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--t-line2);" stroke-dasharray="2 4" stroke-width="1"/>';
    var ks = pos && pos.length ? Mm.strikesOf(pos)
      : opts.handles ? opts.handles.xs.slice() : [];
    var labels = {};
    ks.forEach(function (k) { labels[k] = 1; });
    labels[D().spot] = labels[D().spot] || 2;
    Object.keys(labels).forEach(function (k) {
      k = +k;
      if (k < lo || k > hi) return;
      var kx = sx(k).toFixed(1);
      out += '<line x1="' + kx + '" x2="' + kx + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" style="stroke:var(--t-dim);" stroke-width="1"/>' +
        '<text x="' + kx + '" y="' + (H - 6) + '" text-anchor="middle" class="opt-ax' + (labels[k] === 1 ? " is-k" : "") + '">' + k + '</text>';
    });

    // Everything data-driven is clipped to the plot box: single legs (a short call alone
    // runs to −30 across the window) must not spill over the axes or out of the panel.
    out += '<clipPath id="' + id + 'p"><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/></clipPath>' +
      '<g clip-path="url(#' + id + 'p)">';

    // profit / loss shading under the expiry curve
    if (exp.length && !opts.hideCurve) {
      var z = sy(0);
      var poly = sx(xs[0]).toFixed(1) + "," + z.toFixed(1) + " " + line(exp) + " " + sx(xs[xs.length - 1]).toFixed(1) + "," + z.toFixed(1);
      out += '<clipPath id="' + id + 'u"><rect x="0" y="0" width="' + W + '" height="' + z.toFixed(1) + '"/></clipPath>' +
        '<clipPath id="' + id + 'd"><rect x="0" y="' + z.toFixed(1) + '" width="' + W + '" height="' + (H - z).toFixed(1) + '"/></clipPath>' +
        '<polygon points="' + poly + '" clip-path="url(#' + id + 'u)" style="fill:var(--t-green);" fill-opacity="0.10"/>' +
        '<polygon points="' + poly + '" clip-path="url(#' + id + 'd)" style="fill:var(--t-red);" fill-opacity="0.10"/>';
    }

    // individual legs at expiry (each with its own premium), faint
    if (opts.legs && pos) {
      var hz = Mm.horizon(pos);   // read every leg when the position is read (calendar: front expiry)
      Mm.normalize(pos).forEach(function (l, i) {
        var vals = xs.map(function (v) { return Mm.pnl([l], v, hz); });
        out += '<polyline points="' + line(vals) + '" fill="none" style="stroke:' + LEG_COLORS[i % LEG_COLORS.length] +
          ';" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>';
      });
    }
    if (ghost.length) {
      out += '<polyline points="' + line(ghost) + '" fill="none" style="stroke:var(--t-dim);" stroke-width="1.5" stroke-dasharray="5 4"/>';
    }
    if (tod.length) {
      out += '<polyline points="' + line(tod) + '" fill="none" style="stroke:var(--t-amber);" stroke-width="1.3" stroke-dasharray="6 4"/>';
    }
    if (exp.length && !opts.hideCurve) {
      out += '<polyline points="' + line(exp) + '" fill="none" style="stroke:' + (opts.stroke || "var(--t-blue)") + ';" stroke-width="2.2"/>';
    }

    out += '</g>';

    // draw mode: the user's polyline + handles (and the truth once revealed)
    if (opts.handles) {
      var hx = opts.handles.xs, hy = opts.handles.ys;
      if (opts.handles.truth) {
        out += '<polyline points="' + hx.map(function (v, i) { return sx(v).toFixed(1) + "," + sy(opts.handles.truth[i]).toFixed(1); }).join(" ") +
          '" fill="none" style="stroke:var(--t-green);" stroke-width="2.2"/>';
      }
      out += '<polyline class="opt-user" points="' + hx.map(function (v, i) { return sx(v).toFixed(1) + "," + sy(hy[i]).toFixed(1); }).join(" ") +
        '" fill="none" style="stroke:var(--t-blue);" stroke-width="2.2"' + (opts.handles.truth ? ' stroke-dasharray="5 3"' : '') + '/>';
      hx.forEach(function (v, i) {
        var bad = opts.handles.truth && Math.abs(hy[i] - opts.handles.truth[i]) > opts.handles.tol;
        var sel = !opts.handles.truth && opts.handles.sel === i;
        out += '<circle class="opt-h" data-h="' + i + '" cx="' + sx(v).toFixed(1) + '" cy="' + sy(hy[i]).toFixed(1) +
          '" r="' + (sel ? 8 : 6) + '" style="fill:' + (bad ? "var(--t-red)" : opts.handles.truth ? "var(--t-green)" : "var(--t-blue)") +
          ';stroke:var(--t-bg);" stroke-width="2"/>' +
          '<text class="opt-hv" data-hv="' + i + '" x="' + sx(v).toFixed(1) + '" y="' + (sy(hy[i]) - 12).toFixed(1) +
          '" text-anchor="middle">' + (+hy[i].toFixed(1)) + '</text>';
      });
    }
    return out + '</svg>';
  }

  function chartLegend(opts) {
    var items = [];
    if (opts.expiry !== false) items.push('<span><i style="background:var(--t-blue);"></i>expiry P&amp;L</span>');
    if (opts.today) items.push('<span><i class="dash" style="border-color:var(--t-amber);"></i>today</span>');
    if (opts.legs) items.push('<span><i class="dash" style="border-color:var(--t-purple);"></i>each leg</span>');
    if (opts.truth) items.push('<span><i style="background:var(--t-green);"></i>true payoff</span>');
    if (opts.ghost) items.push('<span><i class="dash" style="border-color:var(--t-dim);"></i>' + esc(opts.ghost) + '</span>');
    return '<div class="opt-legend td">' + items.join("") + '</div>';
  }

  // ======================================================================
  // shared readouts
  // ======================================================================
  function greekTiles(pos, signsOnly) {
    var Mm = M(), g = Mm.greeks(pos), sp = Mm.signProfile(pos), prem = Mm.netPremium(pos);
    function tile(sym, label, val, dp, s) {
      var cls = s > 0 ? "tg" : s < 0 ? "tr" : "td";
      var big = signsOnly ? (s > 0 ? "+" : s < 0 ? "−" : "≈0") : sgnStr(val, dp);
      return '<div class="opt-gt"><div class="gs">' + sym + '</div><div class="gv ' + cls + '">' + big + '</div>' +
        '<div class="gl td">' + label + '</div></div>';
    }
    var pcls = sp.premium > 0 ? "ta" : sp.premium < 0 ? "tg" : "td";
    var ptxt = sp.premium === 0 ? "≈ 0" : (sp.premium > 0 ? "PAY" : "RECEIVE") + (signsOnly ? "" : " " + Math.abs(prem).toFixed(2));
    return '<div class="opt-greeks">' +
      tile("Δ", "delta", g.delta, 2, sp.delta) + tile("Γ", "gamma", g.gamma, 3, sp.gamma) +
      tile("ν", "vega /pt", g.vega, 2, sp.vega) + tile("Θ", "theta /day", g.theta, 3, sp.theta) +
      '<div class="opt-gt opt-prem"><div class="gs">$</div><div class="gv ' + pcls + '">' + ptxt + '</div>' +
      '<div class="gl td">net premium' + (Mm.hasStock(pos) && !signsOnly ? " · + stock" : "") + '</div></div>' +
    '</div>';
  }

  function fmtExt(v) { return v === Infinity ? "unlimited" : v === -Infinity ? "unlimited" : sgnStr(v, 1); }

  function statsLine(pos) {
    var Mm = M(), e = Mm.extremes(pos), be = Mm.breakevens(pos);
    return '<div class="opt-facts">' +
      '<span><span class="td">MAX GAIN</span> <span class="tg">' + fmtExt(e.maxGain) + '</span></span>' +
      '<span><span class="td">MAX LOSS</span> <span class="tr">' + fmtExt(e.maxLoss) + '</span></span>' +
      '<span><span class="td">BREAKEVEN' + (be.length === 1 ? "" : "S") + '</span> <span class="tw">' + (be.length ? be.join(" · ") : "—") + '</span></span>' +
    '</div>';
  }

  function legsList(pos) {
    return '<div class="opt-leglist">' + M().normalize(pos).map(function (l) {
      return '<div class="' + (l.q > 0 ? "lg-long" : "lg-short") + '">' + esc(M().describeLeg(l)) + '</div>';
    }).join("") + '</div>';
  }


  // ======================================================================
  // setup
  // ======================================================================
  function renderSetup() {
    var panel = F().panel, P = state.prefs, g = G();
    var poolN = poolCount();

    function modeBtns(list) {
      return list.map(function (m) {
        var on = P.mode === m.id;
        return '<button class="mkt-modebtn opt-modebtn' + (on ? " is-on" : "") + '" data-mode="' + m.id + '">' +
          '<span class="mm-l"><span class="opt-glyph">' + m.glyph + '</span> ' + esc(m.label) + '</span>' +
          '<span class="mm-s td">' + esc(m.blurb) + '</span></button>';
      }).join("");
    }
    var modeBody = '<div class="mkt-mode"><div class="opt-modegrp td">STRATEGIES</div>' + modeBtns(g.MODES) +
      '<div class="opt-modegrp td">GREEKS</div>' + modeBtns(GG().MODES) +
      '<div class="opt-modegrp td">BOTH</div>' + modeBtns([MIX]) + '</div>';

    var variant = "";
    if (P.mode === "mix") {
      variant = '<div class="opt-mix">' + allModes().map(function (m) {
        var on = P.mix.indexOf(m.id) >= 0, empty = modePool(m.id) === 0;
        return '<label class="opt-bk' + (on ? " is-on" : "") + '"><input type="checkbox" data-mix="' + m.id + '"' + (on ? " checked" : "") + '>' +
          '<span class="grow"><span class="opt-glyph">' + m.glyph + '</span> ' + esc(m.label) + '</span>' +
          (on && empty ? '<span class="tr">empty pool</span>' : '') + '</label>';
      }).join("") + '</div>';
    } else if (P.mode === "greeks") {
      variant = seg("SHOW", [["0", "NUMBERS"], ["1", "SIGNS ONLY"]], P.signsOnly ? "1" : "0", "data-signs");
    } else if (P.mode === "draw") {
      variant = seg("PREMIUM", [["1", "INCLUDED"], ["0", "EXCLUDED"]], P.inclPremium ? "1" : "0", "data-prem");
    }
    var fmt = seg("LENGTH", [["5", "5"], ["10", "10"], ["20", "20"], ["survival", "SURVIVAL ♥♥♥"]], String(P.format), "data-format");
    var best = g.bestFor(P.mode, P.format);
    var startLabel = "START — " + (isSurvival() ? "SURVIVAL" : P.format + " QUESTIONS");
    var go = '<div class="mkt-go">' +
      '<button class="play-btn pri mkt-start" data-start="1"' + (poolN ? "" : " disabled") + '>' + esc(startLabel) + '</button>' +
      '<div class="td mkt-gohint">' + (poolN ? poolN + (P.mode === "mix" ? " modes in the mix" : isGreek() ? (P.mode === "envelope" ? " question kinds" : " Greeks") : " strategies") + " in the pool"
        : "pool is empty — tick something in the next panel") +
        ' · best here <span class="tw">' + (best == null ? "—" : best + " pts") + '</span>' +
        ' · 100/answer · streaks pay +10 a link' + (isSurvival() ? " · three strikes and you are out" : "") + '</div>' +
    '</div>';

    // the book: tiers + per-strategy toggles
    var mas = g.mastery(), stratN = g.poolFor("payoff", P).length;
    var tiers = [1, 2, 3].map(function (t) {
      var on = P.tiers.indexOf(t) >= 0;
      var n = D().strategies.filter(function (s) { return s.tier === t; }).length;
      return '<label class="play-set mkt-cat' + (on ? " is-on" : "") + '">' +
        '<input type="checkbox" data-tier="' + t + '"' + (on ? " checked" : "") + '>' +
        '<span class="grow">' + D().tiers[t] + ' <span class="tf">· ' + tierBlurb(t) + '</span></span>' +
        '<span class="td">' + n + '</span></label>';
    }).join("");
    var list = "";
    if (state.showBook) {
      list = '<div class="opt-book">' + D().strategies.map(function (s) {
        var tierOn = P.tiers.indexOf(s.tier) >= 0, on = tierOn && P.excluded.indexOf(s.id) < 0;
        var m = mas[s.id];
        return '<label class="opt-bk' + (on ? " is-on" : "") + (tierOn ? "" : " is-off") + '">' +
          '<input type="checkbox" data-strat="' + s.id + '"' + (on ? " checked" : "") + (tierOn ? "" : " disabled") + '>' +
          '<span class="grow">' + esc(s.name) + '</span>' +
          '<span class="opt-dot" style="background:' + rateColor(m) + ';"></span></label>';
      }).join("") + '</div>';
    }
    var bookBody = tiers +
      '<div class="play-set mkt-catfoot"><button class="play-btn" data-book="1">' + (state.showBook ? "▲ HIDE LIST" : "▼ PICK STRATEGIES") + '</button>' +
      '<span class="grow"></span><span class="' + (stratN ? "tw" : "tr") + '">' + stratN + '</span><span class="td">in pool</span></div>' + list;

    // rank + record
    var rk = g.rank(), sm = g.summary();
    var pct = rk.next ? Math.round((rk.points - rk.floor) / (rk.next.at - rk.floor) * 100) : 100;
    var rankBody =
      '<div class="opt-rank"><div class="rt">' + esc(rk.title) + '</div>' +
      '<div class="rp td">' + rk.points + ' career pts' + (rk.next ? ' · ' + (rk.next.at - rk.points) + ' to ' + esc(rk.next.title) : ' · top of the desk') + '</div>' +
      '<div class="opt-rbar"><i style="width:' + pct + '%;"></i></div></div>' +
      stat("RUNS", sm.runs, "td") +
      stat("ACCURACY", sm.accuracy == null ? "—" : Math.round(sm.accuracy * 100) + "%", sm.accuracy == null ? "tf" : sm.accuracy >= 0.8 ? "tg" : sm.accuracy >= 0.5 ? "ta" : "tr") +
      stat("BEST STREAK", sm.bestStreak || "—", sm.bestStreak ? "tw" : "tf") +
      stat("MASTERED", sm.mastered + " / " + sm.total, sm.mastered ? "tg" : "tf");

    // mastery board — click a tile to study it in the lab
    var board = '<div class="opt-board">' + D().strategies.map(function (s) {
      var m = mas[s.id];
      return '<div class="opt-tile is-static" title="' + esc(s.name) + (m ? " · " + Math.round(m.rate * 100) + "% over " + m.seen : " · not seen yet") + '">' +
        '<i style="background:' + rateColor(m) + ';"></i><span>' + esc(s.name) + '</span>' +
        (m && m.seen >= 3 && m.rate >= 0.8 ? '<b class="opt-star">★</b>' : '') + '</div>';
    }).join("") + '</div>' +
      '<div class="opt-boardfoot tf">grey = unseen · red → green = hit rate · ★ mastered = 3+ seen at 80%+</div>';
    function tile(id, label) {
      var m = mas[id];
      return '<div class="opt-tile is-static" title="' + esc(label) + (m ? " · " + Math.round(m.rate * 100) + "% over " + m.seen : " · not seen yet") + '">' +
        '<i style="background:' + rateColor(m) + ';"></i><span>' + esc(label) + '</span>' +
        (m && m.seen >= 3 && m.rate >= 0.8 ? '<b class="opt-star">★</b>' : '') + '</div>';
    }
    var greekBoard = '<div class="opt-modegrp td opt-boardhead">GREEKS · NAME / DRAW / MATURITY</div><div class="opt-board">' +
      GM().GREEKS.map(function (gr) { return tile("g:" + gr.id, gr.sym + "  " + gr.name); }).join("") + '</div>' +
      '<div class="opt-modegrp td opt-boardhead">BACK OF THE ENVELOPE</div><div class="opt-board">' +
      GG().ENV.map(function (e) { return tile("e:" + e.id, e.label); }).join("") + '</div>';

    var lab = '<div class="opt-labcta">' +
      '<div class="td">Price anything on a market you control: any strike and maturity, rates and dividends, a vol surface you shape (ATM, term, skew, smile, sticky strike or moneyness). Payoff under any scenario, every Greek across spot or moneyness, the smile, a risk matrix and P&amp;L explain.</div>' +
      '<button class="play-btn pri" data-lab="1">OPEN THE LAB →</button></div>';

    // MIXED uses every filter: the strategy book, the Greeks and the envelope kinds.
    var second = P.mode === "mix"
      ? panel("BOK", "THE BOOK · THE GREEKS", "", bookBody +
          '<div class="opt-modegrp td opt-boardhead">GREEKS</div>' + greekBook("gname") +
          '<div class="opt-modegrp td opt-boardhead">BACK OF THE ENVELOPE</div>' + greekBook("envelope"), true)
      : isGreek()
      ? panel("BOK", P.mode === "envelope" ? "QUESTION KINDS" : "THE GREEKS", '<span class="td">' + poolN + ' IN POOL</span>', greekBook(P.mode), true)
      : panel("BOK", "THE BOOK", '<span class="td">' + D().strategies.length + ' STRATEGIES</span>', bookBody, true);
    return panel("MOD", "MODE", "", modeBody + variant + fmt + go) +
      second +
      panel("RNK", "DESK RANK", "", rankBody) +
      panel("MAS", "MASTERY", "", board + greekBoard);
  }

  // Filter panel for the Greek modes: which Greeks (or envelope kinds) are dealt, and for
  // the graph modes whether puts and short positions are in the mix.
  function greekBook(mode) {
    var P = state.prefs, mas = G().mastery();
    if (mode === "envelope") {
      return GG().ENV.map(function (e) {
        var on = P.envExcluded.indexOf(e.id) < 0;
        return '<label class="opt-bk' + (on ? " is-on" : "") + '"><input type="checkbox" data-env="' + e.id + '"' + (on ? " checked" : "") + '>' +
          '<span class="grow">' + esc(e.label) + ' <span class="tf">· ' + esc(e.rule.replace(/ \((half|=)[^)]*\)$/, "").split(" — ")[0]) + '</span></span>' +
          '<span class="opt-dot" style="background:' + rateColor(mas["e:" + e.id]) + ';"></span></label>';
      }).join("") + '<div class="opt-sub tf">spot, vol and tenor are dealt at random · within 10% scores, 25% half</div>';
    }
    var tenorMode = mode === "gtenor";
    var rows = [1, 2].map(function (tier) {
      return '<div class="opt-modegrp td">' + (tier === 1 ? "MAIN" : "SECOND-ORDER") + '</div>' +
        GM().GREEKS.filter(function (gr) { return gr.tier === tier; }).map(function (gr) {
          var usable = !(tenorMode && tier !== 1), on = usable && P.gExcluded.indexOf(gr.id) < 0;
          return '<label class="opt-bk' + (on ? " is-on" : "") + (usable ? "" : " is-off") + '"><input type="checkbox" data-gx="' + gr.id + '"' +
            (on ? " checked" : "") + (usable ? "" : " disabled") + '>' +
            '<span class="grow"><span class="opt-gsym">' + esc(gr.sym) + '</span> ' + esc(gr.name) + ' <span class="tf">· ' + esc(gr.def.split(" — ")[1] || "") + '</span></span>' +
            '<span class="opt-dot" style="background:' + rateColor(mas["g:" + gr.id]) + ';"></span></label>';
        }).join("");
    }).join("");
    var toggles = seg("OPTIONS", [["1", "CALLS + PUTS"], ["0", "CALLS ONLY"]], P.gPuts === false ? "0" : "1", "data-gputs") +
      (tenorMode ? "" : seg("SIDE", [["0", "LONG ONLY"], ["1", "LONG + SHORT"]], P.gShorts ? "1" : "0", "data-gshorts"));
    return rows + toggles + '<div class="opt-sub tf">' + (tenorMode
      ? "maturity is read off the main four only · flat 20% vol · strike 100"
      : "flat 20% vol · strike 100 · tenor 1M, 3M or 6M (stated)") + '</div>';
  }

  function tierBlurb(t) {
    return t === 1 ? "singles, straddles, verticals, covered" : t === 2 ? "collars, flies, condors, credit spreads" : "ratios, backspreads, seagull, strip/strap";
  }
  function rateColor(m) {
    if (!m || !m.seen) return "var(--t-line2)";
    return m.rate >= 0.8 ? "var(--t-green)" : m.rate >= 0.5 ? "var(--t-amber)" : "var(--t-red)";
  }
  function stat(label, value, cls) {
    return '<div class="mkt-stat"><span class="lb td">' + esc(label) + '</span><span class="vl ' + (cls || "tw") + '">' + value + '</span></div>';
  }
  function seg(label, opts, cur, attr) {
    return '<div class="play-set opt-seg"><span class="lb td">' + label + '</span>' + opts.map(function (o) {
      return '<button class="play-btn' + (o[0] === cur ? " is-on" : "") + '" ' + attr + '="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join("") + '</div>';
  }

  // ======================================================================
  // play
  // ======================================================================

  function nameInput(placeholder, numeric) {
    return '<div class="play-row opt-namerow">' +
      '<input type="text" id="opt-in" class="play-in" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
        (numeric ? 'inputmode="decimal" ' : '') +
        'placeholder="' + (state.revealed ? "" : (placeholder || "name the strategy…")) + '" value="' + esc(state.input) + '"' + (state.revealed ? " disabled" : "") + '>' +
      (state.revealed
        ? '<button class="play-btn pri" data-next="1">' + nextLabel() + '</button>'
        : '<button class="play-btn pri" data-check="1">CHECK</button>') +
    '</div>' +
    (state.note ? '<div class="opt-note ' + (state.note.cls || "ta") + '">' + esc(state.note.text) + '</div>' : '');
  }

  function nextLabel() { return runOver() ? "RESULTS →" : "NEXT →"; }
  function runOver() {
    if (isSurvival()) return state.lives <= 0;
    return state.qn >= +state.prefs.format;
  }

  function renderPlay() {
    if (isGreek()) return renderGreekPlay();
    var panel = F().panel, q = state.q, mode = qm(), s = strat(q.id);
    var body = "";

    if (mode === "payoff") {
      body = '<div class="opt-prompt td">What is this position? <span class="tf">Expiry P&amp;L, premium included · S₀ = 100 · 3M</span></div>' +
        '<div class="opt-chart">' + chart(q.pos, { today: state.revealed, legs: state.revealed }) + '</div>' +
        (state.revealed ? chartLegend({ today: true, legs: true }) : "") +
        nameInput();
    } else if (mode === "greeks") {
      var showChart = state.revealed;
      body = '<div class="opt-prompt td">Who has these Greeks? <span class="tf">' +
        (state.prefs.signsOnly ? "signs only — any strategy that fits scores" : "per unit · ν per vol pt · Θ per day") + '</span></div>' +
        greekTiles(q.pos, state.prefs.signsOnly && !state.revealed) +
        (showChart ? '<div class="opt-chart">' + chart(q.pos, { compact: true, today: state.revealed }) + '</div>' : '') +
        nameInput();
    } else if (mode === "build") {
      var showShape = state.revealed;
      body = '<div class="opt-prompt">Build a <span class="opt-target">' + esc(s.name.toUpperCase()) + '</span></div>' +
        '<div class="opt-sub tf">any strikes from 80 to 120 that make it one · S₀ = 100 · 3M (1M for a front leg)</div>' +
        builder(state.legs, !state.revealed) +
        '<div class="opt-chart">' + chart(state.legs.length ? M().normalize(state.legs) : null,
          { ghost: showShape ? q.pos : null, compact: true }) + '</div>' +
        chartLegend({ expiry: !!state.legs.length, ghost: showShape ? (state.revealed ? "textbook " + s.name.toLowerCase() : "target shape") : null }) +
        (state.legs.length ? '<div class="opt-netprem td">net premium ' + premTxt(M().normalize(state.legs)) + '</div>' : '') +
        '<div class="play-row end">' + (state.revealed
          ? '<button class="play-btn pri" data-next="1">' + nextLabel() + '</button>'
          : '<button class="play-btn pri" data-check="1"' + (state.legs.length ? "" : " disabled") + '>CHECK BUILD</button>') + '</div>' +
        (state.note ? '<div class="opt-note ' + (state.note.cls || "ta") + '">' + esc(state.note.text) + '</div>' : '');
    } else if (mode === "draw") {
      var dr = state.draw;
      body = '<div class="opt-prompt">Draw the <span class="opt-target">' + esc(G().tradeLabel(q).toUpperCase()) + '</span></div>' +
        '<div class="opt-sub tf">' + (state.prefs.inclPremium
          ? "expiry P&amp;L with the premium — price the legs yourself · S₀ 100 · 3M · ATM vol 20%, equity skew (lower strikes trade at higher vol)"
          : "expiry payoff, premium excluded · S₀ 100") + ' · handles at the strikes and the edges</div>' +
        '<div class="opt-chart opt-drawbox">' + chart(null, {
          lo: G().DRAW_LO - 4, hi: G().DRAW_HI + 4, yMax: dr.spec.yMax,
          handles: { xs: dr.spec.xs, ys: dr.ys, sel: dr.sel, truth: state.revealed ? dr.spec.truth : null, tol: dr.spec.tol }
        }) + '</div>' +
        '<div class="opt-sub tf">drag a handle (or ←/→ to pick, ↑/↓ to move by ' + dr.spec.snap + ' · shift ×10) · tolerance ±' + dr.spec.tol.toFixed(1) + '</div>' +
        '<div class="play-row end">' +
          (state.revealed ? '' : '<button class="play-btn" data-flat="1">RESET</button>') +
          (state.revealed
            ? '<button class="play-btn pri" data-next="1">' + nextLabel() + '</button>'
            : '<button class="play-btn pri" data-check="1">CHECK DRAWING</button>') + '</div>';
    }

    var head = '<div class="opt-qhead">' +
      '<span class="mkt-chip">' + esc(modeDef(mode).label) + '</span>' +
      (state.revealed ? '<span class="mkt-chip">' + D().tiers[s.tier] + '</span>' : '') +
      '<span class="grow"></span>' +
      (state.streak >= 2 ? '<span class="opt-streak">×' + state.streak + ' STREAK</span>' : '') +
      (isSurvival() ? '<span class="opt-lives">' + hearts() + '</span>' : '') +
      '<span class="tw">' + state.points + '</span><span class="td">pts</span>' +
    '</div>';

    var title = isSurvival() ? "SURVIVAL · Q" + state.qn : "QUESTION " + state.qn + " / " + state.prefs.format;
    var main = panel("QST", title, "", head + body);
    if (state.revealed) main += revealPanel();
    return main + tapePanel();
  }

  function hearts() {
    var h = "";
    for (var i = 0; i < LIVES; i++) h += i < state.lives ? '<span class="tr">♥</span>' : '<span class="tf">♡</span>';
    return h;
  }
  function premTxt(pos) {
    var p = M().netPremium(pos);
    return Math.abs(p) < 0.005 ? "≈ 0" : (p > 0 ? "pay " : "receive ") + Math.abs(p).toFixed(2) + (M().hasStock(pos) ? " + stock" : "");
  }

  function revealPanel() {
    var q = state.q, s = strat(q.id), r = state.res, mode = qm();
    var word = r.grade === "full" ? "CORRECT" : r.grade === "partial" ? "HALF" : "MISS";
    var cls = r.grade === "full" ? "tg" : r.grade === "partial" ? "ta" : "tr";
    var lines = [];
    if (r.twin) lines.push("Also right: a " + strat(r.twin).name.toLowerCase() + " gives exactly this — put-call parity. The book calls it a " + s.name.toLowerCase() + ".");
    if (r.fuzzy) lines.push("(read your answer as “" + s.name + "”)");
    if (r.grade === "wrong" && r.typed && strat(r.typed)) lines.push("You said " + strat(r.typed).name.toLowerCase() + ".");
    if (r.msg && r.grade !== "full") lines.push(r.msg);
    if (mode === "build" && r.grade === "wrong") {
      lines.push(r.built ? "You built a " + strat(r.built).name.toLowerCase() + "." : "What you built has no textbook name.");
    }
    if (mode === "draw") {
      lines.push(r.hits + " of " + r.n + " points within ±" + state.draw.spec.tol.toFixed(1) + ".");
      // P&L = payoff − premium everywhere, so the gap between the true payoff and your line,
      // averaged over the handles, is the net premium your drawing implies.
      // Only meaningful when the SHAPE is right (your line = payoff − a constant, within the
      // band); then it splits the miss into "shape" vs "premium".
      if (state.prefs.inclPremium) {
        var sp = state.draw.spec, gaps = sp.xs.map(function (x, i) { return M().intrinsicAtExpiry(q.pos, x) - state.draw.ys[i]; });
        var gap = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
        var shapeOk = gaps.every(function (g) { return Math.abs(g - gap) <= sp.tol; });
        var actual = M().netPremium(q.pos);
        if (shapeOk) {
          lines.push("Shape right. Your drawing implies " + (gap >= 0 ? "paying " : "receiving ") + Math.abs(gap).toFixed(2) +
            " net · actual: " + (actual >= 0 ? "pay " : "receive ") + Math.abs(actual).toFixed(2) + ".");
        } else {
          lines.push("The shape is off — the payoff kinks at each strike; the premium only shifts the whole line.");
        }
      }
    }

    var head = '<div class="play-fb is-' + (r.grade === "wrong" ? "bad" : "ok") + ' opt-fb">' +
      '<span class="' + cls + '">' + word + '</span>' +
      '<span class="grow"></span><span class="' + (state.lastPts ? "tg" : "td") + '">+' + state.lastPts + ' pts</span></div>' +
      (lines.length ? '<div class="opt-fbmsg td">' + lines.map(esc).join("<br>") + '</div>' : '');

    var body = head +
      '<div class="opt-ans">' + esc(s.name) + '</div>' +
      legsList(q.pos) +
      (mode === "payoff" || mode === "greeks" ? "" : '<div class="opt-chart">' + chart(q.pos, { legs: true, today: true, compact: true }) + '</div>' + chartLegend({ today: true, legs: true })) +
      statsLine(q.pos) +
      (mode === "greeks" ? "" : greekTiles(q.pos, false)) +
      '<div class="play-model opt-why"><span class="tw">' + esc(s.view) + '</span><br>' + esc(s.why) + '</div>';
    var out = F().panel("ANS", "THE ANSWER", "", body);
    if (mode === "greeks" && r.grade === "wrong" && r.typed && strat(r.typed)) {
      out += F().panel("CMP", "YOURS VS THE ANSWER", "", compareGreeks(q, r.typed));
    }
    return out;
  }

  // The strategy you named, dealt at the question's strikes when its template allows them
  // (so a put spread is compared with a call spread on the same strikes), else at C2's.
  function namedPos(id, q) {
    var p = q.params;
    var fits = p && M().paramGrid(id).some(function (g) { return g.c === p.c && g.w === p.w; });
    return M().instantiate(id, fits ? p : null);
  }

  // Δ Γ ν Θ and premium side by side; a sign that differs is what gives the answer away.
  function compareGreeks(q, typedId) {
    var Mm = M(), mine = namedPos(typedId, q);
    var gA = Mm.greeks(q.pos), gB = Mm.greeks(mine), sA = Mm.signProfile(q.pos), sB = Mm.signProfile(mine);
    var pA = Mm.netPremium(q.pos), pB = Mm.netPremium(mine);
    function cell(v, dp, sg) { return '<td class="num ' + (sg > 0 ? "tg" : sg < 0 ? "tr" : "td") + '">' + sgnStr(v, dp) + '</td>'; }
    function prem(v, sg) {
      return '<td class="num ' + (sg > 0 ? "ta" : sg < 0 ? "tg" : "td") + '">' +
        (sg === 0 ? "≈ 0" : (v > 0 ? "pay " : "rcv ") + Math.abs(v).toFixed(2)) + '</td>';
    }
    var diffs = 0;
    function row(label, key, dp) {
      var same = sA[key] === sB[key];
      if (!same) diffs++;
      return '<tr><td class="td">' + label + '</td>' +
        (key === "premium" ? prem(pA, sA.premium) + prem(pB, sB.premium) : cell(gA[key], dp, sA[key]) + cell(gB[key], dp, sB[key])) +
        '<td class="num ' + (same ? "tf" : "tr") + '">' + (same ? "same sign" : "✗ sign") + '</td></tr>';
    }
    var rows = row("Δ delta", "delta", 2) + row("Γ gamma", "gamma", 3) + row("ν vega /pt", "vega", 2) +
      row("Θ theta /day", "theta", 3) + row("$ premium", "premium", 2);
    var verdict = diffs
      ? diffs + " of 5 signs differ — those are the tells that rule your answer out."
      : "Same signs everywhere — only the sizes tell them apart. Look at the magnitudes.";
    return '<table class="tt opt-cmp"><thead><tr><th></th>' +
        '<th class="num"><span class="tg">ANSWER</span><br>' + esc(G().tradeLabel(q)) + '</th>' +
        '<th class="num"><span class="tr">YOURS</span><br>' + esc(G().tradeLabel({ id: typedId, pos: mine })) + '</th><th class="num"></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="opt-fbmsg td">' + esc(verdict) + '</div>';
  }

  function tapePanel() {
    var marks = state.answers.map(function (a) {
      return '<span class="' + (a.g === "full" ? "tg" : a.g === "partial" ? "ta" : "tr") + '" title="' + esc(itemName(a.id)) + '">' +
        (a.g === "full" ? "▪" : a.g === "partial" ? "▫" : "·") + '</span>';
    }).join("");
    var meta = isSurvival() ? '<span class="td">best streak ' + state.bestStreak + '</span>'
      : '<span class="td">' + (+state.prefs.format - state.answers.length) + ' LEFT</span>';
    return F().panel("TAP", "RUN", meta, '<div class="mkt-tape">' + (marks || '<span class="tf">—</span>') + '</div>');
  }

  // ======================================================================
  // Greek modes (greeksGame): name / draw / maturity / back of the envelope
  // ======================================================================
  var GX = (function () { var g = []; for (var x = 70; x <= 130 + 1e-9; x += 0.5) g.push(x); return g; })();

  // A profile across spot. Same SVG contract as chart() (data-* geometry, .opt-user,
  // data-h handles) so the DRAW wiring works on it unchanged.
  // opts: { curves: [{ ys, stroke, width, dash }], showY, yMax (symmetric), handles, compact }
  function greekChart(opts) {
    var W = 600, H = opts.compact ? 200 : 250, L = 52, R = 12, T = 12, B = 24, lo = 66, hi = 134;
    var yMin, yMax;
    if (opts.yMax) { yMin = -opts.yMax; yMax = opts.yMax; }
    else {
      var all = [0];
      opts.curves.forEach(function (c) { all = all.concat(c.ys); });
      yMin = Math.min.apply(null, all); yMax = Math.max.apply(null, all);
      var pad = (yMax - yMin) * 0.1 || 1;
      yMin -= pad; yMax += pad;
    }
    var sx = function (v) { return L + (v - lo) / (hi - lo) * (W - L - R); };
    var sy = function (v) { return T + (yMax - v) / (yMax - yMin) * (H - T - B); };
    var id = "gc" + (++chartSeq);
    var out = '<svg class="opt-svg' + (opts.handles ? " is-draw" : "") + '" viewBox="0 0 ' + W + " " + H +
      '" preserveAspectRatio="xMidYMid meet" data-lo="' + lo + '" data-hi="' + hi + '" data-ymin="' + yMin +
      '" data-ymax="' + yMax + '" data-l="' + L + '" data-r="' + R + '" data-t="' + T + '" data-b="' + B + '">';
    if (opts.showY) {
      var step = niceStep(yMax - yMin);
      for (var g = Math.ceil(yMin / step) * step; g <= yMax + 1e-12; g += step) {
        var gy = sy(g).toFixed(1);
        out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" style="stroke:var(--t-line);" stroke-width="1"/>' +
          '<text x="' + (L - 5) + '" y="' + (+gy + 3) + '" text-anchor="end" class="opt-ax">' + (Math.abs(g) < step / 1e6 ? "0" : GG().fmtNum(g)) + '</text>';
      }
    } else {
      out += '<text x="' + (L - 5) + '" y="' + (sy(0) + 3).toFixed(1) + '" text-anchor="end" class="opt-ax">0</text>';
    }
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(0).toFixed(1) + '" y2="' + sy(0).toFixed(1) + '" style="stroke:var(--t-dim);" stroke-width="1"/>' +
      '<line x1="' + sx(100).toFixed(1) + '" x2="' + sx(100).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--t-line2);" stroke-dasharray="2 4" stroke-width="1"/>';
    [70, 85, 100, 115, 130].forEach(function (k) {
      out += '<text x="' + sx(k).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="opt-ax' + (k === 100 ? " is-k" : "") + '">' + k + '</text>';
    });
    out += '<clipPath id="' + id + 'p"><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/></clipPath>' +
      '<g clip-path="url(#' + id + 'p)">';
    opts.curves.forEach(function (c) {
      out += '<polyline points="' + c.ys.map(function (v, i) { return sx(GX[i]).toFixed(1) + "," + sy(v).toFixed(1); }).join(" ") +
        '" fill="none" style="stroke:' + c.stroke + ';" stroke-width="' + (c.width || 2.2) + '"' + (c.dash ? ' stroke-dasharray="' + c.dash + '"' : '') + '/>';
    });
    out += '</g>';
    if (opts.handles) {
      var hx = opts.handles.xs, hy = opts.handles.ys, done = !!opts.handles.truth;
      out += '<polyline class="opt-user" points="' + hx.map(function (v, i) { return sx(v).toFixed(1) + "," + sy(hy[i]).toFixed(1); }).join(" ") +
        '" fill="none" style="stroke:var(--t-blue);" stroke-width="2.2"' + (done ? ' stroke-dasharray="5 3"' : '') + '/>';
      hx.forEach(function (v, i) {
        var bad = done && Math.abs(hy[i] - opts.handles.truth[i]) > opts.handles.tol;
        out += '<circle class="opt-h" data-h="' + i + '" cx="' + sx(v).toFixed(1) + '" cy="' + sy(hy[i]).toFixed(1) +
          '" r="' + (!done && opts.handles.sel === i ? 8 : 6) + '" style="fill:' + (bad ? "var(--t-red)" : done ? "var(--t-green)" : "var(--t-blue)") +
          ';stroke:var(--t-bg);" stroke-width="2"/>' +
          '<text class="opt-hv" data-hv="' + i + '" x="' + sx(v).toFixed(1) + '" y="' + (sy(hy[i]) - 12).toFixed(1) + '" text-anchor="middle">' +
          (+hy[i].toPrecision(3)) + '</text>';
      });
    }
    return out + '</svg>';
  }

  function greekCurve(q, T) { return GM().series(q.greek, q.opt, T == null ? q.T : T, q.vol, GX); }
  function tenorLabel(q) { return GG().tenor(q.tenor).label; }

  function renderGreekPlay() {
    var panel = F().panel, q = state.q, mode = qm(), gr = q.greek ? GM().greek(q.greek) : null;
    var body = "";
    var who = q.opt ? esc(GG().positionText(q)) : "";

    if (mode === "gname") {
      body = '<div class="opt-prompt td">Which Greek is this? <span class="tf">' + who + ' · ' + tenorLabel(q) +
        ' · σ 20% · across spot · ' + (state.revealed ? "scale shown" : "scale hidden") + '</span></div>' +
        '<div class="opt-chart">' + greekChart({ curves: [{ ys: greekCurve(q), stroke: "var(--t-blue)" }], showY: state.revealed }) + '</div>' +
        nameInput("delta, gamma, vega, theta, vanna, volga, charm…");
    } else if (mode === "gdraw") {
      var dr = state.draw;
      body = '<div class="opt-prompt">Draw the <span class="opt-target">' + esc(gr.name.toUpperCase()) + '</span></div>' +
        '<div class="opt-sub tf">of a ' + who.toLowerCase() + ' · ' + tenorLabel(q) + ' · σ 20% · across spot 70–130 · ' + esc(unitOf(gr.id)) + '</div>' +
        '<div class="opt-chart opt-drawbox">' + greekChart({
          curves: state.revealed ? [{ ys: greekCurve(q), stroke: "var(--t-green)" }] : [],
          showY: true, yMax: dr.spec.yMax,
          handles: { xs: dr.spec.xs, ys: dr.ys, sel: dr.sel, truth: state.revealed ? dr.spec.truth : null, tol: dr.spec.tol }
        }) + '</div>' +
        (state.revealed ? chartLegend({ expiry: false, truth: true }) : "") +
        '<div class="opt-sub tf">drag a handle (or ←/→ to pick, ↑/↓ to move · shift ×10) · tolerance ±' + GG().fmtNum(dr.spec.tol) + '</div>' +
        '<div class="play-row end">' +
          (state.revealed ? '' : '<button class="play-btn" data-flat="1">RESET</button>') +
          (state.revealed
            ? '<button class="play-btn pri" data-next="1">' + nextLabel() + '</button>'
            : '<button class="play-btn pri" data-check="1">CHECK DRAWING</button>') + '</div>';
    } else if (mode === "gtenor") {
      var curves = [];
      if (state.revealed) curves.push({ ys: greekCurve(q, 0.25), stroke: "var(--t-dim)", width: 1.5, dash: "5 4" });
      curves.push({ ys: greekCurve(q), stroke: "var(--t-blue)" });
      body = '<div class="opt-prompt td">How long to expiry? <span class="tf">' + esc(gr.name) + ' of a ' + who.toLowerCase() +
        ' · σ 20% · ' + esc(unitOf(gr.id)) + '</span></div>' +
        '<div class="opt-chart">' + greekChart({ curves: curves, showY: true }) + '</div>' +
        (curves.length > 1 ? chartLegend({ expiry: false, ghost: "same Greek at 3 months" }) : "") +
        nameInput("e.g. 2w, 45d, 3m, 1y");
    } else {
      var ek = GG().envKind(q.kind);
      body = '<div class="opt-envq"><div class="opt-envp">S = <b>' + q.S + '</b> · σ = <b>' + Math.round(q.vol * 100) + '%</b> · T = <b>' +
        esc(tenorLabel(q)) + '</b></div><div class="opt-envask">' + esc(ek.ask) + '</div>' +
        '<div class="tf opt-envsub">ATM, zero rates · in your head · within 10% scores full</div></div>' +
        nameInput("your estimate", true);
    }

    var head = '<div class="opt-qhead">' +
      '<span class="mkt-chip">' + esc(modeDef(mode).label) + '</span>' +
      (gr && state.revealed ? '<span class="mkt-chip">' + (gr.tier === 1 ? "MAIN" : "SECOND-ORDER") + '</span>' : '') +
      '<span class="grow"></span>' +
      (state.streak >= 2 ? '<span class="opt-streak">×' + state.streak + ' STREAK</span>' : '') +
      (isSurvival() ? '<span class="opt-lives">' + hearts() + '</span>' : '') +
      '<span class="tw">' + state.points + '</span><span class="td">pts</span></div>';
    var title = isSurvival() ? "SURVIVAL · Q" + state.qn : "QUESTION " + state.qn + " / " + state.prefs.format;
    var main = panel("QST", title, "", head + body);
    if (state.revealed) main += revealGreek();
    return main + tapePanel();
  }

  function unitOf(id) {
    return { delta: "per 1 pt of spot", gamma: "Δ per 1 pt of spot", vega: "per vol pt", theta: "per day",
      vanna: "Δ per vol pt", volga: "vega per vol pt", charm: "Δ per day" }[id] || "";
  }

  function revealGreek() {
    var q = state.q, r = state.res, mode = qm(), gr = q.greek ? GM().greek(q.greek) : null;
    var word = r.grade === "full" ? "CORRECT" : r.grade === "partial" ? "HALF" : "MISS";
    var cls = r.grade === "full" ? "tg" : r.grade === "partial" ? "ta" : "tr";
    var lines = [], body;
    if (r.twin) lines.push("Also right: vega = Γ · S² · σ · T, so for one option gamma and vega draw the same bell (vega's sits a touch to the right).");
    if (r.fuzzy) lines.push("(read your answer as “" + gr.name + "”)");
    if (r.grade === "wrong" && r.typed && GM().greek(r.typed)) lines.push("You said " + GM().greek(r.typed).name.toLowerCase() + ". " + GM().greek(r.typed).look);
    if (mode === "gdraw") lines.push(r.hits + " of " + r.n + " points within ±" + GG().fmtNum(state.draw.spec.tol) + ".");
    if (mode === "gtenor") lines.push("You said " + state.input + " (" + Math.round(r.days) + " days).");
    if (mode === "envelope") lines.push("You said " + GG().fmtNum(r.value) + " — " + Math.round(r.off * 100) + "% off.");

    var head = '<div class="play-fb is-' + (r.grade === "wrong" ? "bad" : "ok") + ' opt-fb">' +
      '<span class="' + cls + '">' + word + '</span>' +
      '<span class="grow"></span><span class="' + (state.lastPts ? "tg" : "td") + '">+' + state.lastPts + ' pts</span></div>' +
      (lines.length ? '<div class="opt-fbmsg td">' + lines.map(esc).join("<br>") + '</div>' : '');

    if (mode === "envelope") {
      var ek = GG().envKind(q.kind);
      body = head + '<div class="opt-ans">' + GG().fmtNum(q.exact) + '</div>' +
        '<div class="opt-leglist">' + esc(ek.label) + ' · exact Black-Scholes</div>' +
        '<div class="play-model opt-why"><span class="tw">' + esc(ek.rule) + '</span><br>' + esc(GG().envWorking(q)) +
          ' <span class="td">(' + (Math.round((q.rule / q.exact - 1) * 1000) / 10) + '% vs exact)</span></div>';
      return F().panel("ANS", "THE ANSWER", "", body);
    }

    var others = [1 / 12, 0.25, 0.5].map(function (T, i) {
      return { ys: greekCurve(q, T), stroke: ["var(--t-amber)", "var(--t-purple)", "var(--t-src-mental-math)"][i], width: 1.3, dash: "4 3" };
    });
    body = head +
      '<div class="opt-ans">' + esc(gr.sym) + ' ' + esc(gr.name) + (mode === "gtenor" ? ' · ' + esc(tenorLabel(q)) : '') + '</div>' +
      '<div class="opt-leglist">' + esc(gr.def) + ' · ' + esc(unitOf(gr.id)) + '</div>' +
      (mode === "gtenor" ? '<div class="play-model opt-why"><span class="tw">' + esc(GG().tenorWorking(q)) + '</span><br>' +
        'True T = ' + esc(tenorLabel(q)) + ' (' + GG().tenor(q.tenor).days + ' days).</div>' : '') +
      '<div class="opt-sub tf">the same Greek at 1M · 3M · 6M — watch it sharpen into expiry</div>' +
      '<div class="opt-chart">' + greekChart({ curves: others.concat([{ ys: greekCurve(q), stroke: "var(--t-blue)" }]), showY: true, compact: true }) + '</div>' +
      '<div class="opt-legend td"><span><i style="background:var(--t-blue);"></i>this one</span>' +
        '<span><i class="dash" style="border-color:var(--t-amber);"></i>1M</span><span><i class="dash" style="border-color:var(--t-purple);"></i>3M</span>' +
        '<span><i class="dash" style="border-color:var(--t-src-mental-math);"></i>6M</span></div>' +
      '<div class="play-model opt-why"><span class="tw">How to spot it</span><br>' + esc(gr.look) + '</div>';
    return F().panel("ANS", "THE ANSWER", "", body);
  }

  // ======================================================================
  // builder (build mode + lab)
  // ======================================================================
  function builder(legs, editable) {
    var rows = legs.map(function (l, i) {
      var isStock = l.t === "S";
      return '<div class="opt-leg' + (l.q > 0 ? " is-long" : " is-short") + '">' +
        '<button class="play-btn opt-side" data-leg="' + i + '" data-act="side"' + (editable ? "" : " disabled") + '>' + (l.q > 0 ? "LONG" : "SHORT") + '</button>' +
        '<span class="opt-qty">' +
          '<button class="play-btn" data-leg="' + i + '" data-act="qdn"' + (editable ? "" : " disabled") + '>−</button>' +
          '<span class="tw">' + Math.abs(l.q) + '×</span>' +
          '<button class="play-btn" data-leg="' + i + '" data-act="qup"' + (editable ? "" : " disabled") + '>+</button></span>' +
        '<button class="play-btn opt-type" data-leg="' + i + '" data-act="type"' + (editable ? "" : " disabled") + '>' + (isStock ? "STOCK" : l.t === "C" ? "CALL" : "PUT") + '</button>' +
        (isStock ? '<span class="opt-k tf">@ ' + D().spot + '</span>' :
          '<span class="opt-k">' +
            '<button class="play-btn" data-leg="' + i + '" data-act="kdn"' + (editable && l.k > D().minStrike ? "" : " disabled") + '>◀</button>' +
            '<span class="tw">' + l.k + '</span>' +
            '<button class="play-btn" data-leg="' + i + '" data-act="kup"' + (editable && l.k < D().maxStrike ? "" : " disabled") + '>▶</button></span>') +
        (isStock ? '<span class="opt-exp"></span>' :
          '<button class="play-btn opt-exp' + (l.exp === "F" ? " is-on" : "") + '" data-leg="' + i + '" data-act="exp" title="tenor: 3M or a 1M front leg"' + (editable ? "" : " disabled") + '>' + (l.exp === "F" ? "1M" : "3M") + '</button>') +
        '<span class="opt-legprem td">' + (isStock ? "" : (l.q > 0 ? "pay " : "rcv ") + (Math.abs(l.q) * M().legPremium(l)).toFixed(2)) + '</span>' +
        '<button class="play-btn opt-del" data-leg="' + i + '" data-act="del"' + (editable ? "" : " disabled") + ' aria-label="Remove leg">✕</button>' +
      '</div>';
    }).join("");
    var add = editable ? '<div class="opt-add">' +
      '<button class="play-btn" data-add="C">+ CALL</button><button class="play-btn" data-add="P">+ PUT</button>' +
      '<button class="play-btn" data-add="S">+ STOCK</button>' +
      (legs.length ? '<span class="grow"></span><button class="play-btn" data-clear="1">CLEAR</button>' : '') +
    '</div>' : '';
    return '<div class="opt-builder">' + (rows || '<div class="opt-empty tf">no legs yet — add one</div>') + add + '</div>';
  }

  function legAction(legs, i, act) {
    var l = legs[i];
    if (!l) return;
    var D_ = D();
    if (act === "side") l.q = -l.q;
    else if (act === "qup") l.q += l.q > 0 ? 1 : -1;
    else if (act === "qdn") { if (Math.abs(l.q) > 1) l.q -= l.q > 0 ? 1 : -1; }
    else if (act === "type") {
      var order = ["C", "P", "S"], nt = order[(order.indexOf(l.t) + 1) % 3];
      if (nt === "S" && legs.some(function (o, j) { return j !== i && o.t === "S"; })) nt = "C";
      l.t = nt;
      if (nt === "S") { delete l.k; l.exp = "B"; } else if (l.k == null) l.k = D_.spot;
    }
    else if (act === "kup") l.k = Math.min(D_.maxStrike, l.k + 5);
    else if (act === "kdn") l.k = Math.max(D_.minStrike, l.k - 5);
    else if (act === "exp") l.exp = l.exp === "F" ? "B" : "F";
    else if (act === "del") legs.splice(i, 1);
  }
  function addLeg(legs, t) {
    if (t === "S") {
      var st = legs.filter(function (l) { return l.t === "S"; })[0];
      if (st) { st.q += st.q > 0 ? 1 : -1; return; }   // grow it in its own direction, never through 0
      legs.push({ t: "S", q: 1, exp: "B" });
      return;
    }
    legs.push({ t: t, q: 1, k: D().spot, exp: "B" });
  }

  // ======================================================================
  // results
  // ======================================================================
  function renderDone() {
    var panel = F().panel, a = state.answers;
    var full = a.filter(function (x) { return x.g === "full"; }).length;
    var part = a.filter(function (x) { return x.g === "partial"; }).length;
    var acc = a.length ? Math.round((full + 0.5 * part) / a.length * 100) : 0;
    var cls = acc >= 80 ? "tg" : acc >= 50 ? "ta" : "tr";
    var rk = G().rank();
    var hero = '<div class="mkt-hero">' +
      '<div class="mkt-pct tw">' + state.points + '<span class="pc">pts</span></div>' +
      (state.newBest ? '<div class="opt-newbest">★ NEW BEST</div>' : '') +
      '<div class="mkt-tally td"><span class="' + cls + '">' + acc + '% accuracy</span> · ' +
        '<span class="tg">' + full + ' right</span> · <span class="ta">' + part + ' half</span> · <span class="tr">' + (a.length - full - part) + ' miss</span>' +
        ' · best streak ' + state.bestStreak + ' · ' + fmtClock(state.elapsed) + '</div>' +
      '<div class="td opt-rankline">' + esc(rk.title) + ' · ' + rk.points + ' career pts</div>' +
      '<div class="play-row mkt-again"><button class="play-btn pri" data-again="1">RUN AGAIN</button>' +
        '<button class="play-btn" data-back="1">← SETUP</button></div></div>';
    var rows = a.map(function (x) {
      var c = x.g === "full" ? "tg" : x.g === "partial" ? "ta" : "tr";
      return '<div class="play-rev"><span class="mk ' + c + '">' + (x.g === "full" ? "✓" : x.g === "partial" ? "~" : "✗") + '</span>' +
        '<span class="q">' + esc(itemName(x.id)) + '</span>' +
        '<span class="td opt-said">' + esc(x.said || "") + '</span>' +
        '<span class="a ' + (x.pts ? "tw" : "td") + '">+' + x.pts + '</span></div>';
    }).join("");
    // Every Greeks-detective miss where you named a real strategy, side by side again.
    var mixups = a.filter(function (x) { return x.mode === "greeks" && x.g === "wrong" && x.typed && strat(x.typed) && x.q; });
    var cmp = mixups.length ? panel("CMP", "WHAT YOU CONFUSED", '<span class="td">' + mixups.length + '</span>',
      mixups.map(function (x) {
        return '<div class="opt-cmphead"><span class="tw">' + esc(strat(x.id).name) + '</span> <span class="td">vs your</span> <span class="tr">' +
          esc(strat(x.typed).name) + '</span></div>' + compareGreeks(x.q, x.typed);
      }).join(""), true) : "";
    return panel("RES", modeDef(state.prefs.mode).label + " · RESULT", "", hero) +
      panel("REV", "REVIEW", '<span class="td">' + a.length + ' ITEMS</span>', rows || '<div class="tf opt-empty">nothing answered</div>', true) + cmp;
  }

  // ======================================================================
  // actions
  // ======================================================================
  function savePrefs() { G().savePrefs(state.prefs); }

  function startRun() {
    if (!poolCount()) return;
    // one deck per mode in play, so a MIXED run still cycles each mode's pool fairly
    var modes = state.prefs.mode === "mix" ? mixModes() : [state.prefs.mode];
    state.decks = {};
    modes.forEach(function (m) {
      state.decks[m] = GG().isGreekMode(m) ? GG().makeDeck(m, state.prefs) : G().makeDeck(G().poolFor(m, state.prefs));
    });
    state.modes = modes;
    state.screen = "play";
    state.qn = 0; state.streak = 0; state.bestStreak = 0; state.points = 0; state.lives = LIVES;
    state.answers = []; state.startedAt = Date.now(); state.elapsed = 0; state.newBest = false;
    nextQuestion();
  }

  function nextQuestion() {
    // never the same mode three times running in a MIXED run
    var ms = state.modes, last = state.answers.slice(-2).map(function (a) { return a.mode; });
    var pickFrom = ms.length > 1 && last.length === 2 && last[0] === last[1]
      ? ms.filter(function (m) { return m !== last[0]; }) : ms;
    state.qmode = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    state.q = state.decks[state.qmode].next();
    state.qn++;
    state.input = ""; state.note = null; state.revealed = false; state.res = null; 
    state.legs = []; state.lastPts = 0;
    if (state.qmode === "gdraw") {
      var gspec = GG().drawSpec(state.q);
      state.draw = { spec: gspec, ys: gspec.xs.map(function () { return 0; }), sel: 0 };
    } else if (state.qmode === "draw") {
      var spec = G().drawSpec(state.q.pos, state.prefs.inclPremium);
      state.draw = { spec: spec, ys: spec.xs.map(function () { return 0; }), sel: 0 };
    } else state.draw = null;
    render();
  }

  function check() {
    if (state.revealed) return;
    var mode = qm(), q = state.q, r;
    if (mode === "gname" || mode === "gtenor" || mode === "envelope") {
      r = mode === "gname" ? GG().gradeName(q, state.input)
        : mode === "gtenor" ? GG().gradeTenor(q, state.input) : GG().gradeEnvelope(q, state.input);
      if (r.grade === "retry") { state.note = { text: r.msg, cls: "ta" }; render(); return; }
    } else if (mode === "gdraw") {
      r = GG().gradeDraw(state.draw.spec, state.draw.ys);
    } else if (mode === "payoff" || mode === "greeks") {
      r = G().gradeName(mode, q, state.input, { signsOnly: state.prefs.signsOnly });
      if (r.grade === "retry") {
        state.note = { text: r.msg, cls: "ta" };
        render();
        return;
      }
    } else if (mode === "build") {
      r = G().gradeBuild(q, state.legs);
      if (r.grade === "retry") { state.note = { text: r.msg, cls: "ta" }; render(); return; }
    } else {
      r = G().gradeDraw(state.draw.spec, state.draw.ys);
    }
    var pts = G().score(r.grade, state.streak);
    state.points += pts;
    state.lastPts = pts;
    if (r.grade === "full") { state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak); }
    else state.streak = 0;
    if (r.grade === "wrong" && isSurvival()) state.lives--;
    var said = mode === "build" ? (r.built ? "built " + strat(r.built).name.toLowerCase() : "built " + state.legs.length + " legs")
      : mode === "draw" || mode === "gdraw" ? r.hits + "/" + r.n + " points" : state.input;
    state.answers.push({ id: q.mid || q.id, g: r.grade, pts: pts, said: said, mode: mode,
      typed: r.typed || null, q: mode === "greeks" ? q : null });
    state.res = r;
    state.note = null;
    state.revealed = true;
    render();
  }

  function next() {
    if (!state.revealed) return;
    if (runOver()) return finish();
    nextQuestion();
  }

  function finish() {
    state.elapsed = Math.round((Date.now() - state.startedAt) / 1000);
    var prevBest = G().bestFor(state.prefs.mode, state.prefs.format);
    var a = state.answers;
    if (a.length) {
      G().saveRun({
        at: new Date().toISOString(), mode: state.prefs.mode, format: state.prefs.format,
        n: a.length,
        correct: a.filter(function (x) { return x.g === "full"; }).length,
        partial: a.filter(function (x) { return x.g === "partial"; }).length,
        points: state.points, bestStreak: state.bestStreak, durationSec: state.elapsed,
        per: a.map(function (x) { return { id: x.id, g: x.g }; })
      });
      state.newBest = state.points > 0 && (prevBest == null || state.points > prevBest);
    }
    state.screen = "done";
    render();
  }

  function toSetup() {
    state.screen = "setup";
    // a daily run borrowed MIXED × 5 without saving it — give the setup back its own prefs
    if (state.daily) { state.prefs = G().loadPrefs(); state.daily = false; }
    state.q = null; state.revealed = false;
    render();
  }


  // ---------- draw interaction ----------
  function snapY(v) {
    var sp = state.draw.spec, s = sp.snap;
    return Math.max(-sp.yMax, Math.min(sp.yMax, Math.round(v / s) * s));
  }
  function svgGeom(svg) {
    var g = {};
    ["lo", "hi", "ymin", "ymax", "l", "r", "t", "b"].forEach(function (k) { g[k] = +svg.getAttribute("data-" + k); });
    var vb = svg.viewBox.baseVal;
    g.W = vb.width; g.H = vb.height;
    g.sx = function (v) { return g.l + (v - g.lo) / (g.hi - g.lo) * (g.W - g.l - g.r); };
    g.sy = function (v) { return g.t + (g.ymax - v) / (g.ymax - g.ymin) * (g.H - g.t - g.b); };
    g.iy = function (py) { return g.ymax - (py - g.t) / (g.H - g.t - g.b) * (g.ymax - g.ymin); };
    return g;
  }
  // Same rounding the chart used when it drew the handle (Greek scales are tiny: 0.012, not 0).
  function handleLabel(v) { return state.draw.spec.yMax < 5 ? String(+v.toPrecision(3)) : String(+v.toFixed(1)); }
  function paintDraw(svg) {
    var g = svgGeom(svg), dr = state.draw;
    var pts = dr.spec.xs.map(function (x, i) { return g.sx(x).toFixed(1) + "," + g.sy(dr.ys[i]).toFixed(1); }).join(" ");
    var pl = svg.querySelector(".opt-user");
    if (pl) pl.setAttribute("points", pts);
    dr.spec.xs.forEach(function (x, i) {
      var c = svg.querySelector('[data-h="' + i + '"]'), t = svg.querySelector('[data-hv="' + i + '"]');
      if (c) { c.setAttribute("cy", g.sy(dr.ys[i]).toFixed(1)); c.setAttribute("r", i === dr.sel ? 8 : 6); }
      if (t) { t.setAttribute("y", (g.sy(dr.ys[i]) - 12).toFixed(1)); t.textContent = handleLabel(dr.ys[i]); }
    });
  }
  function wireDraw() {
    var svg = rootEl.querySelector(".opt-svg.is-draw");
    if (!svg || state.revealed) return;
    var dragging = false;
    function toSvg(e) {
      var p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      var m = svg.getScreenCTM();
      return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }
    function setFrom(e) {
      var pt = toSvg(e), g = svgGeom(svg);
      state.draw.ys[state.draw.sel] = snapY(g.iy(pt.y));
      paintDraw(svg);
    }
    svg.addEventListener("pointerdown", function (e) {
      var pt = toSvg(e), g = svgGeom(svg), best = 0, bd = Infinity;
      state.draw.spec.xs.forEach(function (x, i) {
        var d = Math.abs(g.sx(x) - pt.x);
        if (d < bd) { bd = d; best = i; }
      });
      state.draw.sel = best;
      dragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch (_e) {}
      setFrom(e);
      e.preventDefault();
    });
    svg.addEventListener("pointermove", function (e) { if (dragging) setFrom(e); });
    function end() { if (dragging) { dragging = false; paintDraw(svg); } }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }

  // ---------- keys ----------
  // Runs before the frame's handler. During a run, digits are swallowed so a stray "2"
  // can't navigate away mid-question.
  function onKey(e) {
    if (state.screen === "setup") {
      if (e.key === "Enter") { e.preventDefault(); startRun(); return true; }
      return false;
    }
    if (state.screen === "lab") {
      if (e.key === "Escape") { e.preventDefault(); toSetup(); return true; }
      return false;
    }
    if (state.screen === "done") {
      if (e.key === "Enter") { e.preventDefault(); startRun(); return true; }
      if (e.key === "Escape") { e.preventDefault(); toSetup(); return true; }
      return false;
    }
    if (e.key === "Escape") { e.preventDefault(); toSetup(); return true; }
    if (e.key === "Enter") { e.preventDefault(); if (state.revealed) next(); else check(); return true; }
    if (isDrawMode() && !state.revealed && state.draw) {
      var dr = state.draw, svg = rootEl.querySelector(".opt-svg.is-draw");
      var step = dr.spec.snap * (e.shiftKey ? 10 : 1);
      if (e.key === "ArrowLeft") dr.sel = Math.max(0, dr.sel - 1);
      else if (e.key === "ArrowRight") dr.sel = Math.min(dr.spec.xs.length - 1, dr.sel + 1);
      else if (e.key === "ArrowUp") dr.ys[dr.sel] = snapY(dr.ys[dr.sel] + step);
      else if (e.key === "ArrowDown") dr.ys[dr.sel] = snapY(dr.ys[dr.sel] - step);
      else return /^[0-9]$/.test(e.key);
      e.preventDefault();
      if (svg) paintDraw(svg);
      return true;
    }
    return /^[0-9]$/.test(e.key);
  }

  // ======================================================================
  // mount
  // ======================================================================
  var rootEl = null, teardownFrame = null, tick = null;

  function render() {
    if (!rootEl) return;
    var main, hints;
    if (state.screen === "play") main = renderPlay();
    else if (state.screen === "done") main = renderDone();
    else if (state.screen === "lab") main = LV().render();
    else main = renderSetup();

    if (state.screen === "play") {
      hints = isDrawMode()
        ? '<kbd>←→</kbd> handle · <kbd>↑↓</kbd> move · <kbd>Enter</kbd> check · <kbd>Esc</kbd> quit'
        : '<kbd>Enter</kbd> check / next · <kbd>Esc</kbd> quit';
    } else if (state.screen === "done") hints = '<kbd>Enter</kbd> run again · <kbd>Esc</kbd> setup';
    else if (state.screen === "lab") hints = '<kbd>Esc</kbd> setup · <kbd>0–9</kbd> nav';
    else hints = '<kbd>Enter</kbd> start · <kbd>l</kbd> light / dark';

    var topSegs = "";
    if (state.screen === "play") {
      topSegs = '<div class="seg"><span class="lbl">Q</span><span class="tw">' + state.qn + '</span>' +
        (isSurvival() ? "" : '<span class="td">/' + state.prefs.format + '</span>') + '</div>' +
        '<div class="seg"><span class="lbl">PTS</span><span class="tw">' + state.points + '</span></div>' +
        '<div class="seg"><span class="lbl">T</span><span id="opt-clock" class="tw">' + fmtClock(state.elapsed) + '</span></div>';
    } else {
      var rk = G().rank();
      topSegs = '<div class="seg"><span class="lbl">RANK</span><span class="tw">' + esc(rk.title) + '</span></div>' +
        '<div class="seg hide-sm"><span class="lbl">PTS</span><span class="td">' + rk.points + '</span></div>';
    }

    if (teardownFrame) { teardownFrame(); teardownFrame = null; }
    teardownFrame = F().mount(rootEl, {
      active: "#/terminal/options",
      topSegs: topSegs,
      mainCls: "term-opt" + (state.screen === "play" || state.screen === "done" ? " is-focus" : state.screen === "lab" ? " is-lab" : ""),
      scrollKey: state.screen + "|" + (state.qn || 0),
      main: main,
      statusHints: hints,
      statusSegs: '<span class="seg">' + esc(state.screen === "lab" ? "LAB" : modeDef(qm()).label) + '</span>',
      helpRows: [["Enter", "check / next"], ["←→ ↑↓", "draw: pick / move handle"], ["Esc", "quit run"]],
      onKey: onKey,
      remount: render
    });
    wire();
  }

  function wire() {
    function on(sel, fn) {
      rootEl.querySelectorAll(sel).forEach(function (el) {
        el.addEventListener("click", function (e) { e.preventDefault(); fn(el, e); });
      });
    }
    var P = state.prefs;
    on("[data-mode]", function (el) { P.mode = el.getAttribute("data-mode"); savePrefs(); render(); });
    on("[data-signs]", function (el) { P.signsOnly = el.getAttribute("data-signs") === "1"; savePrefs(); render(); });
    on("[data-prem]", function (el) { P.inclPremium = el.getAttribute("data-prem") === "1"; savePrefs(); render(); });
    on("[data-format]", function (el) {
      var v = el.getAttribute("data-format");
      P.format = v === "survival" ? "survival" : +v;
      savePrefs(); render();
    });
    on("[data-book]", function () { state.showBook = !state.showBook; render(); });
    on("[data-start]", startRun);
    on("[data-again]", startRun);
    on("[data-back]", toSetup);
    on("[data-lab]", function () { state.screen = "lab"; render(); });
    on("[data-study]", function (el) {
      LV().loadStrategy(el.getAttribute("data-study"));
      state.screen = "lab";
      render();
    });
    on("[data-check]", check);
    on("[data-next]", next);
    rootEl.querySelectorAll("[data-mix]").forEach(function (el) {
      el.addEventListener("change", function () {
        var id = el.getAttribute("data-mix"), at = P.mix.indexOf(id);
        if (el.checked && at < 0) P.mix.push(id);
        if (!el.checked && at >= 0) P.mix.splice(at, 1);
        savePrefs(); render();
      });
    });
    on("[data-gputs]", function (el) { P.gPuts = el.getAttribute("data-gputs") === "1"; savePrefs(); render(); });
    on("[data-gshorts]", function (el) { P.gShorts = el.getAttribute("data-gshorts") === "1"; savePrefs(); render(); });
    function listToggle(attr, key) {
      rootEl.querySelectorAll("[" + attr + "]").forEach(function (el) {
        el.addEventListener("change", function () {
          var id = el.getAttribute(attr), at = P[key].indexOf(id);
          if (el.checked && at >= 0) P[key].splice(at, 1);
          if (!el.checked && at < 0) P[key].push(id);
          savePrefs(); render();
        });
      });
    }
    listToggle("data-gx", "gExcluded");
    listToggle("data-env", "envExcluded");
    on("[data-flat]", function () { state.draw.ys = state.draw.ys.map(function () { return 0; }); render(); });

    var legs = state.legs;
    on("[data-add]", function (el) { addLeg(legs, el.getAttribute("data-add")); state.note = null; render(); });
    on("[data-clear]", function () { legs.length = 0; render(); });
    on("[data-act]", function (el) { legAction(legs, +el.getAttribute("data-leg"), el.getAttribute("data-act")); state.note = null; render(); });

    rootEl.querySelectorAll("[data-tier]").forEach(function (el) {
      el.addEventListener("change", function () {
        var t = +el.getAttribute("data-tier"), at = P.tiers.indexOf(t);
        if (el.checked && at < 0) P.tiers.push(t);
        if (!el.checked && at >= 0) P.tiers.splice(at, 1);
        P.tiers.sort();
        savePrefs(); render();
      });
    });
    rootEl.querySelectorAll("[data-strat]").forEach(function (el) {
      el.addEventListener("change", function () {
        var id = el.getAttribute("data-strat"), at = P.excluded.indexOf(id);
        if (el.checked && at >= 0) P.excluded.splice(at, 1);
        if (!el.checked && at < 0) P.excluded.push(id);
        savePrefs(); render();
      });
    });

    var input = rootEl.querySelector("#opt-in");
    if (input) {
      input.addEventListener("input", function () { state.input = input.value; });
      // The frame ignores keys typed into an INPUT, so Enter is wired here.
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault(); e.stopPropagation();
          state.input = input.value;
          if (state.revealed) next(); else check();
        } else if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation(); toSetup();
        }
      });
      if (!state.revealed) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_e) {}
      }
    } else if (state.screen === "play" && state.revealed) {
      // keep Enter = next working when focus was on a now-removed control
      var nb = rootEl.querySelector("[data-next]");
      if (nb) nb.focus();
    }
    wireDraw();
    if (state.screen === "lab") LV().wire(rootEl, { rerender: render });
  }

  function startTick() {
    stopTick();
    tick = setInterval(function () {
      if (!state || state.screen !== "play" || !state.startedAt) return;
      state.elapsed = Math.round((Date.now() - state.startedAt) / 1000);
      var el = document.getElementById("opt-clock");
      if (el) el.textContent = fmtClock(state.elapsed);
    }, 1000);
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  window.M1.lib.views.terminalOptions = {
    mount: function (el, params) {
      rootEl = el;
      if (!state) state = freshState();
      // #/terminal/options/daily — the Today list's short game: 5 questions, MIXED, from the
      // modes ticked for MIXED (the default mix if those deal nothing). Not saved as prefs.
      if (params && params.sub === "daily" && state.screen !== "play") {
        var base = G().loadPrefs();
        state.prefs = JSON.parse(JSON.stringify(base));
        state.prefs.mode = "mix";
        state.prefs.format = 5;
        if (!mixModes().length) state.prefs.mix = ["payoff", "greeks", "build", "gname", "envelope"];
        state.daily = true;
        startRun();
        return startTick();
      }
      render();
      startTick();
    },
    unmount: function () {
      stopTick();
      if (teardownFrame) { teardownFrame(); teardownFrame = null; }
      rootEl = null;
      state = null;
    }
  };
})();
