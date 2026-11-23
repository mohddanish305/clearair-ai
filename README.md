# ClearAir — Urban Air Quality Assistant

A personal air-quality assistant for Indian families: it does not just show an AQI number, it tells each household what to do today — low-emission daily routines, indoor air-quality hacks, and sustainable alternatives, with the direct impact of every choice explained.

**Live app:** https://mohddanish305.github.io/clearair-ai/

## The build

The app ships as **one self-contained `index.html`** (markup, styles and logic in a single file, Tailwind via CDN, Lucide icons). It has three tabs:

- **Daily Plan** — live AQI hero for any searchable city, household toggles (Seniors, Children, Asthma, No Purifier, Commuter) that genuinely change the risk score and advice, a computed "Today's Impact" strip, and simple steps for today whose timing follows the computed safest hours.
- **Tap & Listen** — a senior-friendly mode: big tap targets that speak the air report and answers aloud in English or Hindi (Web Speech API, with a Hindi-voice fallback that never fails silently).
- **Ask AI** — questions answered by a GenAI service grounded only in the app's computed live facts, with the answer's source labelled in the UI.

Also: full English / हिन्दी interface toggle and a light/dark mode toggle.

## How it works

- **Live data only.** Air quality comes from the Open-Meteo Air Quality API (Copernicus CAMS) and place search from the Open-Meteo Geocoding API — no API keys, nothing predefined or generated. The data source and update time are shown in the app. CAMS is a model estimate, not a CPCB station reading, and the app says so.
- **Numbers are computed, never invented.** CPCB NAQI is calculated in code from the official CPCB breakpoint tables (trailing 24-h means; 8-h for O₃/CO), alongside a US EPA AQI, a personal risk score (health × activity × duration), an exposure-dose estimate with/without an N95, and the day's safest window from the hourly forecast. One computed state feeds every tab, so the same city shows the same AQI everywhere.
- **The calculation engine** is inlined in `index.html` and also provided as the module `logic.js`. The two are verified to produce identical results; the automated test suite covers `logic.js`.
- **GenAI, honestly fenced in.** The Pollinations text API (keyless, client-side) writes plan text and answers Ask questions using only the computed facts, in a structured prompt the app shows verbatim. The AI never calculates or decides a number or a safety verdict. If the AI service is unreachable, a built-in rules engine produces the plan/answer from the same inputs, and the UI labels which source was used.

## Testing

`tests/logic.test.js` — 32 automated tests (Node's built-in runner, zero dependencies): all six CPCB pollutant breakpoint tables, category thresholds, persona/activity table integrity, sub-index and risk-score monotonicity, exposure dose and best-window selection. Run with:

```
node --test tests/logic.test.js
```

## Assumptions

- A "day" plan uses the trailing 24-h mean for NAQI (the CPCB convention) and the hourly CAMS forecast for the safest-window and ventilation advice.
- Impact figures marked "(est.)" are documented estimates (e.g. commute CO₂), not measurements; health figures come from the deterministic formulas above, not from the AI.
