/*
 * Tests for ClearAir's deterministic logic (../logic.js).
 * Run with: node --test tests/
 * Zero dependencies — Node's built-in test runner only.
 * Every expected value below is derived from the documented formulas
 * (CPCB / EPA breakpoint interpolation, the risk-score formula, the
 * dose formula), not copied from the implementation's output.
 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

/* ---------- CPCB sub-index: PM2.5 ---------- */

test("PM2.5 sub-index at band tops matches CPCB breakpoints", () => {
  // CPCB PM2.5 bands end at 30/60/90/120/250/500 µg/m³ -> 50/100/200/300/400/500
  assert.equal(L.subIndex(30, L.BP.pm25), 50);
  assert.equal(L.subIndex(60, L.BP.pm25), 100);
  assert.equal(L.subIndex(90, L.BP.pm25), 200);
  assert.equal(L.subIndex(120, L.BP.pm25), 300);
  assert.equal(L.subIndex(250, L.BP.pm25), 400);
  assert.equal(L.subIndex(500, L.BP.pm25), 500);
});

test("PM2.5 sub-index interpolates linearly inside a band", () => {
  assert.equal(L.subIndex(0, L.BP.pm25), 0);
  assert.equal(L.subIndex(15, L.BP.pm25), 25);   // halfway 0->30 maps to 25
  assert.equal(L.subIndex(45, L.BP.pm25), 75);   // halfway 30->60 maps to 75
  assert.equal(L.subIndex(75, L.BP.pm25), 150);  // halfway 60->90 maps to 150
  assert.equal(L.subIndex(31, L.BP.pm25), 52);   // 50 + 50*(1/30) = 51.67 -> 52
});

test("PM2.5 sub-index above the table extrapolates the last band", () => {
  // Documented behaviour of the shared engine: 400 + 100*(600-250)/(500-250) = 540.
  assert.equal(L.subIndex(600, L.BP.pm25), 540);
});

/* ---------- CPCB sub-index: PM10 ---------- */

test("PM10 sub-index at band tops and inside bands", () => {
  assert.equal(L.subIndex(50, L.BP.pm10), 50);
  assert.equal(L.subIndex(100, L.BP.pm10), 100);
  assert.equal(L.subIndex(200, L.BP.pm10), 200);
  assert.equal(L.subIndex(75, L.BP.pm10), 75);   // halfway 50->100
  assert.equal(L.subIndex(150, L.BP.pm10), 150); // halfway 100->200
});

/* ---------- CPCB sub-index: NO2, SO2, O3, CO ----------
   The page computes sub-indices for all six pollutants, so all six
   breakpoint tables get the same band-top + interpolation checks. */

test("NO2 sub-index at band tops and inside a band", () => {
  // CPCB NO2 bands end at 40/80/180/280/400/800 µg/m³ -> 50/100/200/300/400/500
  assert.equal(L.subIndex(40, L.BP.no2), 50);
  assert.equal(L.subIndex(80, L.BP.no2), 100);
  assert.equal(L.subIndex(180, L.BP.no2), 200);
  assert.equal(L.subIndex(280, L.BP.no2), 300);
  assert.equal(L.subIndex(400, L.BP.no2), 400);
  assert.equal(L.subIndex(800, L.BP.no2), 500);
  assert.equal(L.subIndex(60, L.BP.no2), 75); // halfway 40->80 maps to 75
});

test("SO2 sub-index at band tops and inside a band", () => {
  // CPCB SO2 bands end at 40/80/380/800/1600/3200 µg/m³
  assert.equal(L.subIndex(40, L.BP.so2), 50);
  assert.equal(L.subIndex(80, L.BP.so2), 100);
  assert.equal(L.subIndex(380, L.BP.so2), 200);
  assert.equal(L.subIndex(800, L.BP.so2), 300);
  assert.equal(L.subIndex(1600, L.BP.so2), 400);
  assert.equal(L.subIndex(3200, L.BP.so2), 500);
  assert.equal(L.subIndex(230, L.BP.so2), 150); // halfway 80->380 maps to 150
});

test("O3 sub-index at band tops and inside a band", () => {
  // CPCB O3 bands end at 50/100/168/208/748/1200 µg/m³
  assert.equal(L.subIndex(50, L.BP.o3), 50);
  assert.equal(L.subIndex(100, L.BP.o3), 100);
  assert.equal(L.subIndex(168, L.BP.o3), 200);
  assert.equal(L.subIndex(208, L.BP.o3), 300);
  assert.equal(L.subIndex(748, L.BP.o3), 400);
  assert.equal(L.subIndex(1200, L.BP.o3), 500);
  assert.equal(L.subIndex(134, L.BP.o3), 150); // halfway 100->168 maps to 150
});

test("CO sub-index at band tops and inside bands (mg/m³, 8 h)", () => {
  // CPCB CO bands end at 1/2/10/17/34/50 mg/m³
  assert.equal(L.subIndex(1, L.BP.co), 50);
  assert.equal(L.subIndex(2, L.BP.co), 100);
  assert.equal(L.subIndex(10, L.BP.co), 200);
  assert.equal(L.subIndex(17, L.BP.co), 300);
  assert.equal(L.subIndex(34, L.BP.co), 400);
  assert.equal(L.subIndex(50, L.BP.co), 500);
  assert.equal(L.subIndex(1.5, L.BP.co), 75);  // halfway 1->2 maps to 75
  assert.equal(L.subIndex(6, L.BP.co), 150);   // halfway 2->10 maps to 150
});

/* ---------- NAQI = max of sub-indices ---------- */

test("naqiFromMeans takes the maximum sub-index (CPCB definition)", () => {
  const clean = { pm25: 0, pm10: 0, no2: 0, so2: 0, o3: 0, co: 0 };
  assert.equal(L.naqiFromMeans(clean).naqi, 0);

  const pm25Led = { ...clean, pm25: 60 }; // PM2.5 sub-index 100
  const r1 = L.naqiFromMeans(pm25Led);
  assert.equal(r1.subs.pm25, 100);
  assert.equal(r1.naqi, 100);

  const pm10Led = { ...clean, pm25: 30, pm10: 200 }; // subs 50 vs 200
  const r2 = L.naqiFromMeans(pm10Led);
  assert.equal(r2.subs.pm10, 200);
  assert.equal(r2.naqi, 200);
});

test("naqiFromMeans: a gas-led day (CO or O3) also sets the NAQI", () => {
  const clean = { pm25: 0, pm10: 0, no2: 0, so2: 0, o3: 0, co: 0 };
  const coLed = L.naqiFromMeans({ ...clean, co: 10 }); // CO sub-index 200
  assert.equal(coLed.subs.co, 200);
  assert.equal(coLed.naqi, 200);
  const o3Led = L.naqiFromMeans({ ...clean, o3: 168 }); // O3 sub-index 200
  assert.equal(o3Led.subs.o3, 200);
  assert.equal(o3Led.naqi, 200);
  // every pollutant gets a sub-index, even on a clean day
  assert.deepEqual(Object.keys(coLed.subs).sort(), ["co", "no2", "o3", "pm10", "pm25", "so2"]);
});

/* ---------- Category thresholds ---------- */

test("CPCB categories switch at 50/100/200/300/400", () => {
  const cat = (a) => L.catIN(a)[0];
  assert.equal(cat(50), "Good");
  assert.equal(cat(51), "Satisfactory");
  assert.equal(cat(100), "Satisfactory");
  assert.equal(cat(101), "Moderate");
  assert.equal(cat(200), "Moderate");
  assert.equal(cat(201), "Poor");
  assert.equal(cat(300), "Poor");
  assert.equal(cat(301), "Very Poor");
  assert.equal(cat(400), "Very Poor");
  assert.equal(cat(401), "Severe");
  assert.equal(cat(500), "Severe");
  assert.equal(cat(0), "Good");
});

test("US EPA categories switch at 50/100/150/200/300", () => {
  const cat = (a) => L.catUS(a)[0];
  assert.equal(cat(50), "Good");
  assert.equal(cat(51), "Moderate");
  assert.equal(cat(100), "Moderate");
  assert.equal(cat(101), "Unhealthy for sensitive groups");
  assert.equal(cat(150), "Unhealthy for sensitive groups");
  assert.equal(cat(151), "Unhealthy");
  assert.equal(cat(200), "Unhealthy");
  assert.equal(cat(201), "Very Unhealthy");
  assert.equal(cat(300), "Very Unhealthy");
  assert.equal(cat(301), "Hazardous");
  assert.equal(cat(0), "Good");
  assert.equal(cat(500), "Hazardous");
});

/* ---------- US EPA AQI for PM2.5 ---------- */

test("EPA AQI at PM2.5 breakpoint tops", () => {
  // EPA PM2.5 bands end at 12/35.4/55.4/150.4/250.4/500.4 µg/m³
  assert.equal(L.epaAqiPm25(0), 0);
  assert.equal(L.epaAqiPm25(12), 50);
  assert.equal(L.epaAqiPm25(35.4), 100);
  assert.equal(L.epaAqiPm25(55.4), 150);
  assert.equal(L.epaAqiPm25(250.4), 300);
  assert.equal(L.epaAqiPm25(500.4), 500);
  assert.equal(L.epaAqiPm25(23.7), 75); // halfway through the 51-100 band
});

test("EPA AQI above the table extrapolates the last band, like CPCB", () => {
  // Same documented engine behaviour: 300 + 200*(600-250.4)/(500.4-250.4) = 579.68 -> 580
  assert.equal(L.epaAqiPm25(600), 580);
});

/* ---------- Personal Risk Score ---------- */

const persona = (id) => L.PERSONAS.find((p) => p[0] === id)[3];

test("risk score is clamped to 1..100", () => {
  assert.equal(L.riskScore(0, persona("general"), L.ACTF.walk.f, 30, false), 1);
  // Worst case: NAQI 500, asthma, running, 200 min -> far above 100 before clamping
  assert.equal(L.riskScore(500, persona("asthma"), L.ACTF.run.f, 200, false), 100);
});

test("risk score matches the documented formula on a worked example", () => {
  // NAQI 100 -> base 20; general(1) x walk(1) x (0.55 + 40/200 = 0.75) = 15
  assert.equal(L.riskScore(100, persona("general"), L.ACTF.walk.f, 40, false), 15);
  // asthma(1.8) x run(2.1): 20 x 1.8 x 2.1 x 0.75 = 56.7 -> 57
  assert.equal(L.riskScore(100, persona("asthma"), L.ACTF.run.f, 40, false), 57);
});

test("for the same air, asthma+running scores higher than healthy+walk", () => {
  const asthmaRun = L.riskScore(100, persona("asthma"), L.ACTF.run.f, 40, false);
  const healthyWalk = L.riskScore(100, persona("general"), L.ACTF.walk.f, 40, false);
  assert.ok(asthmaRun > healthyWalk, `${asthmaRun} should exceed ${healthyWalk}`);
});

test("risk score grows with duration and drops with an N95", () => {
  const short = L.riskScore(100, 1, 1, 20, false);
  const long = L.riskScore(100, 1, 1, 120, false);
  assert.ok(long > short);
  const masked = L.riskScore(100, 1, 1, 40, true);
  assert.equal(masked, 5); // 15 x 0.35 = 5.25 -> 5
  assert.ok(masked < L.riskScore(100, 1, 1, 40, false));
});

test("risk score floor holds even when an N95 shrinks a tiny score", () => {
  // NAQI 10 -> base 2; x (0.55 + 0/200) = 1.1; x 0.35 (N95) = 0.385 -> rounds
  // to 0, but the documented clamp keeps the score at the 1 minimum.
  assert.equal(L.riskScore(10, 1, 1, 0, true), 1);
});

test("risk bands switch at 25/50/75", () => {
  assert.equal(L.riskBand(24), 0);
  assert.equal(L.riskBand(25), 1);
  assert.equal(L.riskBand(49), 1);
  assert.equal(L.riskBand(50), 2);
  assert.equal(L.riskBand(74), 2);
  assert.equal(L.riskBand(75), 3);
  assert.equal(L.riskBand(100), 3);
});

/* ---------- Exposure dose ---------- */

test("exposure dose = concentration x rate x hours", () => {
  assert.equal(L.exposureDose(100, 1.5, 60), 150);
  assert.equal(L.exposureDose(80, 2, 30), 80);
  assert.equal(L.exposureDose(0, 2, 60), 0);
});

test("exposure dose is monotonic in duration and concentration", () => {
  assert.ok(L.exposureDose(50, 1, 60) > L.exposureDose(50, 1, 30));
  assert.ok(L.exposureDose(100, 1, 60) > L.exposureDose(50, 1, 60));
});

test("a fitted N95 leaves 5% of the dose", () => {
  const dose = L.exposureDose(80, 2, 30); // 80 µg
  const masked = L.maskedDose(dose);
  assert.ok(Math.abs(masked - dose * 0.05) < 1e-9);
  assert.ok(masked < dose);
  assert.equal(L.maskedDose(0), 0);
});

/* ---------- Best window ---------- */

const hours = (pms) => pms.map((pm, i) => ({ t: `2026-11-21T${String(i).padStart(2, "0")}:00`, pm }));

test("best window picks the lowest-PM2.5 consecutive pair", () => {
  const b = L.bestWindowFromHours(hours([50, 40, 10, 20, 90]));
  assert.equal(b.avg, 15); // (10+20)/2
  assert.equal(b.from, "2026-11-21T02:00");
  assert.equal(b.to, "2026-11-21T03:00");
});

test("best window is a contiguous block, not the two lowest single hours", () => {
  // Hours 0 (5) and 2 (6) are individually lowest but not adjacent;
  // the winning pair must be hours 0-1 with mean 52.5.
  const b = L.bestWindowFromHours(hours([5, 100, 6]));
  assert.equal(b.avg, 52.5);
  assert.equal(b.from, "2026-11-21T00:00");
});

test("best window keeps the earliest pair on ties and needs 2+ hours", () => {
  const b = L.bestWindowFromHours(hours([10, 10, 10]));
  assert.equal(b.from, "2026-11-21T00:00");
  assert.equal(L.bestWindowFromHours(hours([10])), null);
  assert.equal(L.bestWindowFromHours([]), null);
});

test("best window with exactly two hours returns that single pair", () => {
  const b = L.bestWindowFromHours(hours([30, 10]));
  assert.equal(b.avg, 20);
  assert.equal(b.from, "2026-11-21T00:00");
  assert.equal(b.to, "2026-11-21T01:00");
});

/* ---------- Lookup-table integrity ----------
   The page renders one chip per persona and reads ACTF[select value]
   directly in calcRisk(): a missing key or a duplicated persona id
   would break the risk card at runtime, so the tables' shape is part
   of the contract, not an implementation detail. */

test("PERSONAS: 7 unique profiles, asthma the most sensitive", () => {
  assert.equal(L.PERSONAS.length, 7);
  const ids = L.PERSONAS.map((p) => p[0]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [id, label, icon, factor] of L.PERSONAS) {
    assert.ok(label.length > 0 && icon.length > 0, `${id} needs a label and an icon`);
    assert.ok(factor >= 1, `${id} factor must be >= the general-adult baseline`);
  }
  const asthma = L.PERSONAS.find((p) => p[0] === "asthma")[3];
  for (const p of L.PERSONAS) assert.ok(asthma >= p[3], "asthma is documented as most sensitive");
});

test("ACTF: every activity the UI offers has a positive factor and a label", () => {
  assert.deepEqual(Object.keys(L.ACTF).sort(), ["commute", "cycle", "play", "run", "walk", "work"]);
  for (const k of Object.keys(L.ACTF)) {
    assert.ok(L.ACTF[k].f > 0, `${k} factor must be positive`);
    assert.ok(L.ACTF[k].label.length > 0, `${k} needs a verdict label`);
  }
});

/* ---------- Monotonicity properties ---------- */

test("sub-index never decreases as concentration rises, within every CPCB table", () => {
  for (const key of Object.keys(L.BP)) {
    const bp = L.BP[key], top = bp[bp.length - 1][0];
    let prev = 0;
    for (let i = 0; i <= 97; i++) {
      const v = (top * i) / 97;
      const s = L.subIndex(v, bp);
      assert.ok(s >= prev, `${key}: subIndex(${v}) = ${s} < previous ${prev}`);
      assert.ok(s >= 0 && s <= 500, `${key}: subIndex(${v}) = ${s} outside 0..500`);
      prev = s;
    }
    assert.equal(prev, 500); // the sweep ends exactly at the table top
  }
});

test("risk score never decreases as the NAQI rises", () => {
  let prev = 0;
  for (let aqi = 0; aqi <= 500; aqi += 25) {
    const s = L.riskScore(aqi, persona("general"), L.ACTF.walk.f, 60, false);
    assert.ok(s >= prev, `riskScore(${aqi}) = ${s} < previous ${prev}`);
    prev = s;
  }
});

/* ---------- Category return pairs ----------
   renderAll() uses element [1] of the pair as the category dot's
   colour, so the colour variable is part of the contract too. */

test("categories return [label, colour variable] pairs on both scales", () => {
  assert.deepEqual(L.catIN(10), ["Good", "var(--good)"]);
  assert.deepEqual(L.catIN(250), ["Poor", "var(--poor)"]);
  assert.deepEqual(L.catIN(450), ["Severe", "var(--severe)"]);
  assert.deepEqual(L.catUS(75), ["Moderate", "var(--fair)"]);
  assert.deepEqual(L.catUS(120), ["Unhealthy for sensitive groups", "var(--mod)"]);
  assert.deepEqual(L.catUS(250), ["Very Unhealthy", "var(--vpoor)"]);
});
