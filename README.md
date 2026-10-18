# Vol Game

**Try it in your browser: https://poctave.github.io/vol-game/**

A typed options-strategy game that runs in the browser. You recognise, price and build option strategies against the clock.

**Strategy modes**
- **Payoff**: name the strategy from its payoff diagram.
- **Greeks**: name it from the signs of its Greeks.
- **Build**: assemble the legs of a named strategy.
- **Draw**: draw the expiry payoff.

**Greek modes**
- Name a Greek from its profile, or draw it.
- Match a profile to its maturity.
- Back-of-the-envelope numbers (ATM straddle, vega, gamma P&L…).

**Formats and progress**
- Mixed runs, a 5 / 10 / 20-question format or survival.
- Difficulty tiers, and filters per strategy and per Greek.
- Points, ranks and a mastery board.

## Run it

Online: https://poctave.github.io/vol-game/. Locally: it is a static page with no build step and no dependencies, so open `index.html` in a browser, or serve the folder (`python3 -m http.server`). Progress is kept in `localStorage`.

## Tests

```
node run-tests.js
```

## Layout

- `js/data/option-strategies.js`: the strategy book. Each strategy is a template (strike = centre + offset × wing), so it can be dealt at different strikes.
- `js/options-math.js`: Black-Scholes pricing, payoff, Greeks and the classifier.
- `js/options-game.js`, `js/greeks-math.js`, `js/greeks-game.js`: rules, dealing and grading.
- `js/views/terminal-options.js`: the UI. `js/frame.js` is the console chrome.

"C2" is the reference setup the numbers are pinned to: S₀ = 100, 3-month options, zero rates, and an equity skew (20% at 100, 23.7% at 90, 25.7% at 85, 16.7% at 110, 15.1% at 115). The tests check every premium and Greek against it.
