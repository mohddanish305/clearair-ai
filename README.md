# ClearAir — Personal Air Quality Assistant

**PromptWars Virtual · Challenge 06 — Urban Air Quality Assistant**

ClearAir turns live air-quality data into decisions a real person can act on:
what to do today, when to go out, how much pollution an activity will actually
put into the lungs, and what to fix at home first — explained in plain words,
in English or Hindi, and even spoken aloud for people who cannot read.

## Chosen vertical

Urban Air Quality Assistant — a GenAI assistant that suggests low-emission
daily routines, indoor air-quality hacks and sustainable alternatives tailored
to the user's location and lifestyle, and clearly explains the direct impact
of each choice.

## What it does

- **Live air, two scales** — live pollutant data (PM2.5, PM10, NO₂, O₃, SO₂, CO)
  with India's CPCB NAQI computed in code from CPCB's own sub-index breakpoints,
  plus a US EPA toggle, because the same air scores differently on each scale.
- **Personal Risk Score (0–100)** — the same AQI means different risk for a
  healthy walker and a person with asthma who runs. A fixed, transparent
  formula (profile × activity × duration) gives a verdict per person;
  7 one-tap family personas included.
- **Best Window Today** — the day's cleanest hours from the hourly forecast,
  so outdoor plans move to cleaner air instead of being cancelled.
- **Exposure Simulator** — estimated PM2.5 dose (µg) for an activity, and how
  much an N95 saves.
- **Day Planner** — fixed-time activities keep their time; flexible outdoor
  ones are shifted to the cleanest hours automatically.
- **AI daily plan** — a structured plan (English or Hindi) written by GenAI
  from the live numbers, with the exact prompt visible in the app; a built-in
  rules engine produces the same plan offline if the AI is unreachable.
- **Listen, don't read** — one tap speaks today's air and the plan aloud in
  Hindi or English (with a Roman-Hinglish speech fallback when a phone has no
  Hindi voice pack), for users who cannot read.
- **Indoor audit** — household sources (incense, cooking fuel, smoking, dust)
  ranked with rough fix costs in ₹.
- **Impact numbers** — CO₂ saved by switching a trip (car 192 / bike 103 /
  auto 85 / bus-metro 45 g/km factors), exposure reduction, cigarette
  equivalent (Berkeley Earth rule).
- **Compare & share** — live comparison of up to 3 places, a cleaner-direction
  hint, and a shareable AQI card (PNG).
- **Method & Sources** — the app states plainly that its data is a Copernicus
  CAMS model estimate via Open-Meteo, not a CPCB ground-station reading.

## How the features map to the problem statement

The problem statement asks for a GenAI assistant that helps people navigate
urban air pollution with (a) low-emission daily routines, (b) indoor
air-quality hacks and (c) sustainable alternatives tailored to location and
lifestyle, with the direct impact of each choice explained:

| Problem-statement ask | ClearAir feature |
| --- | --- |
| Low-emission daily routines | Day Planner (flexible outdoor tasks shifted to the cleanest hours) and the AI daily plan (Morning / Commute / Indoor / Evening) |
| Indoor air-quality hacks | Indoor audit — household sources ranked with ₹ fix costs; ventilation window guidance |
| Sustainable alternatives by location & lifestyle | Commute/transport advice in the plan, driven by the user's own answers and live local data for any searched place |
| Direct impact of each choice, explained | Every plan action carries a quantified impact line (CO₂ saved, exposure avoided); Exposure Simulator shows the PM2.5 dose of an activity and the N95 saving |
| Tailored to the person, not just the city | Personal Risk Score — 7 health personas × activity × duration; same air, different verdict |
| Usable by people who cannot read | "Listen" voice reports in Hindi or English |

## How it works

1. The browser fetches live pollutant levels and a 5-day hourly forecast from
   the Open-Meteo Air Quality API (Copernicus CAMS) — no API key needed.
2. A deterministic logic layer (`logic.js`) computes the CPCB NAQI, the US
   EPA category, the risk score, exposure dose, best window and all impact
   figures. **AI never calculates numbers.**
3. GenAI (Pollinations text API, keyless) receives only those computed facts
   in a structured prompt and writes the plan in plain language. The prompt
   is viewable in the app ("See the exact prompt").
4. If live data or the AI is unreachable, the app says so and falls back to
   its built-in engine — it never shows invented numbers as live data.

## Approach and logic

- Scores and verdicts are deterministic and unit-tested logic, so two users
  with the same inputs always get the same numbers; the AI layer is used only
  where language helps — writing, explaining, translating tone.
- Voice uses the Web Speech API with chunked utterances, a cancel/speak
  delay and a resume watchdog (Android TTS quirks), plus the Roman-Hinglish
  fallback described above.
- Security: no accounts, no tracking, no API keys anywhere; all rendering is
  text-safe, and the page runs under a strict content-security policy in its
  multi-file form.

## Assumptions made

- Open-Meteo/CAMS values are area-level model estimates; official readings
  remain CPCB's. The app says this wherever it matters.
- Breathing rates used for dose: rest 0.5, light 1.1, moderate 1.9,
  vigorous 3.0 m³/h (standard reference values, documented in the code).
- Risk-score weights are a transparent heuristic for guidance, not a medical
  diagnosis; the app labels its output as general information.

## GenAI services used, and where

- **Pollinations text API** — writes the personalised daily plan and answers
  in "Ask ClearAir", grounded only in the app's computed live facts.
- Built-in rules engine mirrors the same plan structure with no AI, so the
  app works fully offline of the AI service.

## Tech

Plain HTML/CSS/JavaScript split into small static files — no build step,
no framework, no npm dependencies for the app itself:

- `index.html` — markup only
- `styles.css` — all styling
- `logic.js` — the pure deterministic logic (NAQI, risk score, exposure
  dose, best window); loads as a browser global (`window.ClearAirLogic`)
  and as a Node module, so the tests exercise the exact code the page runs
- `app.js` — state, data loading, rendering and events; loaded after
  `logic.js`
- `tests/` — the unit-test suite (below)

Plus: Open-Meteo Geocoding + Air Quality APIs, an OpenStreetMap embed,
Lucide icons, Web Speech API. Deployable as-is on GitHub Pages.

## Testing

The deterministic logic is unit-tested with Node's built-in test runner
(zero dependencies). The suite covers CPCB NAQI at breakpoint boundaries
and inside bands (all six pollutants: PM2.5, PM10, NO2, SO2, O3, CO),
category thresholds on both scales (labels and the colour variable each
category returns), US
EPA AQI for known PM2.5 inputs, risk-score bounds and persona ordering,
the integrity of the persona/activity lookup tables the UI renders from,
sub-index and risk-score monotonicity, exposure-dose monotonicity and
the N95 reduction, and best-window selection over hourly values:

```sh
node --test tests/logic.test.js   # 32 tests, all passing
```

## Run locally

Open `index.html` in any modern browser — no server, keys or build needed
(or serve the folder with any static file server).
