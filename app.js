"use strict";
/*
 * ClearAir — application / UI code.
 * All deterministic maths (NAQI, risk score, exposure dose, best
 * window) lives in logic.js (window.ClearAirLogic) and is unit-tested
 * in tests/. This file is state, data loading, rendering and events.
 * Loaded after logic.js by index.html; runs at end-of-body parse time,
 * exactly as the previous inline script did.
 */
/* ========= State ========= */
var S = {
  place:{name:"Delhi", country:"India", lat:28.6139, lon:77.2090},
  standard:"IN", lang:"en",
  hourly:null, current:null, daily:null, wx:null,
  pm25Now:0, cpcb:0, usAqi:0, updated:"",
  persona:"general", habits:{}, audit:{}, tasks:[], planText:""
};
var $ = function(id){ return document.getElementById(id); };
/* Instant button feedback: spinner + label swap the moment a button is tapped */
function setBusy(btn,on,label){
  if(!btn) return;
  if(on){ if(btn.dataset.orig===undefined) btn.dataset.orig=btn.innerHTML; btn.disabled=true; btn.classList.add("busy"); btn.innerHTML='<span class="spin" aria-hidden="true"></span>'+(label||"Working…"); }
  else{ btn.disabled=false; btn.classList.remove("busy"); if(btn.dataset.orig!==undefined){ btn.innerHTML=btn.dataset.orig; delete btn.dataset.orig; if(window.lucide) lucide.createIcons(); } }
}

/* ========= Deterministic logic (logic.js) =========
   subIndex, the CPCB breakpoint table (BP), the category lookups and
   the persona/activity tables are defined once in logic.js and tested
   in tests/. The thin wrappers below keep the existing call sites
   unchanged. */
var BP = ClearAirLogic.BP;
function subIndex(v, bp){ return ClearAirLogic.subIndex(v, bp); }
function catIN(a){ return ClearAirLogic.catIN(a); }
function catUS(a){ return ClearAirLogic.catUS(a); }
/* Escape text before it is interpolated into innerHTML markup. Used
   for the only two spots where user-typed / remote-supplied names are
   rendered as HTML (planner task names, compare place names). */
function escHtml(s){ return String(s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function fmt(n,d){ return n==null||isNaN(n)?"–":Number(n).toFixed(d==null?0:d); }
function hourLabel(iso){ var d=new Date(iso); var h=d.getHours(); var ap=h>=12?"PM":"AM"; h=h%12||12; return h+" "+ap; }
function dayLabel(iso){ return new Date(iso).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"}); }

/* ========= Data loading ========= */
function mean(a){ a=a.filter(function(x){return x!=null&&!isNaN(x);}); return a.length?a.reduce(function(s,x){return s+x;},0)/a.length:0; }
function fetchJson(url){
  return fetch(url).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); });
}
function load(lat,lon,name,country){
  S.place={name:name,country:country||"",lat:lat,lon:lon};
  $("loadErr").hidden=true; $("retryRow").hidden=true;
  var aq="https://air-quality-api.open-meteo.com/v1/air-quality?latitude="+lat+"&longitude="+lon+
    "&hourly=pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,carbon_monoxide,us_aqi&current=pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,carbon_monoxide,us_aqi,european_aqi&forecast_days=7&past_days=7&timezone=auto";
  var wx="https://api.open-meteo.com/v1/forecast?latitude="+lat+"&longitude="+lon+"&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,uv_index&timezone=auto";
  /* Weather is context only — its failure must never kill the AQI reading.
     Air quality is retried once before any error is shown. */
  var aqOnce=function(){ return fetchJson(aq).then(function(a){ if(!a||!a.hourly||!a.current||a.error) throw new Error("Bad AQ payload"); return a; }); };
  var aqFetch=aqOnce().catch(function(){ return new Promise(function(res){ setTimeout(res,1200); }).then(aqOnce); });
  var wxFetch=fetchJson(wx).catch(function(){ return {current:null}; });
  Promise.all([aqFetch, wxFetch])
  .then(function(res){
    var a=res[0]; S.hourly=a.hourly; S.current=a.current; S.wx=res[1]&&res[1].current?res[1].current:null;
    // CPCB from trailing 24h means
    var times=a.hourly.time, nowIdx=times.length-1;
    var cur=new Date(a.current.time).getTime();
    /* Hourly times are ascending, so the current hour is the last entry
       at or before the feed's current time: stop at the first later
       entry instead of Date-parsing all ~336 of them. */
    for(var i=0;i<times.length;i++){ if(new Date(times[i]).getTime()<=cur) nowIdx=i; else break; }
    S.nowIdx=nowIdx;
    function trail(key,h){ var s=[],from=Math.max(0,nowIdx-h+1); for(var j=from;j<=nowIdx;j++) s.push(a.hourly[key][j]); return mean(s); }
    S.trail={ pm25:trail("pm2_5",24), pm10:trail("pm10",24), no2:trail("nitrogen_dioxide",24), so2:trail("sulphur_dioxide",24), o3:trail("ozone",8), co:trail("carbon_monoxide",8)/1000 };
    var nr=ClearAirLogic.naqiFromMeans(S.trail), subs=nr.subs;
    S.subs=subs; S.cpcb=nr.naqi;
    S.domKey=Object.keys(subs).reduce(function(m,k){return subs[k]>subs[m]?k:m;},"pm25");
    S.usAqi=a.current.us_aqi||0; S.pm25Now=a.current.pm2_5||S.trail.pm25;
    S.fetchedAt=Date.now();
    buildHourCache();
    S.updated=new Date(a.current.time).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
    /* Data HAS loaded at this point — a rendering hiccup must never be
       reported as a connection failure (that was the screenshot bug:
       a real AQI on screen under a "could not load" banner). */
    $("loadErr").hidden=true; $("retryRow").hidden=true;
    try{ renderAll(); }catch(err){ if(window.console) console.warn("Render issue",err); }
    try{ loadCleanerDirs(); updatePrompt(); }catch(err2){ if(window.console) console.warn("Secondary render issue",err2); }
    tickLive(); setBusy($("searchBtn"),false); setBusy($("locBtn"),false); setBusy($("retryBtn"),false);
  }).catch(function(){
    setBusy($("searchBtn"),false); setBusy($("locBtn"),false); setBusy($("retryBtn"),false);
    var e=$("loadErr"); e.hidden=false; $("retryRow").hidden=false;
    if(S.current && S.fetchedAt){
      /* A refresh failed but a real earlier reading is on screen — say so,
         and leave the reading, place line and timestamp untouched. */
      e.textContent="Refresh failed — showing last live reading ("+S.updated+").";
      $("liveTxt").textContent="LIVE · refresh failed — showing last reading";
    } else {
      e.textContent="Live data couldn't load — check connection & retry. No sample numbers are ever shown.";
      $("placeLine").textContent="Live data unavailable — check connection and retry"; $("liveTxt").textContent="LIVE · unavailable — check connection"; $("cleanerDir").textContent="Nearby comparison unavailable while live data is down."; $("ventWindow").textContent="Ventilation guidance appears once live data loads.";
    }
  });
}
function geocode(q,cb){
  fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(q)+"&count=1&language=en&format=json")
  .then(function(r){return r.json();}).then(function(j){ if(j.results&&j.results.length){ var g=j.results[0]; cb(g.latitude,g.longitude,g.name,(g.admin1?g.admin1+", ":"")+(g.country||"")); } else { setBusy($("searchBtn"),false); var e=$("loadErr"); e.hidden=false; e.textContent="Place not found: "+q; } })
  .catch(function(){ setBusy($("searchBtn"),false); });
}

/* ========= Render ========= */
function renderAll(){
  if(!S.current){ $("stdNote").textContent = S.standard==="IN" ? "CPCB NAQI, 0–500 · 24-h mean." : "US EPA AQI, 0–500 · live feed."; return; }
  $("placeLine").textContent = S.place.name+(S.place.country?", "+S.place.country:"")+" · Live now";
  var aqi = S.standard==="IN"?S.cpcb:S.usAqi;
  var c = S.standard==="IN"?catIN(aqi):catUS(aqi);
  $("aqiNum").textContent=fmt(aqi); $("aqiCat").textContent=c[0]; $("aqiDot").style.background=c[1]; $("aqiDot").style.color=c[1];
  $("stdNote").textContent = S.standard==="IN" ? "CPCB NAQI, 0–500 · 24-h mean." : "US EPA AQI, 0–500 · live feed.";
  var names={pm25:"PM2.5",pm10:"PM10",no2:"NO₂",so2:"SO₂",o3:"Ozone",co:"CO"};
  $("domPol").textContent="Dominant: "+names[S.domKey];
  $("cigEq").textContent="≈ "+(S.trail.pm25/22).toFixed(1)+" cigarettes/day equivalent";
  $("updatedAt").textContent="Updated "+S.updated;
  $("headlineAdvice").textContent = headline(aqi);
  updateVoiceSimple();
  $("severeBox").hidden = S.cpcb<=300;
  $("severeChecklist").hidden = S.cpcb<=300;
  renderPollutants(); renderWx(); renderBest(); renderRisk(); renderForecast(); renderSim(); renderVent(); renderPlanner();
  /* Re-assigning an iframe's src reloads it even when the URL is
     unchanged — and renderAll() also runs on the NAQI/EPA toggle and
     every auto-refresh. Only re-point the map when the place changed. */
  var mapKey=S.place.lat+","+S.place.lon;
  if(S._mapKey!==mapKey){ S._mapKey=mapKey; $("mapFrame").src="https://www.openstreetmap.org/export/embed.html?bbox="+(S.place.lon-0.09)+"%2C"+(S.place.lat-0.05)+"%2C"+(S.place.lon+0.09)+"%2C"+(S.place.lat+0.05)+"&layer=mapnik&marker="+S.place.lat+"%2C"+S.place.lon; }
}
function headline(a){
  if(S.standard==="IN"){ if(a<=50)return "Good air today — no changes needed."; if(a<=100)return "Acceptable air. Sensitive people: watch symptoms on long outings."; if(a<=200)return "Moderate air. Shorten hard exercise; windows shut at peak hours."; if(a<=300)return "Poor air. Exercise indoors; N95 outside."; if(a<=400)return "Very poor air. Avoid outdoor exertion."; return "Severe air. Stay indoors; follow the protocol below."; }
  if(a<=50)return "Good air today (US scale)."; if(a<=100)return "Moderate (US scale) — fine for most people."; if(a<=150)return "Unhealthy for sensitive groups (US scale)."; if(a<=200)return "Unhealthy (US scale) — reduce outdoor exertion."; if(a<=300)return "Very unhealthy (US scale)."; return "Hazardous (US scale) — stay indoors.";
}
var POLS=[["pm25","PM2.5","µg/m³"],["pm10","PM10","µg/m³"],["no2","NO₂","µg/m³"],["o3","Ozone","µg/m³"],["so2","SO₂","µg/m³"],["co","CO","mg/m³"]];
function renderPollutants(){
  var cur={pm25:S.current.pm2_5,pm10:S.current.pm10,no2:S.current.nitrogen_dioxide,o3:S.current.ozone,so2:S.current.sulphur_dioxide,co:(S.current.carbon_monoxide||0)/1000};
  $("polGrid").innerHTML = POLS.map(function(p){
    var v=cur[p[0]], sub=S.subs[p[0]], pct=Math.min(100,sub/5);
    var extra = p[0]==="pm25" ? '<div class="mini" style="margin-top:4px">'+(S.trail.pm25/15).toFixed(1)+'× WHO 24-h guideline (mean '+fmt(S.trail.pm25,1)+' µg/m³)</div>' : '<div class="mini" style="margin-top:4px">CPCB sub-index '+sub+'</div>';
    return '<div class="pol"><div class="name"><span>'+p[1]+'</span><span class="pill" style="padding:1px 8px">Sub '+sub+'</span></div><div class="val">'+fmt(v, p[0]==="co"?2:1)+' <span class="unit">'+p[2]+'</span></div><div class="bar"><i style="width:'+pct+'%"></i></div>'+extra+'</div>';
  }).join("");
}
function renderWx(){
  var w=S.wx; if(!w) return;
  $("wxTemp").textContent=fmt(w.temperature_2m,0)+"°C"; $("wxHum").textContent=fmt(w.relative_humidity_2m,0)+"%";
  $("wxWind").textContent=fmt(w.wind_speed_10m,0)+" km/h"; $("wxUv").textContent=fmt(w.uv_index,1);
  var dirs=["N","NE","E","SE","S","SW","W","NW"]; var d=dirs[Math.round((w.wind_direction_10m||0)/45)%8];
  $("wxNote").textContent = (w.wind_speed_10m<8 ? "Light wind ("+d+") — pollution builds up. " : "Wind ("+d+", "+fmt(w.wind_speed_10m,0)+" km/h) is clearing pollution. ") + (w.relative_humidity_2m>75 ? "High humidity — air feels heavier." : "Humidity comfortable.");
}
/* Best window + cleaner direction */
/* The next-24h series and its best window depend only on the loaded
   hourly data, but they are asked for in several places per render
   (best-window card, forecast, ventilation, planner, spoken plan).
   They used to be rebuilt from scratch on every ask — a fresh
   24-object array plus a full scan, ~6x per renderAll(). Build them
   once per load() (buildHourCache) and share the result; the entries
   are read-only for every consumer. The old per-entry "aqi" field was
   never read anywhere and is gone. */
var _h24=null, _bestWin=null;
function buildHourCache(){
  _h24=[]; for(var i=S.nowIdx;i<Math.min(S.hourly.time.length,S.nowIdx+24);i++) _h24.push({t:S.hourly.time[i],pm:S.hourly.pm2_5[i]});
  _bestWin=ClearAirLogic.bestWindowFromHours(_h24);
}
function next24(){ return _h24||[]; }
function bestWindow(){ if(!S.hourly) return null; return _bestWin; }
function renderBest(){
  var b=bestWindow(); if(!b) return;
  $("bestWindow").textContent=hourLabel(b.from)+" – "+hourLabel(b.to);
  $("bestDetail").textContent="PM2.5 ≈ "+fmt(b.avg,0)+" µg/m³ — the cleanest 2 hours ahead.";
  var worst=next24().reduce(function(m,x){return x.pm>m.pm?x:m;},{pm:-1});
  S.worst=worst;
}
function loadCleanerDirs(){
  var offs=[["North",0.045,0],["South",-0.045,0],["East",0,0.055],["West",0,-0.055]],done=0,res=[];
  offs.forEach(function(o){
    fetch("https://air-quality-api.open-meteo.com/v1/air-quality?latitude="+(S.place.lat+o[1])+"&longitude="+(S.place.lon+o[2])+"&current=pm2_5")
    .then(function(r){return r.json();}).then(function(j){ res.push({d:o[0],pm:j.current.pm2_5}); if(++done===4){ res.sort(function(a,b){return a.pm-b.pm;}); var here=S.pm25Now, best=res[0];
      $("cleanerDir").innerHTML = best.pm<here ? "Cleanest toward the <b>"+best.d+"</b> right now (PM2.5 ≈ "+fmt(best.pm,0)+" vs "+fmt(here,0)+" µg/m³ here). Favour parks &amp; lanes that way." : "Air is much the same all around (PM2.5 "+fmt(res[0].pm,0)+"–"+fmt(res[3].pm,0)+" µg/m³, ~5 km). Timing beats route — use the best window."; } })
    .catch(function(){ if(++done===4) $("cleanerDir").textContent="Nearby comparison unavailable right now."; });
  });
}
/* Risk */
var PERSONAS=ClearAirLogic.PERSONAS;
var ACTF=ClearAirLogic.ACTF;
function buildPersonas(){
  $("personaChips").innerHTML=PERSONAS.map(function(p){return '<button type="button" class="chip" data-p="'+p[0]+'" aria-pressed="'+(S.persona===p[0])+'"><i data-lucide="'+p[2]+'"></i>'+p[1]+'</button>';}).join("");
  $("personaChips").querySelectorAll("button").forEach(function(b){ b.addEventListener("click",function(){ S.persona=b.getAttribute("data-p");
    $("personaChips").querySelectorAll("button").forEach(function(x){ x.setAttribute("aria-pressed", x===b?"true":"false"); });
    renderRisk(); }); });
  if(window.lucide) lucide.createIcons();
}
function calcRisk(){
  var per=PERSONAS.filter(function(p){return p[0]===S.persona;})[0];
  var act=ACTF[$("riskAct").value], dur=+$("riskDur").value, mask=$("maskToggle").getAttribute("aria-pressed")==="true";
  var score=ClearAirLogic.riskScore(S.cpcb, per[3], act.f, dur, mask), band=ClearAirLogic.riskBand(score);
  var verdict,why;
  if(band===0){verdict="Fine to go — normal precautions";why=act.label+" for "+dur+" min is fine for a "+per[1].toLowerCase()+" profile in this air.";}
  else if(band===1){verdict="Okay with care";why="Keep it near "+dur+" min, use parks/inner lanes, stop if breathing feels heavy.";}
  else if(band===2){verdict="Cut it short — or mask up";why="Halve the time, use the best window ("+$("bestWindow").textContent+"), or wear a fitted N95.";}
  else {verdict="Skip it outdoors today";why="Not worth it for a "+per[1].toLowerCase()+" profile — move indoors or to the cleanest window.";}
  if(mask&&score<75) why+=" N95 already counted.";
  return {score:score,verdict:verdict,why:why};
}
function renderRisk(){
  if(!S.current) return;
  $("riskDurVal").textContent=$("riskDur").value+" min";
  var r=calcRisk(); $("riskNum").textContent=r.score; $("riskVerdict").textContent=r.verdict; $("riskWhy").textContent=r.why;
  var ring=$("ringFg"); ring.style.strokeDashoffset=(351.8*(1-r.score/100)).toFixed(1);
  ring.style.stroke = r.score<25?"var(--good)":r.score<50?"var(--mod)":r.score<75?"var(--poor)":"var(--severe)";
}
/* Forecast chart + history */
function renderForecast(){
  var h=next24(); if(!h.length) return;
  if(!S.worst||!S.worst.t){ S.worst=h.reduce(function(m,x){return x.pm>m.pm?x:m;},{pm:-1,t:h[0].t}); }
  var max=Math.max.apply(null,h.map(function(x){return x.pm;}))*1.15, W=720,H=170,pad=26,bw=(W-pad*2)/h.length;
  var bars=h.map(function(x,i){ var bh=(x.pm/max)*(H-50); var isWorst=S.worst&&x.t===S.worst.t; var lbl=hourLabel(x.t);
    return '<rect x="'+(pad+i*bw+1).toFixed(1)+'" y="'+(H-24-bh).toFixed(1)+'" width="'+(bw-2).toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="3" fill="'+(isWorst?"var(--poor)":"var(--ink3)")+'" opacity="'+(isWorst?1:0.55)+'"><title>'+lbl+": PM2.5 "+fmt(x.pm,0)+' µg/m³</title></rect>'+(i%3===0?'<text x="'+(pad+i*bw+bw/2).toFixed(1)+'" y="'+(H-6)+'" font-size="10" fill="var(--ink3)" text-anchor="middle">'+lbl+'</text>':""); }).join("");
  $("fcChart").innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto" role="presentation">'+bars+'</svg><p class="mini">Hourly PM2.5, next 24 h. Dark red = worst hour.</p>';
  if(S.worst&&S.worst.t){ $("worstHour").textContent=hourLabel(S.worst.t); $("worstHourV").textContent="PM2.5 "+fmt(S.worst.pm,0)+" µg/m³ — windows shut, exercise indoors."; }
  /* Text summary of the chart for screen readers (the SVG itself is
     role="img"; this is its aria-describedby target). */
  var fcD=$("fcDesc");
  if(fcD){ var lo=h.reduce(function(m,x){return x.pm<m?x.pm:m;},Infinity);
    fcD.textContent="Over the next 24 hours PM2.5 ranges from "+fmt(lo,0)+" to "+fmt(S.worst?S.worst.pm:0,0)+" µg/m³."+(S.worst&&S.worst.t?" The worst hour is "+hourLabel(S.worst.t)+".":""); }
  // daily means from hourly
  var byDay={}; S.hourly.time.forEach(function(t,i){ var d=t.slice(0,10); (byDay[d]=byDay[d]||[]).push(S.hourly.pm2_5[i]); });
  var days=Object.keys(byDay).sort().map(function(d){return {d:d,v:mean(byDay[d])};});
  var today=new Date().toISOString().slice(0,10);
  var past=days.filter(function(x){return x.d<today;}).slice(-7);
  if(past.length){ var b=past.reduce(function(m,x){return x.v<m.v?x:m;}), w=past.reduce(function(m,x){return x.v>m.v?x:m;});
    $("bestDay").textContent=fmt(b.v,0); $("bestDayV").textContent=dayLabel(b.d)+" · avg PM2.5 µg/m³";
    $("worstDay").textContent=fmt(w.v,0); $("worstDayV").textContent=dayLabel(w.d)+" · avg PM2.5 µg/m³"; }
  var tom=days.filter(function(x){return x.d>today;})[0];
  if(tom){ $("tomorrowV").textContent=fmt(tom.v,0); $("tomorrowNote").textContent="Avg PM2.5 · "+dayLabel(tom.d)+(tom.v<S.trail.pm25?" — better than today; plan outdoors.":" — no relief yet; indoors first."); }
}
/* Simulator */
function renderSim(){
  if(!S.current) return;
  var mins=+$("simDur").value, rate=+$("simInt").value;
  $("simDurVal").textContent=mins+" min";
  var dose=ClearAirLogic.exposureDose(S.pm25Now,rate,mins);
  $("simDose").textContent=fmt(dose,0)+" µg"; $("simDoseMask").textContent=fmt(ClearAirLogic.maskedDose(dose),0)+" µg";
}
/* Habits score */
var HABITS=[["mask","N95 outside",15],["window","Windows timed to clean hours",15],["purifier","Purifier / wet-mop indoors",15],["commute","Low-emission commute",20],["exercise","Exercise in best window / indoors",20],["plants","No incense / coil today",15]];
function updateScore(){ var sc=HABITS.reduce(function(s,h){return s+(S.habits[h[0]]?h[2]:0);},0); $("scoreNum").textContent=sc; $("scoreRing").style.strokeDashoffset=(351.8*(1-sc/100)).toFixed(1); }
function buildHabits(){
  $("habitBtns").innerHTML=HABITS.map(function(h){return '<button type="button" class="chip" data-h="'+h[0]+'" aria-pressed="'+!!S.habits[h[0]]+'"><i data-lucide="check"></i>'+h[1]+' · '+h[2]+'</button>';}).join("");
  $("habitBtns").querySelectorAll("button").forEach(function(b){ b.addEventListener("click",function(){ var k=b.getAttribute("data-h"); S.habits[k]=!S.habits[k]; b.setAttribute("aria-pressed", S.habits[k]?"true":"false"); updateScore(); }); });
  updateScore();
  if(window.lucide) lucide.createIcons();
}
/* Planner */
function renderPlanner(){
  var el=$("taskList"); $("taskEmpty").style.display=S.tasks.length?"none":"block";
  // next24()/bestWindow() are loop-invariant — compute once, not per task.
  var bw=null, byLabel=null;
  if(S.hourly && S.tasks.some(function(t){return t.kind==="outdoor";})){
    bw=bestWindow();
    /* Index the cached hours by their display label once, instead of
       re-filtering (and re-labelling) all 24 entries for every task.
       First entry wins, exactly like filter()[0] did. */
    byLabel={}; next24().forEach(function(x){ var l=hourLabel(x.t); if(!(l in byLabel)) byLabel[l]=x; });
  }
  el.innerHTML=S.tasks.map(function(t,i){
    var note="";
    if(t.kind==="outdoor"&&S.hourly){ var at=byLabel[t.timeLabel]; var b=bw;
      if(at&&b&&at.pm>b.avg*1.25){ t.moved=hourLabel(b.from); note='<span class="impact">Moved to '+t.moved+' — PM2.5 ≈ '+fmt(b.avg,0)+' instead of ≈ '+fmt(at.pm,0)+' µg/m³ at '+t.timeLabel+'.</span>'; }
      else note='<span class="mini">Already a clean slot.</span>'; }
    if(t.kind==="fixed") note='<span class="mini">Fixed — mask &amp; route advice applies.</span>';
    if(t.kind==="indoor") note='<span class="mini">Indoor — see ventilation window.</span>';
    return '<div class="taskrow"><i data-lucide="'+(t.kind==="fixed"?"lock":t.kind==="indoor"?"house":"trees")+'"></i><span class="t">'+escHtml(t.name)+'</span><span class="pill">'+t.timeLabel+'</span>'+note+'<button class="btn" type="button" data-del="'+i+'" style="margin-left:auto;min-height:36px;padding:4px 12px">Remove</button></div>';
  }).join("");
  el.querySelectorAll("[data-del]").forEach(function(b){ b.addEventListener("click",function(){ S.tasks.splice(+b.getAttribute("data-del"),1); renderPlanner(); }); });
  if(window.lucide) lucide.createIcons();
}
/* Ventilation */
function renderVent(){
  var b=bestWindow(); if(!b) return;
  $("ventWindow").innerHTML = S.cpcb>200 ? "Poor air today. Ventilate briefly at <b>"+hourLabel(b.from)+" – "+hourLabel(b.to)+"</b> (PM2.5 ≈ "+fmt(b.avg,0)+" µg/m³), then close windows &amp; run the purifier." : "Open windows at <b>"+hourLabel(b.from)+" – "+hourLabel(b.to)+"</b> (PM2.5 ≈ "+fmt(b.avg,0)+" µg/m³); close before the worst hour"+(S.worst&&S.worst.t?", "+hourLabel(S.worst.t):"")+".";
}
/* Severe checklist */
var SEVERE=["Seal the bedroom door gap; purifier on high, 30 min","Wet-mop, don't dry-sweep (it re-suspends dust)","Cook lidded, exhaust on; skip heavy frying today","Fitted N95s by the door for anyone going out","Postpone outdoor exercise and children’s outdoor play","Check on elders & asthma patients — inhaler within reach"];
$("severeList").innerHTML=SEVERE.map(function(s){return '<li><i data-lucide="circle-alert"></i><span>'+s+'</span></li>';}).join("");
/* Indoor audit */
var AUDIT=[["incense","Incense / dhoop / agarbatti daily"],["coil","Mosquito coils"],["smoke","Smoking indoors"],["dry-sweep","Dry sweeping / jhadoo"],["no-exhaust","No kitchen exhaust"],["candles","Scented candles often"],["road-window","Windows open to a busy road at peak hours"]];
function buildAudit(){
  $("auditChips").innerHTML=AUDIT.map(function(a){return '<button type="button" class="chip" data-a="'+a[0]+'" aria-pressed="'+!!S.audit[a[0]]+'">'+a[1]+'</button>';}).join("");
  $("auditChips").querySelectorAll("button").forEach(function(b){ b.addEventListener("click",function(){ var k=b.getAttribute("data-a"); S.audit[k]=!S.audit[k]; b.setAttribute("aria-pressed", S.audit[k]?"true":"false"); renderAudit(); }); });
}
var FIXES={ "incense":["Move dhoop to a ventilated spot and cut to once a day","Incense can spike indoor PM2.5 like traffic outside.","₹0"],
 "coil":["Switch to a plug-in vaporiser or net + repellent cream","One coil overnight ≈ the smoke of many cigarettes in a closed room.","₹150–300/month"],
 "smoke":["Move smoking fully outside, away from windows","Smoke lingers on walls & clothes for hours.","₹0"],
 "dry-sweep":["Wet-mop, or sweep only after sprinkling water","Dry sweeping throws dust back to breathing height.","₹0"],
 "no-exhaust":["Use a window exhaust or cook with the door closed + window open","Gas cooking without exhaust raises indoor NO₂ sharply.","₹1,500–3,000 one-time"],
 "candles":["Keep candles occasional and short","Candles add PM & VOCs to loaded air.","₹0"],
 "road-window":["Open road-facing windows only in the best window (above)","Peak traffic is the biggest indoor PM source for road-facing homes.","₹0"] };
function renderAudit(){
  var keys=Object.keys(S.audit).filter(function(k){return S.audit[k];});
  $("auditOut").innerHTML = keys.length? keys.map(function(k){ var f=FIXES[k]; return '<div class="act"><i data-lucide="wrench"></i><div><b>'+f[0]+'</b><p>'+f[1]+'</p><span class="impact">Cost: '+f[2]+'</span></div></div>'; }).join("") : '<p class="mini">Nothing selected — indoor sources look fine; focus on outdoor timing.</p>';
  if(window.lucide) lucide.createIcons();
}
/* ========= Plan ========= */
var T={
 en:{ morning:"Morning", commute:"Commute", indoor:"Indoor", evening:"Evening",
   openWin:function(b){return "Open windows only in the clean slot "+b+" today; keep them shut at peak hours.";},
   whyWin:"Wrong-hour ventilation can import a full day's worth of PM2.5.",
   mask:"Keep a fitted N95 by the door; wear it for any outing over 20 minutes.",
   whyMask:"A fitted N95 cuts inhaled PM2.5 by ~95% — today's biggest personal cut." },
 hi:{ morning:"सुबह", commute:"आना-जाना", indoor:"घर के अंदर", evening:"शाम",
   openWin:function(b){return "आज खिड़कियाँ सिर्फ साफ़ समय "+b+" में खोलें; भीड़ वाले घंटों में बंद रखें।";},
   whyWin:"गलत समय पर खिड़की खोलने से बहुत ज़्यादा PM2.5 अंदर आ सकती है।",
   mask:"दरवाज़े के पास फिटेड N95 रखें; 20 मिनट से लंबी बाहर की यात्रा पर पहनें।",
   whyMask:"फिटेड N95 PM2.5 को लगभग 95% घटाता है।",
   openWinR:function(b){return "Aaj khidkiyaan sirf saaf samay "+b+" mein kholein; bheed wale ghanton mein band rakhein.";},
   maskR:"Darwaaze ke paas fitted N95 rakhein; 20 minute se lambi bahar ki yaatra par pehnein." }
};
function buildPlan(){
  var lang=$("pLang").value, t=T[lang], b=bestWindow();
  var bTxt=b?hourLabel(b.from)+"–"+hourLabel(b.to):"—";
  var tr=$("pTransport").value, cook=$("pCook").value, home=$("pHome").value, clean=$("pClean").value, fam=$("pFamily").value;
  var secs=[];
  var m=[{a:t.openWin(bTxt),w:t.whyWin,i:"Exposure avoided: up to 40% of daily indoor PM2.5 load (estimate)"},{a:t.mask,w:t.whyMask,i:"Exposure avoided: ≈95% of PM2.5 while worn (estimate)"}];
  if(fam!=="general") m.push({a:"Give the most sensitive person the inner, road-farthest room today.",w:"PM2.5 drops away from the road-facing wall.",i:"Exposure avoided: meaningful on poor days (estimate)"});
  secs.push({h:t.morning,icon:"sunrise",items:m});
  var c=[];
  if(tr==="car") c.push({a:"Shift the commute to before the morning peak, or switch 2 days a week to metro/carpool.",w:"Peak-hour roads carry the day's densest exhaust; earlier is cleaner.",i:"CO₂ saved: ≈2.3 kg per metro day (estimate) · Exposure avoided: peak-plume hours"});
  else if(tr==="bike"||tr==="auto") c.push({a:"Take inner lanes / park-side routes and wear the N95 under the helmet strap line.",w:"Open vehicles breathe traffic air directly; one street in, PM drops.",i:"Exposure avoided: up to 30% on rerouted trips (estimate)"});
  else if(tr==="metro") c.push({a:"Keep the metro — add a mask for the station-to-home walk.",w:"Metro air is far cleaner than road air; the walk is the exposed part.",i:"CO₂ saved: ≈2.3 kg/day vs car (estimate)"});
  else if(tr==="cycle") c.push({a:"Move cycling to the best window ("+bTxt+") or indoors today.",w:"Cycling triples breathing rate — timing matters most for you.",i:"Exposure avoided: largest single swap in this plan (estimate)"});
  else c.push({a:"Batch errands into one trip in the best window ("+bTxt+").",w:"Fewer, better-timed outings beat several short peak-hour ones.",i:"Exposure avoided: fewer peak-hour trips (estimate)"});
  secs.push({h:t.commute,icon:"route",items:c});
  var ind=[];
  if(cook==="chulha") ind.push({a:"Cook with the door open / near ventilation; plan a shift to LPG or induction if possible.",w:"Biomass smoke is the strongest indoor PM2.5 source in Indian homes.",i:"Exposure avoided: the largest indoor reduction available (estimate)"});
  else if(cook==="gas") ind.push({a:"Always cook with exhaust on and a lid on the pan.",w:"Gas flames add NO₂ indoors; a lid + exhaust removes most of it at source.",i:"Exposure avoided: most cooking NO₂ (estimate)"});
  else ind.push({a:"Induction cooking already keeps combustion out of your kitchen — keep the exhaust habit for frying fumes.",w:"Frying fumes are PM too, even without a flame.",i:"Exposure avoided: frying-fume peaks (estimate)"});
  if(clean==="purifier") ind.push({a:"Run the purifier on auto in the bedroom, doors closed, from an hour before sleep.",w:"You breathe bedroom air 7–8 h straight — the day's highest-value air.",i:"Exposure avoided: overnight dose, every night (estimate)"});
  else if(clean==="plants") ind.push({a:"Plants help mood, not PM2.5 — add wet-mopping and, if budget allows, a purifier for the bedroom first.",w:"Plants remove negligible PM2.5; spend where the hours are.",i:"Cost honesty: purifier ₹8,000–15,000 one-time (estimate)"});
  else ind.push({a:"Start with wet-mopping daily and sealing the bedroom door gap; consider a bedroom purifier next.",w:"Wet-mopping stops settled dust re-entering the air — free and immediate.",i:"Cost: ₹0 to start"});
  if(home==="flat-road") ind.push({a:"Keep road-facing windows shut at peak hours; ventilate from the rear side if you have one.",w:"Road-facing openings import traffic PM directly.",i:"Exposure avoided: peak-hour inflow (estimate)"});
  secs.push({h:t.indoor,icon:"house",items:ind});
  var ev=[{a:"Evening walk / play only in the best remaining window; otherwise indoor activity.",w:"Evening traffic + falling temperatures trap pollution near the ground.",i:"Exposure avoided: evening peak (estimate)"}];
  if(S.cpcb>200) ev.push({a:"Tonight: purifier on, windows shut, tomorrow’s outings pre-shifted to the clean slot.",w:"Poor days rarely fix themselves by evening in winter.",i:"Exposure avoided: full evening peak (estimate)"});
  secs.push({h:t.evening,icon:"moon",items:ev});
  return secs;
}
function renderPlan(){
  if(!S.hourly){ $("planOut").innerHTML='<p class="mini">Waiting for live data — no guessing.</p>'; return; }
  var secs=buildPlan();
  $("planOut").innerHTML=secs.map(function(s){ return '<div class="plan-sec"><h3><i data-lucide="'+s.icon+'"></i>'+s.h+'</h3>'+s.items.map(function(it){ return '<div class="act"><i data-lucide="check-circle-2"></i><div><b>'+it.a+'</b><p><i>Why it matters:</i> '+it.w+'</p><span class="impact">'+it.i+'</span></div></div>'; }).join("")+'</div>'; }).join("");
  S.planText=secs.map(function(s){ return s.h+":\n"+s.items.map(function(it){return "- "+it.a+" ("+it.i+")";}).join("\n"); }).join("\n\n");
  $("planState").textContent="Plan updated from live data for "+S.place.name+".";
  if(window.lucide) lucide.createIcons();
}
/* The prompt is built in exactly one place: the text shown by "See the
   exact prompt" is the text actually sent to the AI — no second copy. */
function buildPrompt(){
  return ["You are ClearAir, a careful air-quality assistant for Indian families.",
  "LOCATION: "+S.place.name+" · CPCB NAQI now: "+fmt(S.cpcb)+" ("+catIN(S.cpcb)[0]+") · US AQI: "+fmt(S.usAqi)+" · PM2.5 24-h mean: "+fmt(S.trail?S.trail.pm25:0,1)+" µg/m³ · Best window: "+$("bestWindow").textContent,
  "HOUSEHOLD: commute="+$("pTransport").value+", cooking="+$("pCook").value+", home="+$("pHome").value+", cleaning="+$("pClean").value+", family="+$("pFamily").value,
  "TASK: Return a structured plan with exactly four sections — Morning, Commute, Indoor, Evening. Each action must include: the action, one line on why it matters, and an estimated impact labelled as an estimate.",
  "RULES: Never soften a safety verdict set by the deterministic engine. No medical diagnosis. If data is missing, say so instead of inventing numbers. Language: "+($("pLang").value==="hi"?"Hindi":"English")+"."].join("\n");
}
function updatePrompt(){
  $("promptView").textContent=buildPrompt();
}
/* ========= GenAI — Pollinations text API, built-in guide as fallback =========
   The daily plan and the Ask answers are written by the Pollinations
   text API (keyless, client-side) from prompts that contain ONLY the
   deterministic facts computed on this page — the AI never calculates
   or invents a number. On ANY failure (network, timeout, empty or
   invalid reply) the built-in rules engine below produces the plan /
   answer instead, and the UI labels which source was used. */
var AI_URL="https://text.pollinations.ai/openai";
function askAI(prompt){
  var ctl=("AbortController" in window)?new AbortController():null;
  var timer=ctl?setTimeout(function(){ ctl.abort(); },20000):null;
  function clear(){ if(timer){ clearTimeout(timer); timer=null; } }
  return fetch(AI_URL,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"openai",messages:[{role:"user",content:prompt}]}),
    signal:ctl?ctl.signal:undefined})
  .then(function(r){ if(!r.ok) throw new Error("AI HTTP "+r.status); return r.json(); })
  .then(function(j){
    clear();
    var txt=j&&j.choices&&j.choices[0]&&j.choices[0].message?j.choices[0].message.content:null;
    if(typeof txt!=="string"||!txt.trim()) throw new Error("Empty AI reply");
    return txt.trim();
  })
  .catch(function(e){ clear(); throw e; });
}
/* Render an AI-written plan in the same section cards as the built-in
   plan. AI text is remote content: every line is escaped before it is
   interpolated into markup. Section headings (English or Hindi) pick
   the same icons the built-in plan uses. */
function renderAiPlan(text){
  var heads=[
    {re:/^(morning|सुबह)/i, icon:"sunrise"},
    {re:/^(commute|travel|आना-जाना|यात्रा)/i, icon:"route"},
    {re:/^(indoor|घर के अंदर|घर)/i, icon:"house"},
    {re:/^(evening|शाम)/i, icon:"moon"}
  ];
  var secs=[], cur=null;
  function clean(s){ return s.replace(/^#+\s*/,"").replace(/\*\*/g,"").replace(/^\s*[-•*]\s*/,"").replace(/^\s*\d+[.)]\s*/,"").trim(); }
  String(text).split(/\n+/).forEach(function(raw){
    var line=clean(raw); if(!line) return;
    var hit=null;
    if(line.length<=48){ for(var k=0;k<heads.length;k++){ if(heads[k].re.test(line)){ hit=heads[k]; break; } } }
    if(hit){ cur={h:line.replace(/[:：]\s*$/,""),icon:hit.icon,items:[]}; secs.push(cur); return; }
    if(!cur){ cur={h:$("pLang").value==="hi"?"आपका प्लान":"Your plan",icon:"wand-sparkles",items:[]}; secs.push(cur); }
    cur.items.push(line);
  });
  secs=secs.filter(function(s){ return s.items.length; });
  if(!secs.length){ throw new Error("Unstructured AI reply"); }
  $("planOut").innerHTML=secs.map(function(s){
    return '<div class="plan-sec"><h3><i data-lucide="'+s.icon+'"></i>'+escHtml(s.h)+'</h3>'+s.items.map(function(it){
      var m=it.match(/^([^:—]{3,60})[:—]\s*(.+)$/);
      return '<div class="act"><i data-lucide="check-circle-2"></i><div>'+(m?'<b>'+escHtml(m[1])+'</b><p>'+escHtml(m[2])+'</p>':'<p>'+escHtml(it)+'</p>')+'</div></div>';
    }).join("")+'</div>';
  }).join("");
  if(window.lucide) lucide.createIcons();
}
var planBusy=false;
function generatePlan(){
  updatePrompt();
  if(planBusy) return;
  if(!S.hourly){ renderPlan(); return; }
  planBusy=true;
  setBusy($("genPlan"),true,"Writing…");
  $("planOut").innerHTML='<p class="mini">Writing your plan from the live data…</p>';
  askAI(buildPrompt()).then(function(txt){
    renderAiPlan(txt);
    S.planText=txt;
    $("planState").textContent="Plan by AI · written from the live data above for "+S.place.name+".";
  }).catch(function(){
    /* AI unreachable or unusable — the built-in guide writes the same
       plan from the same live facts, and the label says so. */
    renderPlan();
    $("planState").textContent="Offline plan (built-in guide) · AI unreachable — built here from the same live data for "+S.place.name+".";
  }).then(function(){
    planBusy=false;
    setBusy($("genPlan"),false);
  });
}
/* ========= Voice — listen instead of reading ========= */
var voiceOn=false;
function voiceSupported(){ return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window; }
function pickVoice(lang){
  if(!voiceSupported()) return null;
  var vs=speechSynthesis.getVoices()||[], i, v;
  function norm(x){ return (x||"").replace("_","-").toLowerCase(); }
  if(lang==="hi"){
    /* Hindi, in order: an exact hi-IN voice → any Hindi voice (hi / hi-*) →
       a Google Hindi voice matched by name (its lang tag is not always
       standard) → none (the caller then falls back to Roman Hinglish). */
    for(i=0;i<vs.length;i++){ if(norm(vs[i].lang)==="hi-in") return vs[i]; }
    for(i=0;i<vs.length;i++){ var l=norm(vs[i].lang); if(l==="hi"||l.indexOf("hi-")===0) return vs[i]; }
    for(i=0;i<vs.length;i++){ v=vs[i]; if(/google/i.test(v.name||"") && /hindi|हिन्दी/i.test(v.name||"")) return v; }
    return null;
  }
  var want=["en-IN","en_IN","en-GB","en-US","en"];
  for(var w=0;w<want.length;w++){ for(i=0;i<vs.length;i++){ v=vs[i]; if(v.lang && v.lang.replace("_","-").toLowerCase()===want[w].toLowerCase()) return v; } }
  for(i=0;i<vs.length;i++){ v=vs[i]; if(v.lang && v.lang.toLowerCase().indexOf("en")===0) return v; }
  return null;
}
function setVoiceUI(on){
  voiceOn=on;
  $("voiceStop").hidden=!on;
  $("voiceBtn").classList.toggle("speaking",on);
  /* The Listen button is a play/stop toggle — expose that state too. */
  $("voiceBtn").setAttribute("aria-pressed",on?"true":"false");
  if(!on) $("voiceStatus").textContent="";
}
var speakSession=0, resumeTimer=null;
function stopSpeaking(){ speakSession++; if(resumeTimer){ clearInterval(resumeTimer); resumeTimer=null; } if(voiceSupported()) speechSynthesis.cancel(); setVoiceUI(false); }
function hindiVoiceReady(){
  if(!voiceSupported()) return false;
  var vs=speechSynthesis.getVoices()||[];
  for(var i=0;i<vs.length;i++){ var l=(vs[i].lang||"").replace("_","-").toLowerCase(); if(l==="hi"||l.indexOf("hi-")===0) return true; }
  return false;
}
function refreshVoiceNote(){
  var n=$("voiceNote"); if(!n) return;
  var vs=voiceSupported()?(speechSynthesis.getVoices()||[]):[];
  n.hidden = !(S.lang==="hi" && vs.length>0 && !hindiVoiceReady());
}
function ensureVoices(cb){
  if(!voiceSupported()){ cb(); return; }
  if((speechSynthesis.getVoices()||[]).length){ cb(); return; }
  /* Voices load asynchronously and can take well over half a second on
     real phones — speaking before the list is ready is how the Hindi
     voice used to be missed. Wait for the first non-empty list (event
     or poll — some engines never fire the event), up to ~3 seconds. */
  var done=false, poll=null;
  function fin(){
    if(done) return; done=true;
    if(poll){ clearInterval(poll); poll=null; }
    try{ speechSynthesis.removeEventListener("voiceschanged",h); }catch(e){}
    cb();
  }
  function h(){ if((speechSynthesis.getVoices()||[]).length) fin(); }
  try{ speechSynthesis.addEventListener("voiceschanged",h); }catch(e){}
  poll=setInterval(h,200);
  setTimeout(fin,3000);
}
/* Split into sentence-sized chunks: one long utterance is silently cut off by Chrome/Android TTS, a queue of short ones plays through. */
function splitChunks(text){
  var parts=[], cur="", words=String(text).replace(/\s+/g," ").split(" ");
  words.forEach(function(w){
    cur = cur ? cur+" "+w : w;
    if(/[।.!?;]$/.test(w) || cur.length>=170){ parts.push(cur); cur=""; }
  });
  if(cur) parts.push(cur);
  return parts.filter(function(p){ return p.trim().length>0; });
}
function startSpeaking(text,lang,fellBack,fallback){
  var mySession=++speakSession;
  if(resumeTimer){ clearInterval(resumeTimer); resumeTimer=null; }
  speechSynthesis.cancel();
  setVoiceUI(true);
  var failNote = S.lang==="hi" ? "आवाज़ शुरू नहीं हो पाई — वही बात नीचे आसान शब्दों में लिखी है।" : "Voice couldn't start — the same message is written below.";
  function statusLine(fb){
    $("voiceStatus").textContent = (S.lang==="hi" ? "बोल रहे हैं… बंद करने के लिए Stop दबाएँ।" : "Speaking… tap Stop to end.") + (fb ? (S.lang==="hi" ? " (Hindi आवाज़ pack नहीं मिला — Hinglish में बोल रहे हैं।)" : " (No Hindi voice pack found — speaking Hinglish instead.)") : "");
  }
  statusLine(fellBack);
  var attemptNo=0;
  /* One attempt = one (text, language) pair queued as sentence chunks.
     An attempt FAILS when every chunk ends/errors without a single
     onstart, or when the engine never reports speaking/pending. A
     failed first attempt must NOT end the tap: on Android a listed
     Hindi voice can still error on Devanagari utterances, and the old
     code treated that as the end — every chunk errored, the counter
     drained, and the button flipped back off with nothing heard. Now
     the session retries inside the SAME tap with the fallback
     (Roman-Hinglish text on the English voice) and the button stays in
     its speaking state; only when no attempt is left does it stop and
     show the fail note. Stop still works instantly: stopSpeaking()
     bumps speakSession, and every callback below checks it. */
  function runAttempt(txt,lng){
    if(mySession!==speakSession) return;
    var myAttempt=++attemptNo;
    var chunks=splitChunks(txt);
    if(!chunks.length){ finishAttempt(false); return; }
    var left=chunks.length, anyStart=false, settled=false;
    function done(){
      if(mySession!==speakSession||myAttempt!==attemptNo||settled) return;
      left--;
      if(left<=0){ settled=true; finishAttempt(anyStart); }
    }
    /* Speak only after a short delay: speak() in the same tick as cancel() is dropped by Android TTS. */
    setTimeout(function(){
      if(mySession!==speakSession||myAttempt!==attemptNo||settled) return;
      var v=pickVoice(lng);
      chunks.forEach(function(c){
        var u=new SpeechSynthesisUtterance(c);
        u.lang = lng==="hi" ? "hi-IN" : "en-IN";
        if(v) u.voice=v;
        u.rate=0.95; u.pitch=1;
        u.onstart=function(){ if(mySession===speakSession&&myAttempt===attemptNo) anyStart=true; };
        u.onend=done; u.onerror=function(){ done(); };
        speechSynthesis.speak(u);
      });
      /* Could-not-start watchdog for THIS attempt: if the engine neither
         speaks nor holds a pending queue, count the attempt as failed
         (retry or fail note via finishAttempt) — never kill the tap. */
      setTimeout(function(){
        if(mySession!==speakSession||myAttempt!==attemptNo||settled||anyStart) return;
        if(!speechSynthesis.speaking && !speechSynthesis.pending){ settled=true; finishAttempt(false); }
      },3500);
    },150);
    /* Chrome stalls long speech after ~15s unless resume() is called periodically. */
    if(resumeTimer){ clearInterval(resumeTimer); resumeTimer=null; }
    resumeTimer=setInterval(function(){
      if(mySession!==speakSession){ clearInterval(resumeTimer); resumeTimer=null; return; }
      if(speechSynthesis.speaking) speechSynthesis.resume();
    },5000);
  }
  function finishAttempt(started){
    if(mySession!==speakSession) return;
    if(resumeTimer){ clearInterval(resumeTimer); resumeTimer=null; }
    if(started){ setVoiceUI(false); return; }
    if(fallback && fallback.text){
      var fb=fallback; fallback=null;
      speechSynthesis.cancel();
      statusLine(true);
      runAttempt(fb.text,fb.lang);
      return;
    }
    setVoiceUI(false);
    $("voiceStatus").textContent=failNote;
  }
  runAttempt(text,lang);
}
function speakText(text,lang,romanText){
  if(!voiceSupported()){ $("voiceStatus").textContent = lang==="hi" ? "इस phone / browser में आवाज़ support नहीं है — वही बात नीचे आसान शब्दों में लिखी है।" : "Voice not supported here — the same message is written below."; return; }
  /* Claim a session up front: if the user taps Stop (or another Listen
     button) while voices are still loading, the pending callback below
     sees a stale session and does not start speaking after all. */
  var myReq=++speakSession;
  setVoiceUI(true); $("voiceStatus").textContent = lang==="hi" ? "आवाज़ तैयार हो रही है…" : "Preparing voice…";
  ensureVoices(function(){
    if(myReq!==speakSession) return;
    /* No Hindi voice on this phone: an English-only engine stays silent on Devanagari, so speak the same report in Roman Hinglish with the English voice — audible and understood. */
    if(lang==="hi" && romanText && !hindiVoiceReady()){ startSpeaking(romanText,"en",true,null); return; }
    /* A Hindi voice is listed: try Devanagari on it first — but hand
       startSpeaking the Roman text as an in-tap fallback, so if the
       Hindi path errors or never starts, the same tap retries in
       Hinglish instead of flipping the button back off. */
    if(lang==="hi" && romanText){ startSpeaking(text,"hi",false,{text:romanText,lang:"en"}); return; }
    startSpeaking(text,lang,false,null);
  });
}
function bandOf(a){ return a<=50?0:a<=100?1:a<=200?2:a<=300?3:a<=400?4:5; }
function simpleLine(lang){
  var a=S.cpcb, b=bandOf(a);
  if(lang==="hi"){
    var cat=["बहुत अच्छी","अच्छी","ठीक-ठाक, ज़्यादा अच्छी नहीं","खराब","बहुत खराब","ख़तरनाक"][b];
    var act=["आज बाहर के सारे काम आराम से कर सकते हैं।","बाहर जा सकते हैं; नाज़ुक सेहत वाले ध्यान रखें।","लंबी दौड़ या भारी कसरत बाहर न करें; छोटे काम चलेंगे।","बाहर कम जाएँ; जाना ज़रूरी हो तो N95 मास्क पहनें। बच्चे और बुज़ुर्ग अंदर रहें।","बाहर बिल्कुल कम जाएँ; N95 मास्क ज़रूर पहनें। बच्चे, बुज़ुर्ग और दमा के मरीज़ अंदर ही रहें।","घर के अंदर ही रहें। बाहर जाना बहुत ज़रूरी हो तभी N95 मास्क पहनकर जाएँ।"][b];
    return "आज "+S.place.name+" की हवा "+cat+" है। हवा का नंबर (AQI) "+fmt(a)+" है। "+act;
  }
  var catE=["very good","good","okay, not great","poor","very poor","dangerous"][b];
  var actE=["All outdoor plans are fine today.","Going out is fine; sensitive people, take a little care.","Avoid long runs or heavy exercise outside; short outings are okay.","Go out less; wear an N95 if you must. Children & elders stay in.","Go out as little as possible, N95 on. Children, elders & asthma patients stay in.","Stay indoors. Out only if essential, with an N95."][b];
  return "Today the air in "+S.place.name+" is "+catE+". The air number (AQI) is "+fmt(a)+". "+actE;
}
function updateVoiceSimple(){
  if(!S.current) return;
  $("voiceSimple").textContent = simpleLine(S.lang);
}
function buildSpokenReport(lang){
  if(!S.current) return lang==="hi" ? "Live data abhi load nahi hua hai. Thoda ruk kar dobara koshish karein." : "Live data has not loaded yet. Please wait a moment and try again.";
  var a=S.cpcb, cig=(S.trail.pm25/22), bw=$("bestWindow").textContent;
  var riskTxt=""; try{ var r=calcRisk(); riskTxt = lang==="hi" ? " Aapke liye personal risk score 100 me se "+r.score+" hai." : " Your personal risk score is "+r.score+" out of 100."; }catch(e){}
  if(lang==="hi"){
    return "सुनिए, आज की हवा की रिपोर्ट। "+simpleLine("hi")+
      " आज की हवा में दिन भर साँस लेना लगभग "+(cig<0.5?"आधी":String(Math.round(cig)))+" सिगरेट के बराबर है।"+
      " सबसे साफ़ समय "+bw+" है — खिड़कियाँ या टहलना उसी समय करें।"+
      riskTxt+
      " मास्क कपड़े वाला नहीं, फिटेड N95 हो। यह लाइव डेटा से बनी है।";
  }
  return "Here is today's air report. "+simpleLine("en")+
    " Breathing today's air all day ≈ smoking "+(cig<0.5?"half a":String(Math.round(cig)))+" cigarette"+(Math.round(cig)===1?"":"s")+"."+
    " Cleanest time today: "+bw+" — open windows or walk then."+
    riskTxt+
    " Use a well-fitted N95, not a cloth mask. From live data.";
}
/* Roman-script (Hinglish) twins of the Hindi lines — spoken with the English voice when the phone has no Hindi voice pack, so Hindi listeners still hear the full report instead of silence. */
function simpleLineRoman(){
  var a=S.cpcb, b=bandOf(a);
  var cat=["bahut achchi","achchi","theek-thaak, zyada achchi nahi","kharaab","bahut kharaab","khatarnaak"][b];
  var act=["Aaj bahar ke saare kaam aaram se kar sakte hain.","Bahar ja sakte hain; naazuk sehat wale dhyaan rakhein.","Lambi daud ya bhaari kasrat bahar na karein; chhote kaam chalenge.","Bahar kam jaayein; jaana zaroori ho to N95 mask pehnein. Bachche aur buzurg andar rahein.","Bahar bilkul kam jaayein; N95 mask zaroor pehnein. Bachche, buzurg aur dama ke mareez andar hi rahein.","Ghar ke andar hi rahein. Bahar jaana bahut zaroori ho tabhi N95 mask pehenkar jaayein."][b];
  return "Aaj "+S.place.name+" ki hawa "+cat+" hai. Hawa ka number (AQI) "+fmt(a)+" hai. "+act;
}
function buildSpokenReportRoman(){
  if(!S.current) return "Live data abhi load nahi hua hai. Thoda ruk kar dobara koshish karein.";
  var cig=(S.trail.pm25/22), bw=$("bestWindow").textContent;
  var riskTxt=""; try{ var r=calcRisk(); riskTxt=" Aapke liye personal risk score 100 mein se "+r.score+" hai."; }catch(e){}
  return "Suniye, aaj ki hawa ki report. "+simpleLineRoman()+
    " Aaj ki hawa mein din bhar saans lena lagbhag "+(cig<0.5?"aadhi":String(Math.round(cig)))+" cigarette ke barabar hai."+
    " Sabse saaf samay "+bw+" hai. Khidkiyaan ya tahalna usi samay karein."+
    riskTxt+
    " Mask kapde wala nahi, fitted N95 ho. Yeh live data se bani hai.";
}
function buildSpokenRisk(){
  var lang=S.lang, r;
  try{ r=calcRisk(); }catch(e){ return lang==="hi"?"Risk abhi uplabdh nahi hai.":"Risk is not available yet."; }
  if(lang==="hi") return "Aapka personal risk score 100 me se "+r.score+" hai. Faisla: "+r.verdict+". "+r.why+" Poori report ke liye bada Listen button dabayein.";
  return "Your personal risk score is "+r.score+" out of 100. Verdict: "+r.verdict+". "+r.why;
}
function buildSpokenPlan(){
  if(!S.planText) renderPlan();
  var lang=$("pLang").value;
  return (lang==="hi" ? S.place.name+" ke liye aapka ClearAir plan. " : "Your ClearAir plan for "+S.place.name+". ")+S.planText;
}
function buildSpokenPlanRoman(){
  if($("pLang").value!=="hi") return null;
  if(!S.planText) renderPlan();
  var b=bestWindow(); var bTxt=b?hourLabel(b.from)+"–"+hourLabel(b.to):"—";
  var txt=S.planText.split(T.hi.openWin(bTxt)).join(T.hi.openWinR(bTxt)).split(T.hi.mask).join(T.hi.maskR)
    .split("सुबह").join("Subah").split("आना-जाना").join("Aana-jaana").split("घर के अंदर").join("Ghar ke andar").split("शाम").join("Shaam");
  return S.place.name+" ke liye aapka ClearAir plan. "+txt;
}
if(voiceSupported() && speechSynthesis.onvoiceschanged!==undefined){ speechSynthesis.onvoiceschanged=function(){ refreshVoiceNote(); }; }

/* ========= Ask ========= */
function answer(q){
  var s=q.toLowerCase(), hindi=/[\u0900-\u097F]/.test(q)||/mask pehn|bachch|khel|khidki/.test(s);
  var a=S.cpcb, risk=calcRisk();
  var en={
    mask: a>100 ? "Yes — at CPCB AQI "+fmt(a)+", wear a fitted N95/KN95 for outings over ~20 min. Cloth masks barely stop PM2.5." : "At CPCB AQI "+fmt(a)+", a mask is optional for healthy adults; sensitive people may still prefer one.",
    play: a>200 ? "Not today — AQI "+fmt(a)+" is poor for children's lungs. Indoor play, or the best window "+$("bestWindow").textContent+" at most." : a>100 ? "Short play is okay, ideally in the best window "+$("bestWindow").textContent+", away from main roads." : "Yes — air is fine for outdoor play today (AQI "+fmt(a)+").",
    run: "For your selected profile the risk score is "+risk.score+"/100: "+risk.verdict+". "+risk.why,
    win: $("ventWindow").textContent,
    def: "Risk = live AQI × your profile × activity × minutes outside, by fixed rules — same inputs, same verdict."
  };
  var hi={
    mask: a>100 ? "हाँ — CPCB AQI "+fmt(a)+" पर 20 मिनट से लंबी बाहर की यात्रा के लिए फिटेड N95/KN95 पहनें। कपड़े का मास्क PM2.5 से ज़्यादा सुरक्षा नहीं देता।" : "CPCB AQI "+fmt(a)+" पर स्वस्थ वयस्कों के लिए मास्क वैकल्पिक है।",
    play: a>200 ? "आज बेहतर होगा कि बच्चे बाहर न खेलें — AQI "+fmt(a)+" बच्चों के फेफड़ों के लिए खराब है।" : "थोड़ी देर खेल सकते हैं, सबसे अच्छा समय "+$("bestWindow").textContent+" है।",
    run: "आपके चुने हुए प्रोफ़ाइल के लिए risk score "+risk.score+"/100 है: "+risk.why,
    win: $("ventWindow").textContent,
    def: "Risk score live CPCB AQI, आपकी health profile, activity और बाहर बिताए समय से तय नियमों से बनता है।"
  };
  var L=hindi?hi:en;
  if(/mask|मास्क|n95/.test(s)) return L.mask;
  if(/kid|child|bachch|बच्च|play|khel|खेल/.test(s)) return L.play;
  if(/run|exercise|walk|cycle|sport|दौड़|टहल/.test(s)) return L.run;
  if(/window|ventilat|khidki|खिड़क/.test(s)) return L.win;
  if(/risk|score|स्कोर/.test(s)) return L.def;
  return (hindi? "इस समय "+S.place.name+" में CPCB AQI "+fmt(a)+" ("+catIN(a)[0]+") है। सबसे साफ़ समय "+$("bestWindow").textContent+" है। मास्क, बच्चों के खेल या खिड़की के बारे में पूछकर देखें।" : "Right now "+S.place.name+" is at CPCB AQI "+fmt(a)+" ("+catIN(a)[0]+"). Cleanest slot: "+$("bestWindow").textContent+". Ask me about masks, kids playing, exercise or windows.");
}
function pushMsg(txt,who,src){
  var d=document.createElement("div"); d.className="msg "+who; d.textContent=txt;
  /* Honest source label: AI-written answers and built-in-guide answers
     are marked as such, in small muted text under the message. */
  if(src){ var s=document.createElement("span"); s.className="mini"; s.style.display="block"; s.style.marginTop="4px"; s.style.opacity=".75"; s.textContent=src; d.appendChild(s); }
  $("chatLog").appendChild(d); $("chatLog").scrollTop=1e6;
}
/* Ask prompt: the user's question plus ONLY the live facts the built-in
   answer() uses, so the AI is grounded in the same numbers. */
function buildAskPrompt(q){
  var hindi=/[\u0900-\u097F]/.test(q)||/mask pehn|bachch|khel|khidki/.test(q.toLowerCase());
  var risk=calcRisk();
  return ["You are ClearAir, a careful air-quality assistant for Indian families. Answer the user's question using ONLY the live facts below. Never invent numbers. No medical diagnosis.",
  "FACTS: Place: "+S.place.name+" · CPCB NAQI now: "+fmt(S.cpcb)+" ("+catIN(S.cpcb)[0]+") · US AQI: "+fmt(S.usAqi)+" · PM2.5 now: "+fmt(S.pm25Now,0)+" µg/m³ · Cleanest slot today: "+$("bestWindow").textContent+" · Ventilation advice: "+$("ventWindow").textContent+" · This user's personal risk score: "+risk.score+"/100 ("+risk.verdict+").",
  "Keep the answer short — 2 or 3 sentences, practical, in "+(hindi?"Hindi":"English")+".",
  "QUESTION: "+q].join("\n");
}
/* ========= Compare & card ========= */
function fetchAqiFor(lat,lon,cb){ fetch("https://air-quality-api.open-meteo.com/v1/air-quality?latitude="+lat+"&longitude="+lon+"&current=pm2_5,us_aqi&hourly=pm2_5&forecast_days=1&timezone=auto").then(function(r){return r.json();}).then(function(j){ var pm=j.current.pm2_5; var sub=subIndex(pm,BP.pm25); cb({pm:pm,approx:sub,us:j.current.us_aqi}); }).catch(function(){ cb(null); }); }
function compare(){
  var qs=[$("cmpA").value.trim(),$("cmpB").value.trim(),$("cmpC").value.trim()].filter(Boolean);
  if(qs.length<2){ $("cmpOut").innerHTML='<p class="mini">Enter at least two places.</p>'; return; }
  setBusy($("cmpBtn"),true,"Comparing…");
  $("cmpOut").innerHTML='<p class="mini">Loading live data…</p>';
  var out=[], done=0;
  function step(){ if(++done===qs.length){ drawCmp(out); setBusy($("cmpBtn"),false); } }
  qs.forEach(function(q,i){ geocodeSilent(q,function(g){ if(!g){ out[i]={name:q,err:1}; step(); } else fetchAqiFor(g.lat,g.lon,function(v){ out[i]={name:g.name,v:v}; step(); }); }); });
  function drawCmp(o){ $("cmpOut").innerHTML=o.map(function(x){ if(x.err||!x.v) return '<div class="cell"><b>'+escHtml(x.name)+'</b><p class="mini">Not found / unavailable</p></div>'; var c=catIN(x.v.approx); return '<div class="cell"><div class="l mini" style="font-weight:700">'+escHtml(x.name)+'</div><div class="v">'+fmt(x.v.approx)+'</div><div class="mini">CPCB estimate · '+c[0]+' · PM2.5 '+fmt(x.v.pm,0)+' µg/m³ · US AQI '+fmt(x.v.us)+'</div></div>'; }).join(""); }
}
function geocodeSilent(q,cb){ fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(q)+"&count=1&language=en&format=json").then(function(r){return r.json();}).then(function(j){ cb(j.results&&j.results.length?{lat:j.results[0].latitude,lon:j.results[0].longitude,name:j.results[0].name}:null); }).catch(function(){cb(null);}); }
function makeCard(){
  var cv=document.createElement("canvas"); cv.width=900; cv.height=560; var x=cv.getContext("2d");
  var dark=effectiveDark();
  x.fillStyle=dark?"#1c1c1e":"#ffffff"; x.fillRect(0,0,900,560);
  x.fillStyle=dark?"#f5f5f7":"#1d1d1f"; x.font="700 44px -apple-system,Helvetica,Arial"; x.fillText("ClearAir — "+S.place.name,48,84);
  x.font="800 170px -apple-system,Helvetica,Arial"; x.fillText(fmt(S.standard==="IN"?S.cpcb:S.usAqi),44,268);
  var c=S.standard==="IN"?catIN(S.cpcb):catUS(S.usAqi);
  x.font="700 40px -apple-system,Helvetica,Arial"; x.fillText(c[0]+" · "+(S.standard==="IN"?"India CPCB":"US EPA"),48,330);
  x.font="400 30px -apple-system,Helvetica,Arial"; x.fillStyle=dark?"#d1d1d6":"#515154";
  x.fillText("PM2.5 "+fmt(S.pm25Now,0)+" µg/m³ · Best window "+$("bestWindow").textContent,48,396);
  var rk=calcRisk(); x.fillText("My risk today: "+rk.score+"/100 — "+rk.verdict,48,448);
  x.font="400 22px -apple-system,Helvetica,Arial"; x.fillStyle=dark?"#98989f":"#6e6e73";
  x.fillText("Live data: Open-Meteo / Copernicus CAMS (modelled) · "+S.updated,48,516);
  $("cardOut").innerHTML=""; var img=new Image(); img.src=cv.toDataURL("image/png"); img.alt="Shareable air quality card for "+S.place.name; img.className="cardimg";
  var a=document.createElement("a"); a.href=img.src; a.download="clearair-"+S.place.name.toLowerCase().replace(/\s+/g,"-")+".png"; a.className="btn primary"; a.style.marginTop="10px"; a.textContent="Download card PNG";
  $("cardOut").appendChild(img); $("cardOut").appendChild(a);
}
/* ========= Events ========= */
$("searchForm").addEventListener("submit",function(e){ e.preventDefault(); var q=$("searchInput").value.trim(); if(q){ setBusy($("searchBtn"),true,"Searching…"); geocode(q,function(lat,lon,n,c){ load(lat,lon,n,c); }); } });
$("locBtn").addEventListener("click",function(){ if(!navigator.geolocation){ $("loadErr").hidden=false; $("loadErr").textContent="Location is not available in this browser."; return; } setBusy($("locBtn"),true,"Locating…"); navigator.geolocation.getCurrentPosition(function(p){ load(p.coords.latitude,p.coords.longitude,"My location",""); },function(){ setBusy($("locBtn"),false); $("loadErr").hidden=false; $("loadErr").textContent="Location permission was not given — search for your city instead."; }); });
$("stdIn").addEventListener("click",function(){ S.standard="IN"; $("stdIn").setAttribute("aria-pressed","true"); $("stdUs").setAttribute("aria-pressed","false"); renderAll(); });
$("stdUs").addEventListener("click",function(){ S.standard="US"; $("stdUs").setAttribute("aria-pressed","true"); $("stdIn").setAttribute("aria-pressed","false"); renderAll(); });
/* One language everywhere: the EN / हिन्दी toggle drives the voice box too — a single Listen button, a single summary, no duplicated text. */
var VOICE_T={
 en:{title:"Listen instead of reading",sub:"Tap — the app speaks today's air and what to do.",btn:"Listen",stop:"Stop",wait:"Today's air in simple words appears here — the voice reads the same.",risk:"Hear this verdict",plan:"Hear the plan"},
 hi:{title:"सुनकर समझें",sub:"बटन दबाएँ — ऐप बोलकर बताएगा आज हवा कैसी है और क्या करना है।",btn:"सुनें",stop:"बंद करें",wait:"Live data आते ही यहाँ आसान शब्दों में हालत दिखेगी — आवाज़ वही बोलेगी।",risk:"यह फैसला सुनें",plan:"Plan सुनिए"}
};
function setLang(l){
  S.lang=l;
  $("langEn").setAttribute("aria-pressed", l==="en"?"true":"false");
  $("langHi").setAttribute("aria-pressed", l==="hi"?"true":"false");
  $("pLang").value=l;
  var t=VOICE_T[l];
  $("voiceTitle").textContent=t.title; $("voiceSub").textContent=t.sub;
  $("voiceBtnLbl").textContent=t.btn; $("voiceStopLbl").textContent=t.stop;
  $("voiceRiskLbl").textContent=t.risk; $("voicePlanLbl").textContent=t.plan;
  if(S.current) updateVoiceSimple(); else $("voiceSimple").textContent=t.wait;
  refreshVoiceNote();
}
$("langEn").addEventListener("click",function(){ setLang("en"); });
$("langHi").addEventListener("click",function(){ setLang("hi"); });
$("riskAct").addEventListener("change",renderRisk); $("riskDur").addEventListener("input",renderRisk);
$("maskToggle").addEventListener("click",function(){ var b=$("maskToggle"); b.setAttribute("aria-pressed", b.getAttribute("aria-pressed")==="true"?"false":"true"); renderRisk(); });
document.querySelectorAll("[data-demo]").forEach(function(b){ b.addEventListener("click",function(){ var d=b.getAttribute("data-demo");
  if(d==="healthy"){ S.persona="general"; $("riskAct").value="walk"; $("riskDur").value=30; }
  if(d==="asthma"){ S.persona="asthma"; $("riskAct").value="run"; $("riskDur").value=45; }
  if(d==="child"){ S.persona="children"; $("riskAct").value="play"; $("riskDur").value=60; }
  buildPersonas(); renderRisk(); document.getElementById("risk").scrollIntoView({behavior:"smooth"}); }); });
$("simDur").addEventListener("input",renderSim); $("simInt").addEventListener("change",renderSim);
$("bestAct").addEventListener("change",function(){ renderBest(); renderVent(); });
$("alertBtn").addEventListener("click",function(){ var t=$("alertThresh").value; $("alertState").textContent = S.cpcb>+t ? "Heads-up: "+S.place.name+" is already above "+t+" (now "+fmt(S.cpcb)+"). Checked live each time you open ClearAir." : "Alert set: CPCB AQI > "+t+" for "+S.place.name+" (now "+fmt(S.cpcb)+"). Checked live on each visit."; });
$("taskForm").addEventListener("submit",function(e){ e.preventDefault(); var name=$("taskName").value.trim(); if(!name) return; var tv=$("taskTime").value; var lbl=taskLabel(tv);
  S.tasks.push({name:name,timeLabel:lbl,kind:$("taskKind").value}); $("taskName").value=""; renderPlanner(); });
function taskLabel(tv){ var d=new Date(); d.setHours(+tv.slice(0,2),+tv.slice(3,5),0,0); var h=d.getHours(),ap=h>=12?"PM":"AM"; return (h%12||12)+" "+ap; }
$("genPlan").addEventListener("click",function(){ generatePlan(); });
$("copyPlan").addEventListener("click",function(){ if(!S.planText) renderPlan(); if(navigator.clipboard) navigator.clipboard.writeText("ClearAir plan — "+S.place.name+" (CPCB AQI "+fmt(S.cpcb)+")\n\n"+S.planText).then(function(){ $("planState").textContent="Plan copied."; }); });
["pTransport","pCook","pHome","pClean","pFamily","pLang"].forEach(function(id){ $(id).addEventListener("change",updatePrompt); });
$("voiceBtn").addEventListener("click",function(){ if(voiceOn){ stopSpeaking(); return; } speakText(buildSpokenReport(S.lang),S.lang, S.lang==="hi"?buildSpokenReportRoman():null); });
$("voiceStop").addEventListener("click",stopSpeaking);
$("voiceRiskBtn").addEventListener("click",function(){ var t=buildSpokenRisk(); speakText(t,S.lang, S.lang==="hi"?t:null); });
$("voicePlanBtn").addEventListener("click",function(){ speakText(buildSpokenPlan(),$("pLang").value, buildSpokenPlanRoman()); });
window.addEventListener("beforeunload",function(){ if(voiceSupported()) speechSynthesis.cancel(); });
$("retryBtn").addEventListener("click",function(){ setBusy($("retryBtn"),true,"Retrying…"); load(S.place.lat,S.place.lon,S.place.name,S.place.country); setTimeout(function(){ setBusy($("retryBtn"),false); },400); });
$("cmpBtn").addEventListener("click",compare);
$("cardBtn").addEventListener("click",makeCard);
$("chatForm").addEventListener("submit",function(e){
  e.preventDefault();
  var q=$("chatInput").value.trim(); if(!q) return;
  pushMsg(q,"u"); $("chatInput").value="";
  /* Before live data loads there are no facts to ground the AI in —
     the built-in guide answers, exactly as it always has. */
  if(!S.hourly){ pushMsg(answer(q),"a"); return; }
  askAI(buildAskPrompt(q)).then(function(txt){
    pushMsg(txt,"a","AI answer · from the live data above");
  }).catch(function(){
    pushMsg(answer(q),"a","Built-in guide · from the live data above");
  });
});
/* ========= Theme — light/dark toggle =========
   Default follows the system preference. The top-bar toggle stores an
   explicit choice (localStorage) that sets data-theme on <html> and
   overrides the system until changed. */
function effectiveDark(){
  var t=document.documentElement.getAttribute("data-theme");
  if(t) return t==="dark";
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function paintThemeBtn(){
  var b=$("themeBtn"); if(!b) return;
  var d=effectiveDark();
  b.setAttribute("aria-pressed", d?"true":"false");
  b.setAttribute("aria-label", d?"Switch to light theme":"Switch to dark theme");
  b.innerHTML='<i data-lucide="'+(d?"sun":"moon")+'"></i>';
  if(window.lucide) lucide.createIcons();
}
(function(){
  var t=null;
  try{ t=localStorage.getItem("clearair-theme"); }catch(e){}
  if(t==="dark"||t==="light") document.documentElement.setAttribute("data-theme",t);
})();
$("themeBtn").addEventListener("click",function(){
  var next=effectiveDark()?"light":"dark";
  document.documentElement.setAttribute("data-theme",next);
  try{ localStorage.setItem("clearair-theme",next); }catch(e){}
  paintThemeBtn();
});
/* ========= Live freshness — auto-refresh + "updated … ago" ========= */
/* tickLive runs every 30 s for the page's whole lifetime against an
   element that is never replaced — resolve it once and cache it. */
var _liveTxtEl=null;
function tickLive(){
  var el=_liveTxtEl||(_liveTxtEl=$("liveTxt")); if(!el) return;
  if(!S.fetchedAt){ el.textContent="LIVE · connecting…"; return; }
  var m=Math.floor((Date.now()-S.fetchedAt)/60000);
  el.textContent="LIVE · updated "+(m<1?"just now":m+" min ago")+" · auto-refresh on";
}
setInterval(tickLive,30000);
setInterval(function(){ if(S.place) load(S.place.lat,S.place.lon,S.place.name,S.place.country); },600000);
document.addEventListener("visibilitychange",function(){ if(!document.hidden && S.fetchedAt && Date.now()-S.fetchedAt>600000) load(S.place.lat,S.place.lon,S.place.name,S.place.country); });
/* Init */
$("polGrid").innerHTML=POLS.map(function(p){return '<div class="pol"><div class="name"><span>'+p[1]+'</span></div><div class="val">– <span class="unit">'+p[2]+'</span></div><div class="mini" style="margin-top:4px">Waiting for live data…</div></div>';}).join("");
paintThemeBtn();
buildPersonas(); buildHabits(); buildAudit(); renderAudit();
pushMsg("Namaste — ask about masks, kids playing, exercise or windows. I answer from the live data above.","a");
load(S.place.lat,S.place.lon,S.place.name,S.place.country);
if(window.lucide) lucide.createIcons();
