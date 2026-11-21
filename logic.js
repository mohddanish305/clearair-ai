/*
 * ClearAir — deterministic air-quality logic.
 *
 * Every number the app shows (CPCB NAQI, personal risk score, exposure
 * dose, best window) is computed here by fixed, documented formulas.
 * This file has no DOM, network or browser dependencies: it loads as a
 * plain browser script (window.ClearAirLogic) and as a Node module
 * (module.exports) so the exact code that runs in the page is what the
 * test-suite in tests/ exercises.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClearAirLogic = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Piecewise-linear sub-index for one pollutant.
   *
   * @param {number} v  Pollutant concentration (units per the table).
   * @param {Array<[number, number, number]>} bp  Breakpoint rows
   *   [upperConcentration, indexLow, indexHigh], ascending.
   * @returns {number} Sub-index, rounded to the nearest integer.
   *
   * The value is interpolated linearly between the previous row's top
   * (concentration, index) point and this row's top point; the first row
   * interpolates from (0, 0). Values above the last row return that
   * row's indexHigh. Formula: the CPCB sub-index interpolation,
   * I = I_lo + (I_hi - I_lo) * (C - C_lo) / (C_hi - C_lo).
   */
  function subIndex(v, bp) { // bp: [[conc,lo,hi],...]
    for (var i = 0; i < bp.length; i++) { var b = bp[i];
      if (v <= b[0] || i === bp.length - 1) { var p = i === 0 ? { c0: 0, i0: 0 } : { c0: bp[i - 1][0], i0: bp[i - 1][2] };
        if (b[0] === p.c0) return b[2];
        return Math.round(p.i0 + (b[2] - p.i0) * (v - p.c0) / (b[0] - p.c0)); } }
    return 500;
  }

  /**
   * CPCB (India) breakpoint tables, one row per AQI band:
   * [upper concentration, sub-index low, sub-index high].
   * Source: CPCB National Air Quality Index breakpoints.
   * Units: µg/m³ for PM2.5, PM10, NO2, SO2, O3; mg/m³ (8 h) for CO.
   * The app feeds each pollutant's trailing mean (24 h; 8 h for O3/CO).
   */
  var BP = {
    pm25: [[30, 0, 50], [60, 51, 100], [90, 101, 200], [120, 201, 300], [250, 301, 400], [500, 401, 500]],
    pm10: [[50, 0, 50], [100, 51, 100], [200, 101, 200], [300, 201, 300], [400, 301, 400], [500, 401, 500]],
    no2: [[40, 0, 50], [80, 51, 100], [180, 101, 200], [280, 201, 300], [400, 301, 400], [800, 401, 500]],
    so2: [[40, 0, 50], [80, 51, 100], [380, 101, 200], [800, 201, 300], [1600, 301, 400], [3200, 401, 500]],
    o3: [[50, 0, 50], [100, 51, 100], [168, 101, 200], [208, 201, 300], [748, 301, 400], [1200, 401, 500]],
    co: [[1, 0, 50], [2, 51, 100], [10, 101, 200], [17, 201, 300], [34, 301, 400], [50, 401, 500]] // mg/m3, 8h
  };

  /**
   * US EPA PM2.5 breakpoint table (24 h, µg/m³), same row format as BP.
   * Source: US EPA AQI breakpoints for PM2.5.
   *
   * Note: the ClearAir page displays the US AQI value supplied by the
   * live Open-Meteo/CAMS feed rather than computing it; this table and
   * epaAqiPm25() exist so the shared subIndex() interpolation engine is
   * specified and tested against the EPA scale too.
   */
  var BP_EPA_PM25 = [[12, 0, 50], [35.4, 51, 100], [55.4, 101, 150], [150.4, 151, 200], [250.4, 201, 300], [500.4, 301, 500]];

  /**
   * US EPA AQI for a PM2.5 concentration, via the shared subIndex()
   * interpolation over BP_EPA_PM25.
   *
   * @param {number} v  PM2.5 concentration in µg/m³.
   * @returns {number} EPA AQI sub-index for PM2.5.
   */
  function epaAqiPm25(v) { return subIndex(v, BP_EPA_PM25); }

  /**
   * CPCB NAQI from trailing-mean pollutant concentrations.
   *
   * @param {{pm25:number, pm10:number, no2:number, so2:number, o3:number, co:number}} trail
   *   Trailing means in the units of BP (CO already converted to mg/m³).
   * @returns {{subs: Object, naqi: number}} Per-pollutant sub-indices and
   *   the NAQI, which CPCB defines as the maximum sub-index.
   */
  function naqiFromMeans(trail) {
    var subs = { pm25: subIndex(trail.pm25, BP.pm25), pm10: subIndex(trail.pm10, BP.pm10), no2: subIndex(trail.no2, BP.no2), so2: subIndex(trail.so2, BP.so2), o3: subIndex(trail.o3, BP.o3), co: subIndex(trail.co, BP.co) };
    return { subs: subs, naqi: Math.max(subs.pm25, subs.pm10, subs.no2, subs.so2, subs.o3, subs.co) };
  }

  /**
   * CPCB category for a NAQI value.
   * @param {number} a  NAQI (0–500).
   * @returns {[string, string]} [label, CSS colour variable].
   */
  function catIN(a) { return a <= 50 ? ["Good", "var(--good)"] : a <= 100 ? ["Satisfactory", "var(--good)"] : a <= 200 ? ["Moderate", "var(--mod)"] : a <= 300 ? ["Poor", "var(--poor)"] : a <= 400 ? ["Very Poor", "var(--vpoor)"] : ["Severe", "var(--severe)"]; }

  /**
   * US EPA category for an AQI value.
   * @param {number} a  US AQI (0–500).
   * @returns {[string, string]} [label, CSS colour variable].
   */
  function catUS(a) { return a <= 50 ? ["Good", "var(--good)"] : a <= 100 ? ["Moderate", "var(--fair)"] : a <= 150 ? ["Unhealthy for sensitive groups", "var(--mod)"] : a <= 200 ? ["Unhealthy", "var(--poor)"] : a <= 300 ? ["Very Unhealthy", "var(--vpoor)"] : ["Hazardous", "var(--severe)"]; }

  /**
   * Health profiles: [id, label, lucide icon, sensitivity factor].
   * The factor multiplies the base risk — asthma (1.8) is most
   * sensitive, a general adult (1.0) is the baseline.
   */
  var PERSONAS = [["general", "General adult", "person-standing", 1], ["children", "Children", "baby", 1.5], ["elderly", "Elderly (60+)", "accessibility", 1.4], ["asthma", "Asthma / lungs", "stethoscope", 1.8], ["heart", "Heart condition", "heart-pulse", 1.6], ["pregnant", "Pregnant", "heart", 1.5], ["athlete", "Athlete / outdoor worker", "dumbbell", 1.3]];

  /**
   * Activity breathing-rate factors: { f: multiplier vs rest-ish walk,
   * label: gerund used in verdict text }.
   */
  var ACTF = { walk: { f: 1, label: "walking" }, run: { f: 2.1, label: "running" }, cycle: { f: 1.7, label: "cycling" }, commute: { f: 0.9, label: "commuting" }, play: { f: 1.6, label: "playing outside" }, work: { f: 1.4, label: "working outdoors" } };

  /**
   * Personal Risk Score (0–100) for one outing.
   *
   * @param {number} cpcb  Current CPCB NAQI (0–500).
   * @param {number} healthFactor  Persona sensitivity (see PERSONAS).
   * @param {number} activityFactor  Activity breathing factor (see ACTF).
   * @param {number} durationMin  Minutes outdoors.
   * @param {boolean} masked  True if a fitted N95 is worn.
   * @returns {number} Integer score clamped to 1–100.
   *
   * Formula: base = min(100, NAQI / 5) maps the 0–500 scale onto
   * 0–100; score = base × health × activity × (0.55 + minutes / 200);
   * a fitted N95 multiplies the result by 0.35.
   */
  function riskScore(cpcb, healthFactor, activityFactor, durationMin, masked) {
    var base = Math.min(100, cpcb / 5); // CPCB 500 -> 100
    var score = base * healthFactor * activityFactor * (0.55 + durationMin / 200);
    if (masked) score *= 0.35;
    return Math.max(1, Math.min(100, Math.round(score)));
  }

  /**
   * Verdict band for a risk score: 0 fine, 1 okay with care,
   * 2 cut it short / mask up, 3 skip it outdoors.
   * @param {number} score  Risk score 1–100.
   * @returns {number} Band 0–3.
   */
  function riskBand(score) { return score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3; }

  /**
   * Inhaled PM2.5 dose for an activity, in µg.
   *
   * @param {number} pm25  PM2.5 concentration in µg/m³.
   * @param {number} rate  Breathing-rate factor from the simulator UI.
   * @param {number} minutes  Duration in minutes.
   * @returns {number} Dose in µg: pm25 × rate × (minutes / 60).
   */
  function exposureDose(pm25, rate, minutes) { return pm25 * rate * (minutes / 60); }

  /**
   * Dose remaining while wearing a fitted N95: 5% of the unmasked dose
   * (≈95% of PM2.5 filtered).
   * @param {number} dose  Unmasked dose in µg.
   * @returns {number} Masked dose in µg.
   */
  function maskedDose(dose) { return dose * 0.05; }

  /**
   * Best 2-hour window in a series of hourly PM2.5 values: the
   * consecutive pair with the lowest mean concentration.
   *
   * @param {Array<{t: string, pm: number}>} hours  Hourly entries,
   *   earliest first (the app passes the next 24 hours).
   * @returns {?{avg: number, from: string, to: string}} The winning
   *   window (mean PM2.5 and the two hour timestamps), or null when
   *   fewer than two hours are available. Ties keep the earliest pair.
   */
  function bestWindowFromHours(hours) {
    var best = null;
    for (var i = 0; i + 1 < hours.length; i++) { var avg = (hours[i].pm + hours[i + 1].pm) / 2; if (!best || avg < best.avg) best = { avg: avg, from: hours[i].t, to: hours[i + 1].t }; }
    return best;
  }

  return {
    subIndex: subIndex,
    BP: BP,
    BP_EPA_PM25: BP_EPA_PM25,
    epaAqiPm25: epaAqiPm25,
    naqiFromMeans: naqiFromMeans,
    catIN: catIN,
    catUS: catUS,
    PERSONAS: PERSONAS,
    ACTF: ACTF,
    riskScore: riskScore,
    riskBand: riskBand,
    exposureDose: exposureDose,
    maskedDose: maskedDose,
    bestWindowFromHours: bestWindowFromHours
  };
});
