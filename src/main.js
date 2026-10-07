import './style.css';
(function(){
'use strict';
const NEA_PSI='https://api-open.data.gov.sg/v2/real-time/api/psi';
const NEA_PM25='https://api-open.data.gov.sg/v2/real-time/api/pm25';
const OM_W='https://api.open-meteo.com/v1/forecast';
const OM_A='https://air-quality-api.open-meteo.com/v1/air-quality';
const WQ='current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&timezone=auto';
const AQ='current=us_aqi,pm2_5,pm10&hourly=pm2_5&past_days=1&forecast_days=2&timezone=auto';

const SG={
  west:{lat:1.35735,lon:103.70},east:{lat:1.35735,lon:103.94},central:{lat:1.35735,lon:103.82},
  south:{lat:1.29587,lon:103.82},north:{lat:1.41803,lon:103.82}};
const RNAMES=Object.keys(SG);
const CITIES=[
  {name:'Singapore',co:'Singapore',lat:1.3521,lon:103.8198},
  {name:'Kuala Lumpur',co:'Malaysia',lat:3.139,lon:101.6869},
  {name:'Jakarta',co:'Indonesia',lat:-6.2088,lon:106.8456},
  {name:'Manila',co:'Philippines',lat:14.5995,lon:120.9842},
  {name:'Bangkok',co:'Thailand',lat:13.7563,lon:100.5018},
  {name:'Hanoi',co:'Vietnam',lat:21.0285,lon:105.8542},
  {name:'Ho Chi Minh City',co:'Vietnam',lat:10.8231,lon:106.6297},
  {name:'Phnom Penh',co:'Cambodia',lat:11.5564,lon:104.9282},
  {name:'Vientiane',co:'Laos',lat:17.9757,lon:102.6331},
  {name:'Yangon',co:'Myanmar',lat:16.8409,lon:96.1735},
  {name:'Bandar Seri Begawan',co:'Brunei',lat:4.9031,lon:114.9398},
  {name:'Pekanbaru',co:'Indonesia (Riau)',lat:0.5071,lon:101.4478},
  {name:'Palembang',co:'Indonesia (S. Sumatra)',lat:-2.9761,lon:104.7754}];

const state={sel:'central',city:'Jakarta',group:'healthy',sg:null,asean:null,tab:'sg'};

/* ---------- helpers ---------- */
const $=(s,r=document)=>r.querySelector(s);
const fmt=(v,d=0)=>v==null||isNaN(v)?'–':Number(v).toFixed(d);
const LABELS=['Good','Moderate','Unhealthy for sensitive groups','Unhealthy','Very unhealthy','Hazardous'];
const chip=(l,t)=>`<span class="chip" style="--c:var(--b${l});--ink:var(--i${l})">${t}</span>`;
const psiLvl=v=>v==null?null:v<=50?0:v<=100?1:v<=200?3:v<=300?4:5;
const aqiLvl=v=>v==null?null:v<=50?0:v<=100?1:v<=150?2:v<=200?3:v<=300?4:5;
const pmBand=v=>v==null?null:v<=55?{l:0,t:'Normal',n:1}:v<=150?{l:2,t:'Elevated',n:2}:v<=250?{l:4,t:'High',n:3}:{l:5,t:'Very high',n:4};
const WX={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Light showers',81:'Showers',82:'Heavy showers',85:'Snow showers',86:'Snow showers',95:'Thunderstorm',96:'Thunderstorm, hail',99:'Thunderstorm, hail'};
const skyOf=w=>{if(!w)return null;const c=w.weather_code,n=w.is_day===0;
  if(c>=95)return'storm';if(c===45||c===48)return'fog';
  if((c>=51&&c<=67)||(c>=80&&c<=82))return'rain';
  if(n)return'night';if(c<=1)return'clear';return'cloudy'};
const SKYNAME={clear:'Clear sky',cloudy:'Cloudy',rain:'Rain',storm:'Thunderstorm',fog:'Fog',night:'Night'};
const compass=d=>d==null?'':['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8];
const sgTime=iso=>{try{return new Date(iso).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour:'numeric',minute:'2-digit',day:'numeric',month:'short'})}catch(e){return ''}};

async function getJSON(url){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);
  try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}
  finally{clearTimeout(t)}
}
async function om(base,pts,q){
  const url=`${base}?latitude=${pts.map(p=>p.lat).join(',')}&longitude=${pts.map(p=>p.lon).join(',')}&${q}`;
  const r=await getJSON(url);return Array.isArray(r)?r:[r];
}
function series(a){ // air-quality hourly -> {time,val,now}
  if(!a||!a.hourly)return null;
  const time=a.hourly.time,val=a.hourly.pm2_5;
  let now=a.current&&a.current.time?time.indexOf(a.current.time):-1;
  if(now<0)now=Math.min(24,time.length-1);
  return{time,val,now};
}

/* ---------- data loading ---------- */
async function loadSG(){
  const pts=RNAMES.map(n=>SG[n]);
  const day=o=>new Date(Date.now()-o*864e5).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  const [psi,pmT,pmY,wx]=await Promise.allSettled([getJSON(NEA_PSI),getJSON(NEA_PM25+'?date='+day(0)),getJSON(NEA_PM25+'?date='+day(1)),om(OM_W,pts,WQ)]);
  if([psi,pmT,pmY,wx].every(x=>x.status==='rejected'))return sampleSG();
  const out={sample:false,regions:{},national:null,ts:null,neaOk:psi.status==='fulfilled'};
  let pr=null;
  try{const it=psi.value.data.items[0];pr=it.readings;out.ts=it.updatedTimestamp||it.timestamp;out.readTs=it.timestamp;out.national=pr.psi_twenty_four_hourly.national}catch(e){}
  const byTs=new Map();
  [pmY,pmT].forEach(p=>{if(p.status==='fulfilled'){try{p.value.data.items.forEach(i=>byTs.set(i.timestamp,i))}catch(e){}}});
  const items=[...byTs.values()].sort((a,b)=>a.timestamp<b.timestamp?-1:1).slice(-25);
  const last=items[items.length-1];
  if(last)out.pmTs=last.updatedTimestamp||last.timestamp;
  RNAMES.forEach((n,i)=>{
    const g=k=>pr&&pr[k]?pr[k][n]:null;
    const w=wx.status==='fulfilled'?wx.value[i]:null;
    const val=items.map(it=>it.readings&&it.readings.pm25_one_hourly?it.readings.pm25_one_hourly[n]:null);
    out.regions[n]={
      psi:g('psi_twenty_four_hourly'),pm1:last&&last.readings.pm25_one_hourly?last.readings.pm25_one_hourly[n]:null,
      subs:{pm25:g('pm25_twenty_four_hourly'),pm10:g('pm10_twenty_four_hourly'),o3:g('o3_eight_hour_max'),no2:g('no2_one_hour_max'),so2:g('so2_twenty_four_hourly'),co:g('co_eight_hour_max')},
      idx:{pm25:g('pm25_sub_index'),pm10:g('pm10_sub_index'),o3:g('o3_sub_index'),co:g('co_sub_index'),so2:g('so2_sub_index')},
      w:w&&w.current?w.current:null,
      s:val.length>1?{time:items.map(it=>it.timestamp),val,now:val.length-1}:null};
  });
  if(!out.ts)out.ts=new Date().toISOString();
  return out;
}
async function loadAsean(){
  const others=CITIES.filter(c=>c.name!=='Singapore');
  const [wx,aq]=await Promise.allSettled([om(OM_W,CITIES,WQ),om(OM_A,others,AQ)]);
  if(wx.status==='rejected'&&aq.status==='rejected')return sampleAsean();
  return{sample:false,ts:new Date().toISOString(),cities:CITIES.map((c,i)=>{
    const w=wx.status==='fulfilled'?wx.value[i]:null;
    const j=others.indexOf(c),a=aq.status==='fulfilled'&&j>=0?aq.value[j]:null;
    return{...c,w:w&&w.current?w.current:null,a:a&&a.current?a.current:null,s:series(a)}})};
}
// Singapore's haze values come from NEA (data.gov.sg), not Open-Meteo
function applyNEAtoSingapore(){
  const as=state.asean,sg=state.sg;if(!as||!sg||as.sample||sg.sample)return;
  const c=as.cities.find(x=>x.name==='Singapore');if(!c)return;
  const pm=RNAMES.map(n=>sg.regions[n].pm1).filter(v=>v!=null);
  c.a=sg.national!=null?{psi:sg.national,pm2_5:pm.length?pm.reduce((x,y)=>x+y,0)/pm.length:null}:null;
  c.s=sg.regions.central.s;
}

/* ---------- sample data (shown only when live feeds are unreachable) ---------- */
function fakeSeries(base,amp,seed){
  const time=[],val=[];const start=new Date();start.setMinutes(0,0,0);start.setHours(start.getHours()-24+8);
  for(let i=0;i<72;i++){const d=new Date(start.getTime()+i*3600e3);
    time.push(new Date(d.getTime()).toISOString().slice(0,13)+':00');
    val.push(Math.max(2,Math.round((base+amp*Math.sin((i+seed)/7.5)+amp*.4*Math.sin((i+seed)/2.9))*10)/10))}
  return{time,val,now:24};
}
function sampleSG(){
  const P={west:[52,19,31],east:[47,15,30],central:[50,17,31],south:[44,12,30],north:[55,21,30]};
  const regions={};
  RNAMES.forEach((n,i)=>{const p=P[n];regions[n]={psi:p[0],pm1:p[1],
    subs:{pm25:p[1]+4,pm10:p[0]-22,o3:38+i*3,no2:22+i*2,so2:6+i,co:.4+i*.05},
    w:{temperature_2m:p[2]+.4,relative_humidity_2m:72+i,apparent_temperature:p[2]+5,precipitation:0,weather_code:2,wind_speed_10m:8+i,wind_direction_10m:120,is_day:1},
    idx:{pm25:p[0],pm10:p[0]-18,o3:30+i,co:4,so2:3},
    a:{us_aqi:p[0]+2,pm2_5:p[1],pm10:p[1]+10},s:fakeSeries(p[1],6,i*3)}});
  return{sample:true,regions,national:50,ts:new Date().toISOString(),readTs:new Date().toISOString(),neaOk:false};
}
function sampleAsean(){
  const A={Singapore:[52,16,31],'Kuala Lumpur':[72,24,32],Jakarta:[98,36,32],Manila:[64,20,31],Bangkok:[88,31,33],Hanoi:[120,44,29],'Ho Chi Minh City':[76,25,32],'Phnom Penh':[58,18,33],Vientiane:[66,22,31],Yangon:[54,15,30],'Bandar Seri Begawan':[40,10,30],Pekanbaru:[135,52,32],Palembang:[110,40,31]};
  return{sample:true,ts:new Date().toISOString(),cities:CITIES.map((c,i)=>{const a=A[c.name];
    return{...c,w:{temperature_2m:a[2],relative_humidity_2m:78,apparent_temperature:a[2]+4,precipitation:0,weather_code:[2,3,61,95,0,45][i%6],wind_speed_10m:9,wind_direction_10m:200,is_day:1},
      a:{us_aqi:a[0],pm2_5:a[1],pm10:a[1]+12},s:fakeSeries(a[1],a[1]*.25,i*5)}})};
}

/* ---------- map (geometry traced from the reference screenshot, 869 x 572) ---------- */
const FILL={0:'#2c6a55',1:'#69693a',3:'#6e4448',4:'#5b4a7c',5:'#6d3a55'};
const POLY={
  west:'M241 92L313 88L313 403L93 413L66 342L119 235Z',
  north:'M313 88L518 88L591 140L591 197L313 197Z',
  central:'M313 197L591 197L591 338L313 338Z',
  east:'M591 140L649 175L733 210L800 260L793 307L733 330L591 348Z',
  south:'M313 338L591 338L591 348L540 392L503 403L313 403Z'};
const SENTOSA='M400 432L423 423L478 422L498 432L478 445L433 448L408 443Z';
const CHIPPOS={north:[443,112],central:[434,259],west:[191,268],east:[678,268],south:[443,512]};
const EX={central:'Toa Payoh, Bishan, Orchard',north:'Woodlands, Sembawang, Yishun',south:'Marina Bay, Sentosa, Bukit Merah',east:'Tampines, Bedok, Changi',west:'Jurong, Tuas, Clementi'};
function buildMap(){
  const zones=RNAMES.map(n=>`<path class="zone" data-r="${n}" d="${POLY[n]}"><title>${n}</title></path>`).join('')
    +`<path class="zone" data-r="south" d="${SENTOSA}"/>`;
  const chips=RNAMES.map(n=>{const p=CHIPPOS[n];
    return `<button type="button" class="hzchip" data-r="${n}" style="left:${p[0]/869*100}%;top:${p[1]/572*100}%"><small>${n}</small><strong data-chipv="${n}">–</strong><em data-chipl="${n}"></em></button>`}).join('');
  $('#map').innerHTML=`<svg viewBox="0 0 869 572" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of Singapore split into north, south, east, west and central regions">
    ${zones}
    <line x1="443" y1="382" x2="443" y2="466" stroke="#9AA7B0" stroke-width="1.5" stroke-dasharray="2 5"/>
    <circle cx="443" cy="382" r="4.5" fill="#C8D2D9"/></svg>
    <span class="hz-lbl" style="top:12px;left:50%;transform:translateX(-50%)">Johor, Malaysia</span>
    <span class="hz-lbl" style="left:16px;bottom:12px">Singapore Strait</span>${chips}`;
  $('#map').addEventListener('click',e=>{const t=e.target.closest('[data-r]');if(t){state.sel=t.dataset.r;renderSG()}});
  $('#legend').innerHTML=[[0,'Good 0–50'],[1,'Moderate 51–100'],[3,'Unhealthy 101–200'],[4,'Very unhealthy 201–300'],[5,'Hazardous 301+']]
    .map(([l,t])=>`<span><i style="--c:var(--m${l})"></i>${t}</span>`).join('');
}

/* ---------- Singapore render ---------- */
function regionLvl(r){return psiLvl(r.psi)}
function regionVal(r){return r.psi}
const hhmm=iso=>{try{return new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const HZ_ADV={0:'Air quality is good. Normal outdoor activities are fine.',1:'Air quality is acceptable. Normal outdoor activities are fine.',
  3:'Cut back on long or strenuous outdoor activity. Children, older adults and people with heart or lung conditions should stay indoors more.',
  4:'Avoid long or strenuous outdoor activity. Everyone should spend more time indoors, and sensitive groups should stay in.',
  5:'Stay indoors where possible and avoid outdoor exertion. Sensitive groups should take extra care.'};
const POLNAME={pm25:'PM2.5',pm10:'PM10',o3:'O₃',co:'CO',so2:'SO₂'};
function renderSG(){
  const d=state.sg;if(!d)return;
  RNAMES.forEach(n=>{
    const r=d.regions[n],l=regionLvl(r);
    document.querySelectorAll(`.zone[data-r="${n}"]`).forEach(z=>z.style.fill=l==null?'#1b2830':FILL[l]);
    const c=$(`.hzchip[data-r="${n}"]`);
    c.style.setProperty('--bc',l==null?'#2a3741':`var(--m${l})`);
    c.classList.toggle('on',n===state.sel);
    $(`[data-chipv="${n}"]`).textContent=fmt(regionVal(r));
    $(`[data-chipl="${n}"]`).textContent=l==null?'':LABELS[l];
  });
  const r=d.regions[state.sel],l=regionLvl(r),w=r.w,S=r.subs;
  let main='–',best=-1;
  Object.keys(r.idx||{}).forEach(k=>{if(r.idx[k]!=null&&r.idx[k]>best){best=r.idx[k];main=POLNAME[k]}});
  const SEG=[0,1,3,4,5],act=SEG.indexOf(l),lim=['50','100','200','300','300+'];
  $('#detail').innerHTML=`
    <div class="mono">${state.sel} · e.g. ${EX[state.sel]}</div>
    <div class="hz-num"><span class="n">${fmt(regionVal(r))}</span>${l==null?'':`<span class="lab"><i style="--c:var(--m${l})"></i>${LABELS[l]}</span>`}</div>
    <div class="scale">${SEG.map((lv,i)=>`<div><i class="${i===act?'on':''}" style="--c:var(--m${lv})"></i><span>${lim[i]}</span></div>`).join('')}</div>
    <p class="hz-adv">${l==null?'Readings are not available right now.':HZ_ADV[l]}</p>
    <div class="hz-stats">
      <div><span class="mono">PM2.5, 24 h</span><b>${fmt(S.pm25)} µg/m³</b></div>
      <div><span class="mono">PM10, 24 h</span><b>${fmt(S.pm10)} µg/m³</b></div>
      <div><span class="mono">Main pollutant</span><b>${main}</b></div>
    </div>`;
  $('#hzNote').textContent=(d.sample?'Sample values. ':`Reading for ${hhmm(d.readTs||d.ts)} SGT, updated ${hhmm(d.ts)}. `)+'Area boundaries are approximate. PSI is a 24-hour measure and NEA updates it every hour. Tap an area for details.';

  const nl=psiLvl(d.national),pb=pmBand(r.pm1);
  const sk=skyOf(w);const wxEl=$('#wx');if(sk)wxEl.setAttribute('data-sky',sk);else wxEl.removeAttribute('data-sky');
  wxEl.innerHTML=`
    <div class="trend-head"><div><h2 style="text-transform:capitalize">Conditions in ${state.sel}</h2><p class="cap">Weather from Open-Meteo, pollutant readings from NEA</p></div>
      <div style="text-align:right"><div class="eyebrow">Singapore overall PSI</div><div class="num" style="font-size:20px;font-weight:600">${fmt(d.national)} ${nl==null?'':chip(nl,LABELS[nl])}</div></div></div>
    <div class="wxhero"><b class="num">${w?fmt(w.temperature_2m,1)+'°C':'–'}</b><span class="cond">${w?(WX[w.weather_code]||''):''}</span></div>
    <div class="kv">
      <div><span>Feels like</span><b class="num">${w?fmt(w.apparent_temperature,0)+'°C':'–'}</b></div>
      <div><span>Humidity</span><b class="num">${w?fmt(w.relative_humidity_2m)+'%':'–'}</b></div>
      <div><span>Wind</span><b class="num">${w?fmt(w.wind_speed_10m)+' km/h '+compass(w.wind_direction_10m):'–'}</b></div>
      <div><span>1-hr PM2.5</span><b class="num">${fmt(r.pm1)} µg/m³</b>${pb?'<div style="margin-top:4px">'+chip(pb.l,`Band ${pb.n} · ${pb.t}`)+'</div>':''}</div>
    </div><hr style="margin-block:16px">
    <div class="poll">
      <div><span>O₃ 8-hr max</span><b class="num">${fmt(S.o3)} <em>µg/m³</em></b></div>
      <div><span>NO₂ 1-hr max</span><b class="num">${fmt(S.no2)} <em>µg/m³</em></b></div>
      <div><span>SO₂ 24-hr</span><b class="num">${fmt(S.so2)} <em>µg/m³</em></b></div>
      <div><span>CO 8-hr max</span><b class="num">${fmt(S.co,1)} <em>mg/m³</em></b></div>
      <div><span>Rain (last hour)</span><b class="num">${w?fmt(w.precipitation,1)+' mm':'–'}</b></div>
    </div>`;

  $('#strip').innerHTML=RNAMES.map(n=>{const x=d.regions[n],lv=regionLvl(x);
    return `<button type="button" class="rc" data-r="${n}" aria-pressed="${n===state.sel}">
      <span class="n">${n}</span><span class="v num">${fmt(regionVal(x))}</span>
      <span>${lv==null?'':chip(lv,LABELS[lv])}</span>
      <span class="m num"><span>PM2.5 ${fmt(x.pm1)}</span><span>${x.w?fmt(x.w.temperature_2m,0)+'°C':''}</span></span></button>`}).join('');
  $('#strip').onclick=e=>{const t=e.target.closest('[data-r]');if(t){state.sel=t.dataset.r;renderSG()}};

  $('#sgTrendTitle').textContent=`PM2.5 trend, ${state.sel[0].toUpperCase()+state.sel.slice(1)}`;
  drawTrend($('#sgChart'),r.s,$('#sgReadout'),55);
  renderAdvice(r);
}
const ADV={
  healthy:{label:'Healthy persons',psi:'Reduce prolonged or strenuous outdoor physical exertion.',pm:'Reduce strenuous outdoor activity for the next hour.'},
  elder:{label:'Elderly, pregnant women and children',psi:'Minimise prolonged or strenuous outdoor physical exertion.',pm:'Avoid strenuous outdoor activity for the next hour.'},
  chronic:{label:'Chronic lung or heart disease',psi:'Avoid prolonged or strenuous outdoor physical exertion.',pm:'Avoid strenuous outdoor activity for the next hour.'}};
function renderAdvice(r){
  $('#advRegion').textContent=state.sel;
  $('#seg').innerHTML=Object.keys(ADV).map(k=>`<button type="button" data-g="${k}" aria-pressed="${k===state.group}">${ADV[k].label}</button>`).join('');
  $('#seg').onclick=e=>{const b=e.target.closest('[data-g]');if(b){state.group=b.dataset.g;renderAdvice(r)}};
  const g=ADV[state.group],items=[];
  if(r.psi!=null&&r.psi>100)items.push(`<div class="rule"><p><b>${g.psi}</b></p><p class="why">24-hr PSI is Unhealthy (${r.psi}).</p></div>`);
  if(r.pm1!=null&&r.pm1>55)items.push(`<div class="rule"><p><b>${g.pm}</b></p><p class="why">1-hr PM2.5 is Elevated, Band 2 or higher (${r.pm1} µg/m³).</p></div>`);
  if(!items.length){
    const known=r.psi!=null&&r.pm1!=null;
    items.push(`<div class="rule"><p><b>Normal activities.</b></p><p class="why">${known?`24-hr PSI is ${r.psi<=50?'Good':'Moderate'} (${r.psi}) and 1-hr PM2.5 is Normal, Band 1 (${r.pm1} µg/m³).`:'Some NEA readings are unavailable, so this is based on the data that loaded.'}</p></div>`);
  }
  $('#advice').innerHTML=items.join('');
}

/* ---------- ASEAN render ---------- */
const av=c=>c.a?(c.a.psi!=null?c.a.psi:c.a.us_aqi):-1;
function renderAsean(){
  const d=state.asean;if(!d)return;
  const key=$('#sort').value;
  const list=d.cities.slice().sort((a,b)=>key==='name'?a.name.localeCompare(b.name):key==='temp'?((b.w?b.w.temperature_2m:-99)-(a.w?a.w.temperature_2m:-99)):(av(b)-av(a)));
  $('#cities').innerHTML=list.map(c=>{const isP=c.a&&c.a.psi!=null,aq=c.a?(isP?c.a.psi:c.a.us_aqi):null,l=isP?psiLvl(aq):aqiLvl(aq),w=c.w;
    return `<button type="button" class="rc cc" data-c="${c.name}"${skyOf(w)?` data-sky="${skyOf(w)}"`:''} aria-pressed="${c.name===state.city}">
      <div class="top"><div><div class="nm">${c.name}</div><div class="co">${c.co}</div></div>${l==null?'':chip(l,LABELS[l].replace('Unhealthy for sensitive groups','Sensitive groups'))}</div>
      <div class="row"><div><div class="v num">${fmt(aq)}</div><div class="cap">${isP?'PSI (NEA)':'US AQI'}</div></div>
        <div style="text-align:right"><div style="font-size:22px;font-weight:300" class="num">${w?fmt(w.temperature_2m,0)+'°C':'–'}</div><div class="cond">${w?(WX[w.weather_code]||''):''}</div></div></div>
      <div class="wx num"><span><b>${c.a?fmt(c.a.pm2_5):'–'}</b>PM2.5</span><span><b>${w?fmt(w.relative_humidity_2m)+'%':'–'}</b>Humidity</span><span><b>${w?fmt(w.wind_speed_10m):'–'}</b>km/h wind</span></div></button>`}).join('');
  $('#cities').onclick=e=>{const t=e.target.closest('[data-c]');if(t){state.city=t.dataset.c;renderAsean()}};
  const c=d.cities.find(x=>x.name===state.city)||d.cities[0];
  $('#asTrendTitle').textContent=`PM2.5 trend, ${c.name}`;
  drawTrend($('#asChart'),c.s,$('#asReadout'),c.name==='Singapore'?55:null);
}

/* ---------- trend chart ---------- */
function niceStep(x){const p=Math.pow(10,Math.floor(Math.log10(x))),f=x/p;return(f<=1?1:f<=2?2:f<=5?5:10)*p}
const charts=new WeakMap();
function drawTrend(el,s,readout,threshold){
  charts.set(el,{s,readout,threshold});
  const w=el.clientWidth;
  if(!s||s.val.length<2||!w){el.innerHTML=s?'':'<p class="cap">No forecast available.</p>';if(readout)readout.textContent='';return}
  const h=Math.round(Math.min(250,Math.max(190,w*.3))),L=40,R=12,T=14,B=26;
  const v=s.val,n=v.length,mx=Math.max(...v.filter(x=>x!=null),1);
  let top=mx*1.15;if(threshold)top=Math.max(top,threshold*1.2);
  const step=niceStep(top/4),ymax=Math.ceil(top/step)*step;
  const X=i=>L+(w-L-R)*i/(n-1),Y=x=>T+(h-T-B)*(1-x/ymax);
  const pts=(a,b)=>{const o=[];for(let i=a;i<=b;i++)if(v[i]!=null)o.push(X(i).toFixed(1)+' '+Y(v[i]).toFixed(1));return o};
  const past=pts(0,s.now),fut=pts(s.now,n-1);
  let grid='';
  for(let t=0;t<=ymax+1e-9;t+=step){grid+=`<line class="grid" x1="${L}" x2="${w-R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L-8}" y="${Y(t)+4}" text-anchor="end">${t}</text>`}
  let xl='';
  for(let i=0;i<n;i++){const hh=s.time[i].slice(11,13);
    if(hh==='00'){const dt=new Date(s.time[i].slice(0,10)+'T00:00:00Z');
      xl+=`<text x="${X(i)}" y="${h-6}" text-anchor="middle">${dt.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',timeZone:'UTC'})}</text>`}
    else if(hh==='12'){xl+=`<text x="${X(i)}" y="${h-6}" text-anchor="middle" style="opacity:.7">12:00</text>`}}
  const thr=threshold&&threshold<ymax?`<line x1="${L}" x2="${w-R}" y1="${Y(threshold)}" y2="${Y(threshold)}" stroke="var(--b2)" stroke-width="1.5" stroke-dasharray="2 4"/><text x="${w-R}" y="${Y(threshold)-5}" text-anchor="end">NEA Band 2 starts at 56</text>`:'';
  const nowV=v[s.now];
  el.innerHTML=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Hourly PM2.5 chart">
    <defs><linearGradient id="fill${el.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${thr}${xl}
    ${past.length?`<path d="M${past.join('L')}L${X(s.now)} ${Y(0)}L${X(0)} ${Y(0)}Z" fill="url(#fill${el.id})"/>`:''}
    <path d="M${past.join('L')}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
    ${fut.length>1?`<path d="M${fut.join('L')}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-dasharray="1 5" stroke-linecap="round"/>`:''}
    <line x1="${X(s.now)}" x2="${X(s.now)}" y1="${T}" y2="${h-B}" stroke="var(--muted)" stroke-width="1" opacity=".5"/>
    <text x="${X(s.now)+6}" y="${T+10}">Now</text>
    <circle id="dot${el.id}" cx="${X(s.now)}" cy="${nowV!=null?Y(nowV):0}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    <rect id="hit${el.id}" x="${L}" y="${T}" width="${w-L-R}" height="${h-T-B}" fill="transparent" style="touch-action:pan-y"/></svg>`;
  const show=i=>{
    const t=new Date(s.time[i].slice(0,10)+'T'+s.time[i].slice(11,16)+':00Z');
    const lab=t.toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'})+' '+s.time[i].slice(11,16);
    const dot=$('#dot'+el.id);
    if(v[i]!=null){dot.setAttribute('cx',X(i));dot.setAttribute('cy',Y(v[i]))}
    readout.textContent=`${lab}${i===s.now?' (now)':i>s.now?' (forecast)':''} · ${fmt(v[i],1)} µg/m³`;
  };
  show(s.now);
  const hit=$('#hit'+el.id);
  const move=e=>{const r=hit.getBoundingClientRect();const i=Math.round((e.clientX-r.left)/r.width*(n-1));show(Math.max(0,Math.min(n-1,i)))};
  hit.addEventListener('pointermove',move);hit.addEventListener('pointerleave',()=>show(s.now));
}
const ro=new ResizeObserver(()=>{['#sgChart','#asChart'].forEach(id=>{const el=$(id),c=charts.get(el);if(c&&el.clientWidth&&Math.abs((el.firstChild&&el.firstChild.getAttribute?+el.firstChild.getAttribute('width'):0)-el.clientWidth)>1)drawTrend(el,c.s,c.readout,c.threshold)})});

/* ---------- shell ---------- */
function setStatus(){
  const sgL=state.sg&&!state.sg.sample&&state.sg.neaOk,as=state.asean&&!state.asean.sample;
  const sample=(state.sg&&state.sg.sample)||(state.asean&&state.asean.sample);
  const st=$('#status');st.className='pill '+(sample?'sample':'live');
  $('#statusText').textContent=sample?'Sample data':(sgL&&as?'Live':'Partly live');
  const ts=state.tab==='sg'&&state.sg?state.sg.ts:(state.asean?state.asean.ts:null);
  $('#updated').textContent=ts?'Updated '+sgTime(ts):'';
  $('#notice').innerHTML=sample?`<div class="notice"><b>Sample values.</b> This view could not reach data.gov.sg or Open-Meteo, so the numbers below are placeholders for the layout and are not real readings. Open this page directly in a browser with internet access to see live data, then press Refresh.</div>`:
    (state.sg&&!state.sg.neaOk&&!state.sg.sample?`<div class="notice"><b>NEA readings unavailable.</b> Haze values for Singapore load only from data.gov.sg, so they show as blank until that feed responds. Press Refresh to retry.</div>`:'');
}
async function refresh(){
  const b=$('#refresh');b.disabled=true;b.textContent='Refreshing';
  $('#statusText').textContent='Loading';
  const [sg,as]=await Promise.all([loadSG(),loadAsean()]);
  state.sg=sg;state.asean=as;applyNEAtoSingapore();
  setStatus();renderSG();renderAsean();
  b.disabled=false;b.textContent='Refresh';
}
function setTab(t){
  state.tab=t;
  $('#tab-sg').setAttribute('aria-selected',t==='sg');$('#tab-asean').setAttribute('aria-selected',t==='asean');
  $('#sg').hidden=t!=='sg';$('#asean').hidden=t!=='asean';
  $('#asean').style.display=t==='asean'?'flex':'none';$('#sg').style.display=t==='sg'?'flex':'none';
  setStatus();
  if(t==='sg')renderSG();else renderAsean();
}
buildMap();
$('#tab-sg').onclick=()=>setTab('sg');$('#tab-asean').onclick=()=>setTab('asean');
$('#refresh').onclick=refresh;$('#sort').onchange=renderAsean;
$('#asean').style.display='none';
ro.observe($('#sgChart'));ro.observe($('#asChart'));
refresh();setInterval(refresh,10*60*1000);
})();
