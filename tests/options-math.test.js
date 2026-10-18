// options-math.test.js — the Options Lab engine against the C2 strategy tables
// (the C2 strategy sheet (see README)), plus the classifier.
(function () {
  "use strict";
  var M = window.M1.lib.optionsMath;
  var D = window.M1.data.optionStrategies;

  function near(actual, expected, tol, what) {
    if (Math.abs(actual - expected) > tol) {
      throw new Error(what + ": expected " + expected + " ± " + tol + ", got " + actual.toFixed(4));
    }
  }

  // C2 "All strategies: Greeks, cost and purpose" — net premium (+ = pay), Δ, Γ, ν, Θ.
  var C2 = {
    "long-call": [3.99, 0.52, 0.040, 0.20, -0.022],
    "long-put": [3.99, -0.48, 0.040, 0.20, -0.022],
    "short-call": [-3.99, -0.52, -0.040, -0.20, 0.022],
    "short-put": [-3.99, 0.48, -0.040, -0.20, 0.022],
    "long-straddle": [7.98, 0.04, 0.080, 0.40, -0.044],
    "short-straddle": [-7.98, -0.04, -0.080, -0.40, 0.044],
    "long-strangle": [1.70, -0.04, 0.048, 0.24, -0.026],
    "short-strangle": [-1.70, 0.04, -0.048, -0.24, 0.026],
    "put-spread": [3.41, -0.39, 0.027, 0.12, -0.010],
    "call-spread": [3.89, 0.48, 0.030, 0.16, -0.019],
    "collar": [0.60, 0.69, -0.005, 0.02, -0.007],
    "risk-reversal": [-0.60, 0.31, 0.005, -0.02, 0.007],
    "put-ratio": [1.69, -0.14, -0.003, -0.06, 0.011],
    "butterfly": [3.72, -0.08, -0.032, -0.16, 0.017],
    "seagull": [1.07, 0.66, -0.007, -0.02, 0.001],
    "calendar": [1.68, 0.01, -0.029, 0.08, 0.016],
    "covered-call": [-1.76, 0.69, -0.039, -0.18, 0.018],
    "protective-put": [2.20, 0.70, 0.032, 0.17, -0.021],
    "bull-put-spread": [-1.62, 0.21, -0.019, -0.09, 0.009],
    "bear-call-spread": [-1.66, -0.28, -0.029, -0.14, 0.015],
    "iron-condor": [-3.27, -0.07, -0.048, -0.23, 0.024],
    "iron-butterfly": [-6.28, -0.08, -0.032, -0.16, 0.017],
    "call-ratio": [2.89, 0.25, -0.012, -0.02, -0.002],
    "put-backspread": [-1.69, 0.14, 0.003, 0.06, -0.011],
    "strip": [11.96, -0.44, 0.120, 0.60, -0.066],
    "synthetic-long": [0, 1.00, 0, 0, 0]
  };

  // C2 breakevens at expiry.
  var BE = {
    "long-straddle": [92, 108], "long-strangle": [88.3, 111.7], "put-spread": [96.6], "call-spread": [103.9],
    "collar": [100.6], "risk-reversal": [89.4], "put-ratio": [81.7, 98.3], "butterfly": [93.7, 106.3],
    "seagull": [101.1], "calendar": [96.3, 104.0], "covered-call": [98.2], "protective-put": [102.2],
    "iron-condor": [91.7, 108.3], "call-ratio": [102.9, 117.1], "strip": [94, 112]
  };

  describe("optionsMath · C2 reference numbers", function () {
    it("prices the ATM 3M call at 3.99 and the skewed 85 put at 0.58", function () {
      near(M.legPremium({ t: "C", q: 1, k: 100, exp: "B" }), 3.99, 0.005, "100 call");
      near(M.legPremium({ t: "P", q: 1, k: 85, exp: "B" }), 0.58, 0.005, "85 put");
      near(M.legPremium({ t: "C", q: 1, k: 100, exp: "F" }), 2.30, 0.005, "1M 100 call");
    });
    Object.keys(C2).forEach(function (id) {
      it("matches C2 premium and Greeks · " + id, function () {
        var pos = M.instantiate(id), g = M.greeks(pos), ref = C2[id];
        near(M.netPremium(pos), ref[0], 0.015, "premium");
        near(g.delta, ref[1], 0.011, "delta");
        near(g.gamma, ref[2], 0.0011, "gamma");
        near(g.vega, ref[3], 0.011, "vega");
        near(g.theta, ref[4], 0.0011, "theta");
      });
    });
    Object.keys(BE).forEach(function (id) {
      it("matches C2 breakevens · " + id, function () {
        var got = M.breakevens(M.instantiate(id));
        expect(got.length).toBe(BE[id].length);
        got.forEach(function (b, i) { near(b, BE[id][i], 0.11, "breakeven " + i); });
      });
    });
    it("reads unlimited and capped extremes", function () {
      expect(M.extremes(M.instantiate("long-call")).maxGain).toBe(Infinity);
      expect(M.extremes(M.instantiate("short-straddle")).maxLoss).toBe(-Infinity);
      near(M.extremes(M.instantiate("put-spread")).maxGain, 11.6, 0.05, "put spread max gain");
      near(M.extremes(M.instantiate("iron-condor")).maxLoss, -6.7, 0.05, "condor max loss");
    });
  });

  describe("optionsMath · classifier", function () {
    it("names every strategy's own C2 instance as itself and nothing else", function () {
      D.strategies.forEach(function (s) {
        var ids = M.classify(M.instantiate(s));
        if (ids.length !== 1 || ids[0] !== s.id) throw new Error(s.id + " classified as " + JSON.stringify(ids));
      });
    });
    it("names every dealt variant as itself", function () {
      D.strategies.forEach(function (s) {
        M.paramGrid(s).forEach(function (p) {
          var ids = M.classify(M.instantiate(s, p));
          if (ids.indexOf(s.id) < 0) throw new Error(s.id + " @" + JSON.stringify(p) + " → " + JSON.stringify(ids));
        });
      });
    });
    it("is indifferent to leg order, split legs and size", function () {
      var legs = [
        { t: "P", q: -1, k: 85, exp: "B" }, { t: "P", q: 1, k: 100, exp: "B" },
        { t: "P", q: 1, k: 100, exp: "B" }, { t: "P", q: -1, k: 85, exp: "B" }
      ];
      expect(M.classify(legs)).toEqual(["put-spread"]);
    });
    it("respects strike order: long the LOWER put is a bull put spread, not a put spread", function () {
      expect(M.classify([{ t: "P", q: 1, k: 85, exp: "B" }, { t: "P", q: -1, k: 100, exp: "B" }])).toEqual(["bull-put-spread"]);
    });
    it("tells a straddle from a strangle and a synthetic from a risk reversal", function () {
      expect(M.classify([{ t: "C", q: 1, k: 105, exp: "B" }, { t: "P", q: 1, k: 105, exp: "B" }])).toEqual(["long-straddle"]);
      expect(M.classify([{ t: "C", q: 1, k: 100, exp: "B" }, { t: "P", q: -1, k: 100, exp: "B" }])).toEqual(["synthetic-long"]);
      expect(M.classify([{ t: "C", q: 1, k: 110, exp: "B" }, { t: "P", q: -1, k: 90, exp: "B" }])).toEqual(["risk-reversal"]);
    });
    it("needs two expiries for a calendar", function () {
      expect(M.classify([{ t: "C", q: -1, k: 100, exp: "F" }, { t: "C", q: 1, k: 100, exp: "B" }])).toEqual(["calendar"]);
      expect(M.classify([{ t: "C", q: -1, k: 100, exp: "B" }, { t: "C", q: 1, k: 100, exp: "B" }])).toEqual([]);
    });
    it("returns nothing for an empty or unnamed position", function () {
      expect(M.classify([])).toEqual([]);
      expect(M.classify([{ t: "C", q: 3, k: 90, exp: "B" }, { t: "P", q: -1, k: 120, exp: "B" }])).toEqual([]);
    });
  });

  describe("optionsMath · parity twins", function () {
    it("call butterfly and iron butterfly share the expiry P&L exactly", function () {
      expect(M.samePnl(M.instantiate("butterfly"), M.instantiate("iron-butterfly"))).toBe(true);
    });
    it("covered call 105 = short put 105; call spread = bull put spread on the same strikes", function () {
      expect(M.samePnl(M.instantiate("covered-call"), M.instantiate("short-put", { c: 105 }))).toBe(true);
      expect(M.samePnl(M.instantiate("call-spread", { c: 85, w: 10 }), M.instantiate("bull-put-spread", { c: 100, w: 5 }))).toBe(true);
    });
    it("a put spread is not a call spread", function () {
      expect(M.sameShape(M.instantiate("put-spread"), M.instantiate("call-spread"))).toBe(false);
    });
  });
})();
