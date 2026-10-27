// greeks-game.test.js — Greek profiles (closed form vs bump-and-reprice) and the rules of
// the Options Lab Greek modes: names, twins, draw spec, tenor parsing, envelope numbers.
(function () {
  "use strict";
  var GM = window.M1.lib.greeksMath;
  var GG = window.M1.lib.greeksGame;
  var OM = window.M1.lib.optionsMath;

  function near(a, b, tol, what) {
    if (!(Math.abs(a - b) <= tol)) throw new Error(what + ": expected " + b + " ± " + tol + ", got " + a);
  }
  function price(t, S, T, vol) { return OM.bs(t, S, 100, T, vol); }
  function delta(t, S, T, vol) { return (price(t, S + 0.01, T, vol) - price(t, S - 0.01, T, vol)) / 0.02; }
  function vegaPt(t, S, T, vol) { return (price(t, S, T, vol + 0.0001) - price(t, S, T, vol - 0.0001)) / 0.02; }

  describe("greeksMath · closed forms match bump-and-reprice", function () {
    var cases = [];
    ["C", "P"].forEach(function (t) {
      [80, 95, 100, 104, 120].forEach(function (S) {
        [1 / 12, 0.25, 1].forEach(function (T) { cases.push([t, S, T]); });
      });
    });
    it("delta, gamma, vega", function () {
      cases.forEach(function (c) {
        var t = c[0], S = c[1], T = c[2], v = 0.2, tag = t + " S" + S + " T" + T.toFixed(2);
        near(GM.value("delta", t, S, 100, T, v), delta(t, S, T, v), 1e-4, "delta " + tag);
        near(GM.value("gamma", t, S, 100, T, v), (delta(t, S + 0.01, T, v) - delta(t, S - 0.01, T, v)) / 0.02, 1e-3, "gamma " + tag);
        near(GM.value("vega", t, S, 100, T, v), vegaPt(t, S, T, v), 1e-4, "vega " + tag);
      });
    });
    it("theta (per day), vanna, volga, charm", function () {
      cases.forEach(function (c) {
        var t = c[0], S = c[1], T = c[2], v = 0.2, tag = t + " S" + S + " T" + T.toFixed(2), d = 1e-5;
        near(GM.value("theta", t, S, 100, T, v), (price(t, S, T - d, v) - price(t, S, T + d, v)) / (2 * d) / 365, 1e-4, "theta " + tag);
        near(GM.value("vanna", t, S, 100, T, v), (delta(t, S, T, v + 0.0001) - delta(t, S, T, v - 0.0001)) / 0.02, 1e-4, "vanna " + tag);
        near(GM.value("volga", t, S, 100, T, v), (vegaPt(t, S, T, v + 0.001) - vegaPt(t, S, T, v - 0.001)) / 0.2, 1e-4, "volga " + tag);
        near(GM.value("charm", t, S, 100, T, v), (delta(t, S, T - d, v) - delta(t, S, T + d, v)) / (2 * d) / 365, 1e-4, "charm " + tag);
      });
    });
  });

  describe("greeksMath · textbook shapes", function () {
    var T = 0.25, v = 0.2;
    it("put delta = call delta − 1; gamma, vega, theta, vanna, volga, charm equal for calls and puts", function () {
      [85, 100, 115].forEach(function (S) {
        near(GM.value("delta", "P", S, 100, T, v), GM.value("delta", "C", S, 100, T, v) - 1, 1e-12, "parity");
        ["gamma", "vega", "theta", "vanna", "volga", "charm"].forEach(function (g) {
          near(GM.value(g, "P", S, 100, T, v), GM.value(g, "C", S, 100, T, v), 1e-12, g);
        });
      });
    });
    it("long vanna below the strike, short above; OTM charm bleeds delta to 0", function () {
      expect(GM.value("vanna", "C", 90, 100, T, v) > 0).toBe(true);
      expect(GM.value("vanna", "C", 110, 100, T, v) < 0).toBe(true);
      expect(GM.value("charm", "C", 90, 100, T, v) < 0).toBe(true);   // OTM call: delta falls
      expect(GM.value("charm", "C", 110, 100, T, v) > 0).toBe(true);  // ITM call: delta rises to 1
    });
    it("volga is positive in the wings and slightly negative at the money", function () {
      expect(GM.value("volga", "C", 85, 100, T, v) > 0).toBe(true);
      expect(GM.value("volga", "C", 115, 100, T, v) > 0).toBe(true);
      expect(GM.value("volga", "C", 100, 100, T, v) < 0).toBe(true);
    });
    it("theta = −½·Γ·S²·σ² per year at zero rates", function () {
      [90, 100, 112].forEach(function (S) {
        near(GM.value("theta", "C", S, 100, T, v), -0.5 * GM.value("gamma", "C", S, 100, T, v) * S * S * v * v / 365, 1e-10, "theta/gamma");
      });
    });
    it("ATM rules of thumb sit within 3% of Black-Scholes", function () {
      ["straddle", "call", "gamma", "vega", "theta"].forEach(function (k) {
        var a = GM.atm(k, 100, 0.2, 0.25);
        near(a.rule / a.exact, 1, 0.03, k);
      });
      near(GM.atm("move", 250, 0.3, 0.25).exact, 250 * 0.3 / Math.sqrt(365), 1e-9, "move");
    });
  });

  describe("greeksGame · names and twins", function () {
    var q = { greek: "vanna", opt: { t: "C", q: 1, k: 100 }, T: 0.25, vol: 0.2 };
    it("reads Greek names, letters and descriptions", function () {
      expect(GG.resolveGreek("Vomma").id).toBe("volga");
      expect(GG.resolveGreek("delta decay").id).toBe("charm");
      expect(GG.resolveGreek("dDelta/dVol").id).toBe("vanna");
      expect(GG.resolveGreek("Γ").id).toBe("gamma");
      expect(GG.resolveGreek("thetta").id).toBe("theta");
      expect(GG.resolveGreek("rho").kind).toBe("unknown");
    });
    it("grades: right, wrong, retry; gamma and vega are twins, theta is not", function () {
      expect(GG.gradeName(q, "vanna").grade).toBe("full");
      expect(GG.gradeName(q, "charm").grade).toBe("wrong");
      expect(GG.gradeName(q, "xyz").grade).toBe("retry");
      var gq = { greek: "gamma", opt: q.opt, T: 0.25, vol: 0.2 };
      expect(GG.gradeName(gq, "vega").twin).toBe("vega");
      expect(GG.gradeName(gq, "theta").grade).toBe("wrong");
    });
  });

  describe("greeksGame · draw, tenor, envelope", function () {
    it("draw spec: handles across spot, symmetric scale above the true peak", function () {
      var spec = GG.drawSpec({ greek: "gamma", opt: { t: "C", q: 1, k: 100 }, T: 1 / 12, vol: 0.2 });
      expect(spec.xs.length).toBe(9);
      var peak = Math.max.apply(null, spec.truth);
      expect(spec.yMax > peak).toBe(true);
      expect(GG.gradeDraw(spec, spec.truth).grade).toBe("full");
      expect(GG.gradeDraw(spec, spec.truth.map(function () { return 0; })).grade).toBe("wrong");
    });
    it("short positions flip the profile", function () {
      var l = GG.drawSpec({ greek: "vega", opt: { t: "P", q: 1, k: 100 }, T: 0.25, vol: 0.2 });
      var s = GG.drawSpec({ greek: "vega", opt: { t: "P", q: -1, k: 100 }, T: 0.25, vol: 0.2 });
      near(s.truth[4], -l.truth[4], 1e-12, "flip");
    });
    it("parses tenors with units, refuses bare numbers", function () {
      expect(GG.parseTenor("3m")).toBe(365 / 4);
      expect(GG.parseTenor("2 weeks")).toBe(14);
      expect(GG.parseTenor("45d")).toBe(45);
      expect(GG.parseTenor("1y")).toBe(365);
      expect(GG.parseTenor("0,5 yr")).toBe(182.5);
      expect(GG.parseTenor("3")).toBe(null);
    });
    it("grades tenors: 30% full, one bucket half, beyond wrong", function () {
      var q = { tenor: "2m" };
      expect(GG.gradeTenor(q, "2m").grade).toBe("full");
      expect(GG.gradeTenor(q, "9w").grade).toBe("full");
      expect(GG.gradeTenor(q, "1m").grade).toBe("partial");
      expect(GG.gradeTenor(q, "1w").grade).toBe("wrong");
      expect(GG.gradeTenor(q, "soon").grade).toBe("retry");
    });
    it("grades envelope answers within 10% / 25% of exact", function () {
      var q = { exact: 10 };
      expect(GG.gradeEnvelope(q, "10.8").grade).toBe("full");
      expect(GG.gradeEnvelope(q, "8").grade).toBe("partial");
      expect(GG.gradeEnvelope(q, "5").grade).toBe("wrong");
      expect(GG.gradeEnvelope(q, "abc").grade).toBe("retry");
    });
    it("deals from the filtered pools; maturity mode only uses the main four", function () {
      var prefs = { gExcluded: ["vanna"], gPuts: true, gShorts: true, envExcluded: ["move"] };
      expect(GG.greekPool("gname", prefs).length).toBe(6);
      expect(GG.greekPool("gtenor", prefs).map(function (g) { return g.id; })).toEqual(["delta", "gamma", "vega", "theta"]);
      expect(GG.envPool(prefs).length).toBe(5);
      var deck = GG.makeDeck("gtenor", prefs);
      for (var i = 0; i < 12; i++) {
        var q = deck.next();
        expect(q.opt.q).toBe(1);                      // no short positions when guessing tenor
        expect(!!GG.tenor(q.tenor)).toBe(true);
      }
      var env = GG.makeDeck("envelope", prefs).next();
      expect(env.exact > 0).toBe(true);
      expect(/^e:/.test(env.mid)).toBe(true);
    });
  });

  describe("greeksGame · hints", function () {
    var prefs = { gExcluded: [], gPuts: true, gShorts: true, envExcluded: [] };
    ["gname", "gtenor", "envelope"].forEach(function (mode) {
      it("four distinct choices, the answer among them, the rest wrong · " + mode, function () {
        var deck = GG.makeDeck(mode, prefs);
        for (var i = 0; i < 40; i++) {
          var qq = deck.next(), cs = GG.hintChoices(mode, qq);
          expect(cs.length).toBe(4);
          var labels = cs.map(function (c) { return c.label; });
          expect(labels.filter(function (l, j) { return labels.indexOf(l) === j; }).length).toBe(4);
          var grade = function (v) {
            return mode === "gname" ? GG.gradeName(qq, v).grade : mode === "gtenor" ? GG.gradeTenor(qq, v).grade : GG.gradeEnvelope(qq, v).grade;
          };
          var full = cs.filter(function (c) { return grade(c.value) === "full"; });
          var wrong = cs.filter(function (c) { return grade(c.value) === "wrong"; });
          if (full.length !== 1 || wrong.length !== 3) throw new Error(mode + ": " + labels.join(", "));
        }
      });
    });
  });
})();
