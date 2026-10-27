// options-game.test.js — Options Lab rules: typed-name matching, grading per mode,
// draw spec, scoring and persistence.
(function () {
  "use strict";
  var G = window.M1.lib.optionsGame;
  var M = window.M1.lib.optionsMath;
  var D = window.M1.data.optionStrategies;

  function useFakeLs() {
    if (typeof window.localStorage !== "undefined" && window.localStorage) return;
    var store = {};
    window.localStorage = {
      getItem: function (k) { return (k in store) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    };
  }
  useFakeLs();

  function q(id, params) { return { id: id, params: params || null, pos: M.instantiate(id, params) }; }

  describe("optionsGame.resolve", function () {
    it("reads the names people actually say", function () {
      expect(G.resolve("Bear put spread").id).toBe("put-spread");
      expect(G.resolve("  BUY-WRITE ").id).toBe("covered-call");
      expect(G.resolve("1 x 2 put spread").id).toBe("put-ratio");
      expect(G.resolve("1 by 2 put spread").id).toBe("put-ratio");
      expect(G.resolve("iron fly").id).toBe("iron-butterfly");
      expect(G.resolve("a long call").id).toBe("long-call");
      expect(G.resolve("risky").id).toBe("risk-reversal");
    });
    it("forgives a typo only when one strategy is that close", function () {
      var r = G.resolve("iron condr");
      expect(r.id).toBe("iron-condor");
      expect(r.fuzzy).toBe(true);
      expect(G.resolve("strop").kind).toBe("unknown");     // strip? strap? too short to guess
    });
    it("flags bare families and unknown words", function () {
      expect(G.resolve("straddle").kind).toBe("family");
      expect(G.resolve("banana").kind).toBe("unknown");
      expect(G.resolve("   ").kind).toBe("empty");
    });
    it("has no alias claimed by two strategies", function () {
      var seen = {};
      D.strategies.forEach(function (s) {
        s.names.forEach(function (n) {
          var k = G.norm(n);
          if (seen[k] && seen[k] !== s.id) throw new Error('"' + n + '" → ' + seen[k] + " and " + s.id);
          seen[k] = s.id;
        });
      });
    });
    it("resolves every strategy's display name to itself", function () {
      D.strategies.forEach(function (s) {
        var r = G.resolve(s.name);
        if (r.id !== s.id) throw new Error(s.name + " → " + JSON.stringify(r));
      });
    });
  });

  describe("optionsGame.gradeName", function () {
    it("scores the right name, nudges a bare family, ignores gibberish", function () {
      expect(G.gradeName("payoff", q("put-spread"), "put spread").grade).toBe("full");
      expect(G.gradeName("payoff", q("long-straddle"), "straddle").grade).toBe("retry");
      expect(G.gradeName("payoff", q("long-straddle"), "zzzzzz").grade).toBe("retry");
      expect(G.gradeName("payoff", q("long-straddle"), "short straddle").grade).toBe("wrong");
    });
    it("credits a parity twin on the payoff: iron butterfly for a call butterfly", function () {
      var g = G.gradeName("payoff", q("butterfly"), "iron butterfly");
      expect(g.grade).toBe("full");
      expect(g.twin).toBe("iron-butterfly");
    });
    it("credits a short put for a covered call payoff, not a long put", function () {
      expect(G.gradeName("payoff", q("covered-call"), "short put").grade).toBe("full");
      expect(G.gradeName("payoff", q("covered-call"), "long put").grade).toBe("wrong");
    });
    it("numbers-mode Greeks only accept a strategy that shows identical numbers", function () {
      expect(G.gradeName("greeks", q("long-call"), "protective put").grade).toBe("full");   // parity: identical
      expect(G.gradeName("greeks", q("long-put"), "long strangle").grade).toBe("wrong");    // 100/120 strangle ≈, not =
    });
    it("signs-only Greeks accept any strategy with the same sign profile", function () {
      // long strangle and long straddle: Δ≈0, Γ+, ν+, Θ−, pay.
      expect(G.gradeName("greeks", q("long-strangle"), "long straddle", { signsOnly: true }).grade).toBe("full");
      expect(G.gradeName("greeks", q("long-strangle"), "long straddle", { signsOnly: false }).grade).toBe("wrong");
    });
  });

  describe("optionsGame.gradeBuild", function () {
    it("accepts the strategy at any valid strikes", function () {
      var legs = [{ t: "P", q: 1, k: 105, exp: "B" }, { t: "P", q: -1, k: 95, exp: "B" }];
      expect(G.gradeBuild(q("put-spread"), legs).grade).toBe("full");
    });
    it("gives half credit for a parity twin (call fly asked as iron fly)", function () {
      var legs = M.instantiate("butterfly");
      var g = G.gradeBuild(q("iron-butterfly"), legs);
      expect(g.grade).toBe("partial");
      expect(g.built).toBe("butterfly");
    });
    it("rejects the wrong structure and says what was built", function () {
      var g = G.gradeBuild(q("put-spread"), M.instantiate("call-spread"));
      expect(g.grade).toBe("wrong");
      expect(g.built).toBe("call-spread");
    });
    it("asks for legs before grading", function () {
      expect(G.gradeBuild(q("put-spread"), []).grade).toBe("retry");
    });
  });

  describe("optionsGame.draw", function () {
    it("puts handles at the edges and every strike, with the true P&L there", function () {
      var spec = G.drawSpec(M.instantiate("put-spread"), true);
      expect(spec.xs).toEqual([70, 85, 100, 130]);
      expect(Math.abs(spec.truth[3] + 3.41) < 0.01).toBe(true);
      expect(Math.abs(spec.truth[0] - 11.59) < 0.01).toBe(true);
    });
    it("grades all-in-tolerance as full, half as partial", function () {
      var spec = G.drawSpec(M.instantiate("put-spread"), false);
      expect(spec.truth).toEqual([15, 15, 0, 0]);
      expect(G.gradeDraw(spec, [15, 15, 0, 0]).grade).toBe("full");
      expect(G.gradeDraw(spec, [15, 15, 9, 9]).grade).toBe("partial");
      expect(G.gradeDraw(spec, [0, 0, 9, 9]).grade).toBe("wrong");
    });
    it("names the trade with its strikes, in leg order", function () {
      expect(G.tradeLabel(q("put-spread"))).toBe("100/85 put spread");
      expect(G.tradeLabel(q("iron-condor"))).toBe("85/95/105/115 iron condor");
      expect(G.tradeLabel(q("covered-call"))).toBe("105 covered call");
      expect(G.tradeLabel(q("put-spread", { c: 100, w: 10 }))).toBe("100/90 put spread");
    });
    it("gives a wider band when the premium must be estimated", function () {
      var pos = M.instantiate("put-spread");
      expect(G.drawSpec(pos, true).tol > G.drawSpec(pos, false).tol).toBe(true);
    });
    it("never asks to draw the calendar (curved at front expiry)", function () {
      var pool = G.poolFor("draw", { tiers: [1, 2, 3], excluded: [] });
      expect(pool.some(function (s) { return s.id === "calendar"; })).toBe(false);
    });
  });

  describe("optionsGame.pool + deck", function () {
    it("filters by tier and by excluded ids", function () {
      var p = G.poolFor("payoff", { tiers: [1], excluded: ["long-call"] });
      expect(p.every(function (s) { return s.tier === 1 && s.id !== "long-call"; })).toBe(true);
      expect(p.length).toBe(D.strategies.filter(function (s) { return s.tier === 1; }).length - 1);
    });
    it("deals every strategy once before repeating", function () {
      var pool = G.poolFor("payoff", { tiers: [1], excluded: [] });
      var deck = G.makeDeck(pool), seen = {};
      for (var i = 0; i < pool.length; i++) seen[deck.next().id] = 1;
      expect(Object.keys(seen).length).toBe(pool.length);
    });
    it("only deals strikes on the 80–120 grid", function () {
      D.strategies.forEach(function (s) {
        for (var i = 0; i < 20; i++) {
          M.strikesOf(M.instantiate(s, G.dealParams(s))).forEach(function (k) {
            if (k < 80 || k > 120 || k % 5 !== 0) throw new Error(s.id + " dealt strike " + k);
          });
        }
      });
    });
  });

  describe("optionsGame.score", function () {
    it("pays 100, halves partial, rewards streaks", function () {
      expect(G.score("full", 0)).toBe(100);
      expect(G.score("partial", 3)).toBe(50);
      expect(G.score("full", 3)).toBe(130);
      expect(G.score("full", 12)).toBe(150);
      expect(G.score("wrong", 5)).toBe(0);
    });
  });

  describe("optionsGame persistence", function () {
    it("derives mastery and bests from saved runs", function () {
      window.localStorage.removeItem(G._keys.runs);
      G.saveRun({ at: "2026-10-15T10:00:00Z", mode: "payoff", format: 10, n: 2, correct: 1, partial: 1, points: 150,
        bestStreak: 1, per: [{ id: "collar", g: "full" }, { id: "seagull", g: "partial" }] });
      G.saveRun({ at: "2026-10-15T11:00:00Z", mode: "payoff", format: 10, n: 1, correct: 0, partial: 0, points: 0,
        bestStreak: 0, per: [{ id: "collar", g: "wrong" }] });
      var m = G.mastery();
      expect(m.collar.seen).toBe(2);
      expect(m.collar.rate).toBe(0.5);
      expect(m.seagull.rate).toBe(0.5);
      expect(G.bestFor("payoff", 10)).toBe(150);
      expect(G.bestFor("draw", 10)).toBe(null);
      expect(G.summary().runs).toBe(2);
      expect(G.rank().title).toBe("INTERN");
      window.localStorage.removeItem(G._keys.runs);
    });
    it("fills missing prefs with defaults", function () {
      window.localStorage.removeItem(G._keys.prefs);
      var p = G.loadPrefs();
      expect(p.mode).toBe("payoff");
      expect(p.tiers).toEqual([1, 2]);
    });
  });

  describe("optionsGame · hints", function () {
    function seq() { var x = 0.37; return function () { x = (x * 9301 + 49297) % 233280 / 233280; return x; }; }
    ["payoff", "greeks"].forEach(function (mode) {
      it("four distinct choices, the answer among them, the rest wrong · " + mode, function () {
        D.strategies.forEach(function (s) {
          var qq = q(s.id), cs = G.hintChoices(mode, qq, {}, seq());
          expect(cs.length).toBe(4);
          var labels = cs.map(function (c) { return c.label; });
          expect(labels.filter(function (l, i) { return labels.indexOf(l) === i; }).length).toBe(4);
          var right = cs.filter(function (c) { return G.gradeName(mode, qq, c.value, {}).grade === "full"; });
          if (right.length !== 1 || right[0].label !== s.name) throw new Error(mode + " " + s.id + ": " + labels.join(", "));
        });
      });
    });
    it("signs-only Greeks: no decoy shares the answer's sign profile", function () {
      D.strategies.forEach(function (s) {
        var qq = q(s.id), cs = G.hintChoices("greeks", qq, { signsOnly: true }, seq());
        var right = cs.filter(function (c) { return G.gradeName("greeks", qq, c.value, { signsOnly: true }).grade === "full"; });
        if (right.length !== 1) throw new Error(s.id + ": " + cs.map(function (c) { return c.label; }).join(", "));
      });
    });
    it("build hint names the leg types, not the sides or strikes", function () {
      expect(G.legHint(q("long-straddle"))).toBe("1 call + 1 put");
      expect(G.legHint(q("covered-call"))).toBe("1 call + 1 share of stock");
      expect(G.legHint(q("put-ratio"))).toBe("3 puts");
      expect(/two maturities/.test(G.legHint(q("calendar")))).toBe(true);
    });
  });
})();
