<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YieldGPS — Your Crypto Yield Navigator</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0e17;color:#e2e8f0;min-height:100vh}
a{color:#60a5fa;text-decoration:none}
.header{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:linear-gradient(135deg,#0f172a,#1e293b);border-bottom:1px solid #1e293b;flex-wrap:wrap;gap:12px}
.header h1{font-size:24px;font-weight:800;background:linear-gradient(90deg,#f59e0b,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.tagline{color:#64748b;font-size:13px;margin-left:12px}
.header-right{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.header-right label{font-size:11px;color:#64748b;display:block;margin-bottom:2px}
.header-right input,.header-right select{background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:13px;width:140px}
.stats-bar{display:flex;gap:12px;padding:16px 24px;overflow-x:auto}
.stat-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px 18px;min-width:150px;flex:1}
.stat-card.highlight{border-color:#f59e0b;background:linear-gradient(135deg,#1e293b,#1a1a2e)}
.stat-label{font-size:11px;color:#64748b;display:block}
.stat-value{font-size:22px;font-weight:700;color:#f1f5f9;display:block;margin-top:2px}
.stat-sub{font-size:10px;color:#94a3b8}
.tabs{display:flex;gap:4px;padding:8px 24px;background:#0f172a;border-bottom:1px solid #1e293b;overflow-x:auto}
.tab{padding:10px 20px;border:none;background:transparent;color:#94a3b8;cursor:pointer;border-radius:8px;font-size:14px;font-weight:500;white-space:nowrap;transition:all .2s;font-family:inherit}
.tab:hover{background:#1e293b;color:#e2e8f0}
.tab.active{background:#1e293b;color:#f59e0b}
.filters{display:flex;gap:12px;padding:12px 24px;background:#0f172a;flex-wrap:wrap;align-items:end;border-bottom:1px solid #1e293b}
.filter-group{display:flex;flex-direction:column;gap:3px}
.filter-group label{font-size:11px;color:#64748b}
.filter-group select{background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:12px}
.tab-content{display:none;padding:16px 24px}
.tab-content.active{display:block}
.table-container{overflow-x:auto;border-radius:12px;border:1px solid #1e293b}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{background:#1e293b;padding:10px 12px;text-align:left;font-weight:600;color:#94a3b8;font-size:11px;text-transform:uppercase;position:sticky;top:0;white-space:nowrap}
tbody tr{border-bottom:1px solid #1e293b;cursor:pointer;transition:background .15s}
tbody tr:hover{background:#1e293b44}
td{padding:10px 12px;vertical-align:middle}
.rank-col{width:36px;text-align:center;color:#64748b}
.loading{text-align:center;padding:40px;color:#64748b}
.pool-name{font-weight:600;color:#f1f5f9}
.pool-project{font-size:11px;color:#64748b}
.chain-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.apy-value{font-weight:700;font-size:15px}
.apy-green{color:#10b981}.apy-yellow{color:#f59e0b}.apy-red{color:#ef4444}
.net-apy{font-weight:600}
.risk-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600}
.risk-low{background:#10b98122;color:#10b981}
.risk-med{background:#f59e0b22;color:#f59e0b}
.risk-high{background:#f9731622;color:#f97316}
.risk-vhigh{background:#ef444422;color:#ef4444}
.yield-tag{display:inline-block;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:600;margin:1px 2px}
.tag-organic{background:#10b98122;color:#10b981}
.tag-reward{background:#8b5cf622;color:#8b5cf6}
.tag-basis{background:#3b82f622;color:#3b82f6}
.tag-rwa{background:#06b6d422;color:#06b6d4}
.tag-lending{background:#6366f122;color:#6366f1}
.sustainability-bar{width:60px;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;display:inline-block;vertical-align:middle}
.sustainability-fill{height:100%;border-radius:4px}
.trend-up{color:#10b981;font-weight:600}.trend-down{color:#ef4444;font-weight:600}.trend-flat{color:#64748b}
.compare-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:20px}
.compare-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px}
.compare-card h3{font-size:16px;margin-bottom:12px}
.compare-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #33415544;font-size:13px}
.compare-row:last-child{border:none}
.compare-label{color:#94a3b8}.compare-value{font-weight:600}.compare-winner{color:#10b981}
.sim-controls{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap;align-items:end}
.sim-input{display:flex;flex-direction:column;gap:4px}
.sim-input label{font-size:12px;color:#64748b}
.sim-input input,.sim-input select{background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-size:14px}
#simRun{background:linear-gradient(135deg,#f59e0b,#10b981);color:#0a0e17;border:none;padding:10px 24px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;font-family:inherit}
.sim-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.sim-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px}
.sim-card h4{font-size:14px;margin-bottom:4px}
.sim-card .sim-apy{font-size:24px;font-weight:800;margin:8px 0}
.sim-card .sim-detail{font-size:12px;color:#94a3b8;line-height:1.8}
.sim-card .sim-earning{font-size:18px;font-weight:700;color:#10b981}
.risk-map{background:#1e293b;border-radius:12px;padding:20px;min-height:400px;position:relative;margin:20px 0;overflow:hidden}
.risk-dot{position:absolute;width:14px;height:14px;border-radius:50%;cursor:pointer;transition:transform .2s;border:2px solid rgba(255,255,255,0.3)}
.risk-dot:hover{transform:scale(1.8);z-index:10}
.risk-dot .tooltip{display:none;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:#0f172a;border:1px solid #334155;padding:8px 12px;border-radius:8px;white-space:nowrap;font-size:11px;z-index:100}
.risk-dot:hover .tooltip{display:block}
.risk-legend{display:flex;gap:20px;justify-content:center;margin-top:12px}
.legend-item{display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8}
.dot{width:10px;height:10px;border-radius:50%}
.dot.green{background:#10b981}.dot.yellow{background:#f59e0b}.dot.orange{background:#f97316}.dot.red{background:#ef4444}
.modal-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:1000;justify-content:center;align-items:center;padding:20px}
.modal-overlay.open{display:flex}
.modal{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;max-width:680px;width:100%;max-height:85vh;overflow-y:auto;position:relative}
.modal-close{position:absolute;top:12px;right:12px;background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer}
.modal h2{font-size:20px;margin-bottom:16px}
.modal-section{margin:16px 0;padding:16px;background:#0f172a;border-radius:10px}
.modal-section h3{font-size:14px;color:#f59e0b;margin-bottom:10px}
.modal-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}
.modal-bar{height:12px;background:#334155;border-radius:6px;margin-top:6px;overflow:hidden}
.modal-bar-fill{height:100%;border-radius:6px}
.compare-desc,.sim-desc{color:#94a3b8;font-size:14px}
footer{padding:24px;text-align:center;color:#475569;font-size:12px;border-top:1px solid #1e293b;margin-top:40px}
footer a{color:#f59e0b}
@media(max-width:768px){.header{flex-direction:column}.stats-bar{flex-wrap:wrap}.filters{flex-direction:column}}
</style>
</head>
<body>
<div id="app">
  <header class="header">
    <div class="header-left">
      <h1>🧭 YieldGPS</h1>
      <span class="tagline">Your Crypto Yield Navigator</span>
    </div>
    <div class="header-right">
      <div><label>💰 Investment ($)</label><input type="number" id="investAmount" value="10000" min="100" step="100"></div>
      <div><label>⛽ Gas Chain</label>
        <select id="gasChain">
          <option value="ethereum">Ethereum (~$5)</option>
          <option value="arbitrum">Arbitrum (~$0.10)</option>
          <option value="base">Base (~$0.05)</option>
          <option value="polygon">Polygon (~$0.01)</option>
          <option value="bsc">BSC (~$0.10)</option>
        </select>
      </div>
    </div>
  </header>
  <div class="stats-bar">
    <div class="stat-card"><span class="stat-label">Pools Tracked</span><span class="stat-value" id="totalPools">-</span></div>
    <div class="stat-card"><span class="stat-label">Stablecoin Pools</span><span class="stat-value" id="stablePools">-</span></div>
    <div class="stat-card"><span class="stat-label">Total TVL</span><span class="stat-value" id="totalTvl">-</span></div>
    <div class="stat-card"><span class="stat-label">Median Stable APY</span><span class="stat-value" id="medianApy">-</span></div>
    <div class="stat-card highlight"><span class="stat-label">TradFi Benchmark</span><span class="stat-value">4.25%</span><span class="stat-sub">US T-Bill Rate</span></div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="yields">📊 Yield Rankings</button>
    <button class="tab" data-tab="compare">⚔️ CeFi vs DeFi</button>
    <button class="tab" data-tab="simulator">🧮 Strategy Simulator</button>
    <button class="tab" data-tab="risk">🛡️ Risk Map</button>
  </div>
  <div class="filters" id="filtersBar">
    <div class="filter-group"><label>Category</label><select id="filterCategory"><option value="all">All</option><option value="stablecoin" selected>Stablecoins</option><option value="eth">ETH / LST</option><option value="btc">BTC</option></select></div>
    <div class="filter-group"><label>Min TVL</label><select id="filterTvl"><option value="0">No minimum</option><option value="1000000">$1M+</option><option value="10000000" selected>$10M+</option><option value="100000000">$100M+</option><option value="1000000000">$1B+</option></select></div>
    <div class="filter-group"><label>Chain</label><select id="filterChain"><option value="all">All Chains</option></select></div>
    <div class="filter-group"><label>Yield Source</label><select id="filterYieldSource"><option value="all">All Sources</option><option value="organic">🌱 Organic Only</option><option value="incentivized">🎁 With Rewards</option></select></div>
    <div class="filter-group"><label>Sort By</label><select id="filterSort"><option value="netApy">Net APY ↓</option><option value="apy">Raw APY ↓</option><option value="tvl">TVL ↓</option><option value="risk">Risk Score ↓</option><option value="sustainability">Sustainability ↓</option></select></div>
  </div>
  <div class="tab-content active" id="tab-yields"><div class="table-container"><table id="yieldsTable"><thead><tr><th class="rank-col">#</th><th>Pool / Protocol</th><th>Chain</th><th>TVL</th><th>APY</th><th>Net APY<br><small>(after gas)</small></th><th>Risk Score</th><th>Yield Source</th><th>Sustainability</th><th>30d Trend</th><th>Est. Annual<br>Earnings</th></tr></thead><tbody id="yieldsBody"><tr><td colspan="11" class="loading">⏳ Loading data from DeFiLlama API...</td></tr></tbody></table></div></div>
  <div class="tab-content" id="tab-compare"><h2>⚔️ CeFi vs DeFi: Stablecoin Yield Comparison</h2><p class="compare-desc">Same asset, different venues. Factor in platform risk, gas costs, and withdrawal flexibility.</p><div class="compare-grid" id="compareGrid"></div></div>
  <div class="tab-content" id="tab-simulator"><h2>🧮 Strategy Simulator</h2><p class="sim-desc">Compare how different strategies would perform over time with your capital.</p><div class="sim-controls"><div class="sim-input"><label>Starting Capital ($)</label><input type="number" id="simCapital" value="10000"></div><div class="sim-input"><label>Time Horizon</label><select id="simTime"><option value="30">1 Month</option><option value="90">3 Months</option><option value="180">6 Months</option><option value="365" selected>1 Year</option></select></div><button id="simRun" onclick="runSimulation()">▶ Run Simulation</button></div><div class="sim-results" id="simResults"></div></div>
  <div class="tab-content" id="tab-risk"><h2>🛡️ Risk-Return Map</h2><p>Visualize the risk/return tradeoff across all yield opportunities. Dot size = TVL.</p><div class="risk-map" id="riskMap"></div><div class="risk-legend"><span class="legend-item"><span class="dot green"></span> Low Risk (8+)</span><span class="legend-item"><span class="dot yellow"></span> Medium (6-8)</span><span class="legend-item"><span class="dot orange"></span> High (4-6)</span><span class="legend-item"><span class="dot red"></span> Very High (&lt;4)</span></div></div>
  <div class="modal-overlay" id="modalOverlay" onclick="closeModal()"><div class="modal" onclick="event.stopPropagation()"><button class="modal-close" onclick="closeModal()">✕</button><div id="modalContent"></div></div></div>
  <footer><p>YieldGPS — Data from <a href="https://defillama.com" target="_blank">DeFiLlama API</a> | Risk scores are algorithmic estimates, not financial advice</p></footer>
</div>

<script>
let allPools=[],filteredPools=[];
const GAS_COSTS={ethereum:5,arbitrum:.1,base:.05,polygon:.01,solana:.003,bsc:.1,avalanche:.15,optimism:.08};
const CHAIN_COLORS={Ethereum:'#627eea',Arbitrum:'#28a0f0',Base:'#0052ff',Polygon:'#8247e5',Solana:'#9945ff',BSC:'#f0b90b',Avalanche:'#e84142',Optimism:'#ff0420'};
const BLUE_CHIPS=['aave-v3','aave-v2','compound-v3','compound-v2','sky-lending','maker','lido','rocket-pool','curve-dex','uniswap-v3','convex-finance'];
const ESTABLISHED=['ethena-usde','maple','morpho-blue','euler-v2','venus','benqi-lending','radiant-v2','spark','fluid-lending'];

function classifyYieldSource(p){
  const tags=[],pr=p.project.toLowerCase();
  if(p.apyBase>0){
    if(/aave|compound|morpho|euler|venus|spark|fluid|maple|benqi/.test(pr)) tags.push({label:'Lending Interest',cls:'tag-lending',organic:true});
    else if(/curve|uniswap|pancake|aerodrome|velodrome|camelot/.test(pr)) tags.push({label:'Trading Fees',cls:'tag-organic',organic:true});
    else if(/lido|rocket|coinbase|frax-ether|mantle|binance-staked/.test(pr)) tags.push({label:'Staking Rewards',cls:'tag-organic',organic:true});
    else if(/ethena/.test(pr)) tags.push({label:'Basis Trading',cls:'tag-basis',organic:true});
    else if(/sky|maker/.test(pr)) tags.push({label:'RWA + Lending',cls:'tag-rwa',organic:true});
    else if(/ondo|mountain|backed|hashnote/.test(pr)) tags.push({label:'Treasury Yield',cls:'tag-rwa',organic:true});
    else tags.push({label:'Base Yield',cls:'tag-organic',organic:true});
  }
  if(p.apyReward>0) tags.push({label:'Token Rewards',cls:'tag-reward',organic:false});
  if(!tags.length) tags.push({label:'Native Yield',cls:'tag-organic',organic:true});
  return tags;
}

function calcRisk(p){
  let s=5;
  if(BLUE_CHIPS.includes(p.project))s+=2.5;else if(ESTABLISHED.includes(p.project))s+=1.5;else if(p.count>500)s+=.5;
  if(p.tvlUsd>1e9)s+=1.5;else if(p.tvlUsd>1e8)s+=1;else if(p.tvlUsd>1e7)s+=.5;else if(p.tvlUsd<1e6)s-=1;
  if(p.sigma!=null){if(p.sigma<.1)s+=.5;else if(p.sigma>1)s-=1;else if(p.sigma>.5)s-=.5;}
  if(p.stablecoin)s+=.5;
  if(p.ilRisk==='yes')s-=1;
  if(p.exposure==='single')s+=.3;
  if(p.apy>50)s-=2;else if(p.apy>20)s-=1;else if(p.apy>10)s-=.3;
  if(['Ethereum','Arbitrum','Base','Polygon','BSC'].includes(p.chain))s+=.3;
  return Math.max(1,Math.min(10,Math.round(s*10)/10));
}

function calcSustain(p){
  let s=50;const src=classifyYieldSource(p);
  s+=src.filter(x=>x.organic).length/src.length*30;
  if(p.apyReward&&p.apyBase){s-=p.apyReward/(p.apyBase+p.apyReward)*40;}
  if(p.apyMean30d&&p.apy){s+=(1-Math.abs(p.apy-p.apyMean30d)/Math.max(p.apy,1))*15;}
  if(p.predictions&&p.predictions.predictedClass==='Stable/Up')s+=5;
  return Math.max(0,Math.min(100,Math.round(s)));
}

function calcNetApy(p){
  const inv=parseFloat(document.getElementById('investAmount').value)||10000;
  const gas=(GAS_COSTS[document.getElementById('gasChain').value]||5)*2;
  return Math.round((inv*(p.apy/100)-gas)/inv*10000)/100;
}

function fmtTvl(n){return n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(1)+'M':n>=1e3?'$'+(n/1e3).toFixed(0)+'K':'$'+n.toFixed(0);}
function fmtApy(n){return n!=null?n.toFixed(2)+'%':'-';}
function apyC(n){return n>=5?'apy-green':n>=2?'apy-yellow':'apy-red';}
function riskB(s){return s>=8?`<span class="risk-badge risk-low">🟢 ${s}</span>`:s>=6?`<span class="risk-badge risk-med">🟡 ${s}</span>`:s>=4?`<span class="risk-badge risk-high">🟠 ${s}</span>`:`<span class="risk-badge risk-vhigh">🔴 ${s}</span>`;}
function sustBar(s){const c=s>=70?'#10b981':s>=40?'#f59e0b':'#ef4444';return `<div style="display:flex;align-items:center;gap:6px"><div class="sustainability-bar"><div class="sustainability-fill" style="width:${s}%;background:${c}"></div></div><span style="font-size:11px;color:${c}">${s}%</span></div>`;}
function trend(d){return !d&&d!==0?'<span class="trend-flat">-</span>':d>.1?`<span class="trend-up">↑+${d.toFixed(2)}%</span>`:d<-.1?`<span class="trend-down">↓${d.toFixed(2)}%</span>`:`<span class="trend-flat">→${d.toFixed(2)}%</span>`;}
function chainB(c){const cl=CHAIN_COLORS[c]||'#64748b';return `<span class="chain-badge" style="background:${cl}22;color:${cl}">${c}</span>`;}

async function fetchData(){
  try{
    const r=await fetch('https://yields.llama.fi/pools');const j=await r.json();
    allPools=j.data.map(p=>({...p,riskScore:calcRisk(p),sustainability:calcSustain(p),yieldSources:classifyYieldSource(p)}));
    const chains=[...new Set(allPools.map(p=>p.chain))].sort();
    const sel=document.getElementById('filterChain');
    chains.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o);});
    applyFilters();updateStats();buildCompare();buildRiskMap();runSimulation();
  }catch(e){document.getElementById('yieldsBody').innerHTML=`<tr><td colspan="11" class="loading">❌ Failed: ${e.message}</td></tr>`;}
}

function applyFilters(){
  const cat=document.getElementById('filterCategory').value,minTvl=+document.getElementById('filterTvl').value,chain=document.getElementById('filterChain').value,ys=document.getElementById('filterYieldSource').value,sort=document.getElementById('filterSort').value;
  filteredPools=allPools.filter(p=>{
    if(p.tvlUsd<minTvl||p.apy==null||p.apy<=0)return false;
    if(chain!=='all'&&p.chain!==chain)return false;
    if(cat==='stablecoin'&&!p.stablecoin)return false;
    if(cat==='eth'&&!/ETH|STETH|WSTETH|RETH|CBETH|WBETH|WEETH|EETH|METH|RSETH/i.test(p.symbol))return false;
    if(cat==='btc'&&!/BTC|WBTC|TBTC|CBBTC/i.test(p.symbol))return false;
    if(ys==='organic'&&p.apyReward>0)return false;
    if(ys==='incentivized'&&(!p.apyReward||p.apyReward<=0))return false;
    return true;
  });
  filteredPools.forEach(p=>{p._netApy=calcNetApy(p);});
  const sf={netApy:(a,b)=>b._netApy-a._netApy,apy:(a,b)=>b.apy-a.apy,tvl:(a,b)=>b.tvlUsd-a.tvlUsd,risk:(a,b)=>b.riskScore-a.riskScore,sustainability:(a,b)=>b.sustainability-a.sustainability};
  filteredPools.sort(sf[sort]||sf.netApy);
  renderTable(filteredPools.slice(0,100));
}

function renderTable(pools){
  const inv=parseFloat(document.getElementById('investAmount').value)||10000,tb=document.getElementById('yieldsBody');
  if(!pools.length){tb.innerHTML='<tr><td colspan="11" class="loading">No pools match filters.</td></tr>';return;}
  tb.innerHTML=pools.map((p,i)=>{
    const n=p._netApy,earn=(inv*n/100).toFixed(0),src=p.yieldSources.map(s=>`<span class="yield-tag ${s.cls}">${s.label}</span>`).join('');
    return `<tr onclick="showDetail(${allPools.indexOf(p)})"><td class="rank-col">${i+1}</td><td><div class="pool-name">${p.symbol}</div><div class="pool-project">${p.project}${p.poolMeta?' · '+p.poolMeta:''}</div></td><td>${chainB(p.chain)}</td><td>${fmtTvl(p.tvlUsd)}</td><td><span class="apy-value ${apyC(p.apy)}">${fmtApy(p.apy)}</span></td><td><span class="net-apy ${apyC(n)}">${fmtApy(n)}</span></td><td>${riskB(p.riskScore)}</td><td>${src}</td><td>${sustBar(p.sustainability)}</td><td>${trend(p.apyPct30D)}</td><td style="color:#10b981;font-weight:600">$${earn}</td></tr>`;
  }).join('');
}

function updateStats(){
  document.getElementById('totalPools').textContent=allPools.length.toLocaleString();
  document.getElementById('stablePools').textContent=allPools.filter(p=>p.stablecoin).length.toLocaleString();
  document.getElementById('totalTvl').textContent=fmtTvl(allPools.reduce((s,p)=>s+p.tvlUsd,0));
  const sa=allPools.filter(p=>p.stablecoin&&p.apy>0).map(p=>p.apy).sort((a,b)=>a-b);
  document.getElementById('medianApy').textContent=(sa[Math.floor(sa.length/2)]||0).toFixed(2)+'%';
}

function buildCompare(){
  const cefi=[{name:'Binance Flexible USDT',apy:1.8},{name:'Binance Locked 90d',apy:3.2},{name:'OKX Simple Earn USDC',apy:2.1},{name:'Bybit Savings USDT',apy:2.5},{name:'Coinbase USDC Rewards',apy:4.0}];
  const defi=allPools.filter(p=>p.stablecoin&&p.tvlUsd>1e8&&p.apy>0).sort((a,b)=>b.tvlUsd-a.tvlUsd).slice(0,5).map(p=>({name:`${p.project} (${p.symbol})`,apy:p.apy}));
  const g=document.getElementById('compareGrid');
  g.innerHTML=`<div class="compare-card" style="border-color:#f59e0b"><h3>🏦 CeFi (Exchanges)</h3>${cefi.map(c=>`<div class="compare-row"><span class="compare-label">${c.name}</span><span class="compare-value">${c.apy.toFixed(2)}%</span></div>`).join('')}<div style="margin-top:12px;padding:10px;background:#0f172a;border-radius:8px;font-size:12px;color:#94a3b8"><b style="color:#f59e0b">Pros:</b> No gas, easy, insured (some)<br><b style="color:#ef4444">Cons:</b> Counterparty risk, lower rates, KYC</div></div>
  <div class="compare-card" style="border-color:#10b981"><h3>🔗 DeFi (Protocols)</h3>${defi.map(c=>`<div class="compare-row"><span class="compare-label">${c.name}</span><span class="compare-value ${c.apy>4?'compare-winner':''}">${c.apy.toFixed(2)}%</span></div>`).join('')}<div style="margin-top:12px;padding:10px;background:#0f172a;border-radius:8px;font-size:12px;color:#94a3b8"><b style="color:#10b981">Pros:</b> Self-custody, transparent, composable, higher rates<br><b style="color:#ef4444">Cons:</b> Smart contract risk, gas costs, complexity</div></div>
  <div class="compare-card" style="grid-column:1/-1;border-color:#3b82f6"><h3>🏛️ TradFi Benchmark</h3><div class="compare-row"><span class="compare-label">US T-Bill (3m)</span><span class="compare-value">4.25%</span></div><div class="compare-row"><span class="compare-label">US T-Bond (10y)</span><span class="compare-value">4.50%</span></div><div class="compare-row"><span class="compare-label">High-Yield Savings</span><span class="compare-value">4.50%</span></div><div style="margin-top:12px;padding:10px;background:#0f172a;border-radius:8px;font-size:12px;color:#94a3b8">DeFi yields above this benchmark represent genuine alpha. RWA tokens like sUSDS bring T-Bill yields onchain.</div></div>`;
}

function buildRiskMap(){
  const map=document.getElementById('riskMap');
  const pools=filteredPools.filter(p=>p.apy>0&&p.apy<30).slice(0,80);
  const maxApy=Math.max(...pools.map(p=>p.apy),15);
  map.innerHTML='<div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#64748b;font-size:11px">Risk Score → (higher = safer)</div><div style="position:absolute;left:8px;top:50%;transform:rotate(-90deg) translateX(-50%);color:#64748b;font-size:11px;transform-origin:left">APY ↑</div>';
  pools.forEach(p=>{
    const x=((p.riskScore-1)/9)*85+5,y=90-(p.apy/maxApy)*80,sz=Math.max(8,Math.min(20,Math.log10(p.tvlUsd/1e6)*6));
    const c=p.riskScore>=8?'#10b981':p.riskScore>=6?'#f59e0b':p.riskScore>=4?'#f97316':'#ef4444';
    map.innerHTML+=`<div class="risk-dot" style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;background:${c}"><div class="tooltip">${p.symbol} (${p.project})<br>APY: ${p.apy.toFixed(2)}% | Risk: ${p.riskScore} | TVL: ${fmtTvl(p.tvlUsd)}</div></div>`;
  });
}

function runSimulation(){
  const cap=parseFloat(document.getElementById('simCapital').value)||10000,days=+document.getElementById('simTime').value||365;
  const findApy=(proj,sym)=>{const p=allPools.find(x=>x.project===proj&&x.symbol.includes(sym));return p?p.apy:null;};
  const strats=[
    {name:'🏦 Exchange Savings',apy:2.5,gas:0,rs:7,desc:'Binance/OKX flexible savings. Zero gas, exchange custody risk.'},
    {name:'🔵 Aave V3 USDC',apy:findApy('aave-v3','USDC')||2.3,gas:10,rs:8.5,desc:'Supply USDC to Aave V3. Earn from borrower interest.'},
    {name:'🟣 sUSDS (Sky/Maker)',apy:findApy('sky-lending','SUSDS')||4,gas:10,rs:9,desc:'Sky Savings Rate. Backed by RWA + lending revenue.'},
    {name:'🟢 sUSDe (Ethena)',apy:findApy