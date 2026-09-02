'use strict';

const state = { data:null, snapshot:null, manifest:null, view:'overview', sort:{key:'ticker',dir:1}, query:'', status:'ALL', industry:'ALL' };
const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>Array.from(root.querySelectorAll(s));
const nf = new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2});

async function loadJSON(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function num(v,d=1){return Number.isFinite(Number(v))?Number(v).toFixed(d):'—';}
function pct(v){return Number.isFinite(Number(v))?`${Number(v).toFixed(1)}%`:'—';}
function factorValue(r,k){return Number(r?.factors?.[k]?.value);}
function modelStatus(r){return r?.quality?.model_status || (r?.quality?.model_not_due?'NOT_DUE':r?.quality?.model_ready?'READY':'UNRESOLVED');}
function industry(r){return r?.taxonomy?.subindustry || r?.taxonomy?.industry || '未分類';}
function statusPill(s){ const cls=s==='READY'?'ok':s==='NOT_DUE'?'amber':'red'; return `<span class="status-pill ${cls}">${esc(s)}</span>`; }

function switchView(id){ state.view=id; $$('.view').forEach(v=>v.classList.toggle('active',v.id===id)); $$('.nav-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===id)); window.scrollTo({top:0,behavior:'instant'}); }

function renderHeader(){
 const s=state.snapshot; const runAt=s.model_run_at?new Date(s.model_run_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—'; $('#marketKey').textContent=s.market_key; $('#marketMeta').textContent=`Snapshot R${s.snapshot_revision} · 模型執行 ${runAt} · Policy ${s.model_policy.split('.').pop()}`;
 $('#resolvedCount').textContent=s.model_resolved; $('#readyCount').textContent=s.model_ready; $('#notDueCount').textContent=s.model_not_due; $('#webComplete').textContent=s.web_complete; $('#blockerCount').textContent=state.data.blockers.length;
 $('#snapshotStrip').innerHTML=`<span class="dot ok"></span><span>Market Key ${esc(s.market_key)} · R${s.snapshot_revision} · READY</span>`;
}
function renderFreshness(){
 const g=$('#freshnessGrid'); g.innerHTML=state.manifest.sources.map(x=>`<div class="fresh-card"><div class="fresh-name">${esc(labelDataset(x.dataset))}</div><div class="fresh-meta">As-of ${esc(x.as_of)}<br>${esc(x.freshness_status)} · Coverage ${(x.coverage*100).toFixed(0)}%<br>${esc(x.cadence)}</div></div>`).join('');
}
function labelDataset(k){return ({formal_270_web:'正式網站資料',price_momentum:'價格 / Momentum',risk_90d:'Risk 90D',comparison_metrics:'相對估值資料',earnings_revision:'盈餘修正'})[k]||k;}
function avgFactor(r){const ks=['profitability','financial_strength','forward_growth','earnings_revision','valuation'];const vs=ks.map(k=>factorValue(r,k)).filter(Number.isFinite);return vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:NaN;}
function renderLeaders(){
 const arr=state.data.records.filter(r=>modelStatus(r)==='READY').map(r=>({...r,_avg:avgFactor(r)})).filter(r=>Number.isFinite(r._avg)).sort((a,b)=>b._avg-a._avg).slice(0,5);
 $('#leaderGrid').innerHTML=arr.map(r=>`<div class="leader-card" data-ticker="${esc(r.ticker)}"><div class="leader-top"><div><div class="ticker">${esc(r.ticker)}</div><div class="company">${esc(r.company)}</div></div>${statusPill(modelStatus(r))}</div><div class="leader-score">${r._avg.toFixed(1)}</div><div class="leader-label">五項財務因子平均</div></div>`).join('');
}
function renderIndustryBars(){
 const counts=new Map(); state.data.records.forEach(r=>counts.set(industry(r),(counts.get(industry(r))||0)+1)); const arr=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,12); const max=Math.max(...arr.map(x=>x[1]));
 $('#industryBars').innerHTML=arr.map(([k,v])=>`<div class="bar-row"><div class="bar-label" title="${esc(k)}">${esc(k)}</div><div class="bar-track"><div class="bar-fill" style="width:${(v/max*100).toFixed(1)}%"></div></div><div class="bar-count">${v}</div></div>`).join('');
}
function fillIndustryFilter(){const vals=[...new Set(state.data.records.map(industry))].sort((a,b)=>a.localeCompare(b,'zh-Hant')); $('#industryFilter').innerHTML='<option value="ALL">全部產業</option>'+vals.map(x=>`<option>${esc(x)}</option>`).join('');}
function sortValue(r,key){
 if(key==='ticker'||key==='company') return String(r[key]||''); if(key==='subindustry')return industry(r); if(key==='risk')return Number(r.risk?.risk_score); return factorValue(r,key);
}
function filteredRecords(){
 const q=state.query.trim().toLowerCase(); let arr=state.data.records.filter(r=>{
  const okQ=!q||[r.ticker,r.company,industry(r),r.taxonomy?.sector].some(x=>String(x||'').toLowerCase().includes(q));
  const okS=state.status==='ALL'||modelStatus(r)===state.status; const okI=state.industry==='ALL'||industry(r)===state.industry; return okQ&&okS&&okI;
 });
 const {key,dir}=state.sort; arr.sort((a,b)=>{const av=sortValue(a,key),bv=sortValue(b,key); if(typeof av==='string')return av.localeCompare(bv,'en')*dir; const aa=Number.isFinite(av)?av:-Infinity,bb=Number.isFinite(bv)?bv:-Infinity; return (aa-bb)*dir;}); return arr;
}
function renderStocks(){
 const arr=filteredRecords(); $('#stockRows').innerHTML=arr.map(r=>`<tr data-ticker="${esc(r.ticker)}"><td><strong>${esc(r.ticker)}</strong></td><td>${esc(r.company)}</td><td>${esc(industry(r))}</td><td class="num">${num(factorValue(r,'profitability'))}</td><td class="num">${num(factorValue(r,'financial_strength'))}</td><td class="num">${num(factorValue(r,'forward_growth'))}</td><td class="num">${num(factorValue(r,'earnings_revision'))}</td><td class="num">${num(factorValue(r,'valuation'))}</td><td class="num">${num(r.risk?.risk_score)}</td><td>${statusPill(modelStatus(r))}</td></tr>`).join(''); $('#tableFooter').textContent=`顯示 ${arr.length} / ${state.data.records.length} 檔`;
}
function renderIndustries(){
 const groups=new Map(); state.data.records.forEach(r=>{const k=industry(r); if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}); const arr=[...groups].map(([k,rs])=>({k,rs,avg:rs.map(avgFactor).filter(Number.isFinite)})).sort((a,b)=>b.rs.length-a.rs.length);
 $('#industryCards').innerHTML=arr.map(x=>`<div class="industry-card"><div class="eyebrow">${esc(x.k)}</div><div class="count">${x.rs.length}</div><div class="avg">READY ${x.rs.filter(r=>modelStatus(r)==='READY').length} · NOT_DUE ${x.rs.filter(r=>modelStatus(r)==='NOT_DUE').length}${x.avg.length?` · 因子平均 ${(x.avg.reduce((a,b)=>a+b,0)/x.avg.length).toFixed(1)}`:''}</div></div>`).join('');
}
function renderQuality(){
 const nd=state.data.records.filter(r=>modelStatus(r)==='NOT_DUE'); const risks=state.data.records.filter(r=>r.risk?.status==='READY');
 $('#qualityGrid').innerHTML=`<div class="quality-card"><div class="eyebrow">Resolved</div><div class="quality-value">${state.data.model_resolved}/270</div><div class="quality-label">UNRESOLVED ${state.data.model_unresolved}</div></div><div class="quality-card"><div class="eyebrow">NOT_DUE</div><div class="quality-value">${nd.length}</div><div class="quality-label">${nd.map(r=>r.ticker).join('、')}</div></div><div class="quality-card"><div class="eyebrow">Risk Ready</div><div class="quality-value">${risks.length}/270</div><div class="quality-label">Risk Score universe = FORMAL_270</div></div>`;
}
function openDrawer(ticker){const r=state.data.records.find(x=>x.ticker===ticker); if(!r)return; const factors=[['獲利能力','profitability'],['財務穩健','financial_strength'],['前瞻成長','forward_growth'],['盈餘修正','earnings_revision'],['相對估值','valuation']]; const vals=r.valuation?.used_metrics||[]; const m=r.momentum||{}; const risk=r.risk||{};
 $('#drawerContent').innerHTML=`<div class="eyebrow">${esc(industry(r))}</div><div class="drawer-title">${esc(r.ticker)}</div><div class="drawer-company">${esc(r.company)} · ${esc(r.taxonomy?.sector||'')}</div><div>${statusPill(modelStatus(r))}</div>
 <div class="drawer-section"><h3>五項財務因子</h3><div class="factor-list">${factors.map(([label,k])=>{const v=factorValue(r,k);return `<div class="factor-row"><span>${label}</span><div class="factor-track"><div class="factor-fill" style="width:${Math.max(0,Math.min(100,Number.isFinite(v)?v:0))}%"></div></div><span class="factor-value">${num(v)}</span></div>`}).join('')}</div></div>
 <div class="drawer-section"><h3>Momentum</h3>${modelStatus(r)==='NOT_DUE'?`<div class="not-due-note">${esc(m.reason||'NEW_LISTING_WAIT_FOR_6M_HISTORY')}<br>歷史 ${m.history_age_days??'—'} 天；不製造 Momentum 分數。</div>`:`<div class="metric-grid"><div class="metric-box"><div class="label">3M</div><div class="value">${pct(m.ret_3m)}</div></div><div class="metric-box"><div class="label">6M</div><div class="value">${pct(m.ret_6m)}</div></div><div class="metric-box"><div class="label">12M</div><div class="value">${pct(m.ret_12m)}</div></div><div class="metric-box"><div class="label">History</div><div class="value">${esc(m.history_status||'—')}</div></div></div>`}</div>
 <div class="drawer-section"><h3>Risk 90D <span class="status-pill neutral">REPORT ONLY</span></h3><div class="metric-grid"><div class="metric-box"><div class="label">Risk Score</div><div class="value">${num(risk.risk_score)}</div></div><div class="metric-box"><div class="label">Std Dev 90D</div><div class="value">${pct((risk.std_dev_90d||0)*100)}</div></div><div class="metric-box"><div class="label">Downside Dev 90D</div><div class="value">${pct((risk.downside_dev_90d||0)*100)}</div></div><div class="metric-box"><div class="label">Source</div><div class="value" style="font-size:12px">${esc(risk.source_series||'—')}</div></div></div></div>
 <div class="drawer-section"><h3>相對估值依據</h3><div class="valuation-list">${vals.length?vals.map(x=>`<div class="valuation-item"><span>${esc(x.metric)} <span class="muted">${Math.round((x.weight||0)*100)}%</span></span><strong>${num(x.value,2)}x</strong></div>`).join(''):'<div class="muted">沒有估值項目</div>'}</div>${r.valuation?.reason?`<div class="fresh-meta" style="margin-top:8px">${esc(r.valuation.reason)}</div>`:''}</div>`;
 $('#detailDrawer').classList.add('open'); $('#drawerBackdrop').classList.add('open'); $('#detailDrawer').setAttribute('aria-hidden','false');
}
function closeDrawer(){ $('#detailDrawer').classList.remove('open'); $('#drawerBackdrop').classList.remove('open'); $('#detailDrawer').setAttribute('aria-hidden','true'); }
function bind(){
 $$('.nav-tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view))); $$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));
 $('#stockSearch').addEventListener('input',e=>{state.query=e.target.value;renderStocks()}); $('#statusFilter').addEventListener('change',e=>{state.status=e.target.value;renderStocks()}); $('#industryFilter').addEventListener('change',e=>{state.industry=e.target.value;renderStocks()});
 $('.data-table thead').addEventListener('click',e=>{const th=e.target.closest('[data-sort]');if(!th)return;const k=th.dataset.sort;if(state.sort.key===k)state.sort.dir*=-1;else state.sort={key:k,dir:k==='ticker'||k==='company'||k==='subindustry'?1:-1};renderStocks()});
 document.addEventListener('click',e=>{const row=e.target.closest('[data-ticker]');if(row)openDrawer(row.dataset.ticker)}); $('#drawerClose').addEventListener('click',closeDrawer); $('#drawerBackdrop').addEventListener('click',closeDrawer); document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});
}
async function init(){try{[state.data,state.snapshot,state.manifest]=await Promise.all([loadJSON('data/formal-270-web.json'),loadJSON('data/snapshot_manifest.json'),loadJSON('data/source_manifest.json')]); if(!state.data.publish_ready||state.data.web_complete!==270||state.data.model_unresolved!==0)throw new Error('資料未通過正式 Web Gate'); renderHeader();renderFreshness();renderLeaders();renderIndustryBars();fillIndustryFilter();renderStocks();renderIndustries();renderQuality();bind();}catch(err){document.body.innerHTML=`<main class="page"><section class="panel"><h1>網站資料載入失敗</h1><p>${esc(err.message)}</p></section></main>`;console.error(err)}}
init();
