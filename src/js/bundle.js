/* サンドイッチ販売支援システム v3.0 - bundled */
(async function() {
'use strict';

/* ========== db.js ========== */
/** db.js - IndexedDB 操作モジュール */

const DB_NAME = 'SandwichSalesDB';
const DB_VERSION = 1;
const STORES = {
  PRODUCTS:  'ProductMaster',
  MFG:       'ManufactureRecord',
  LOSS:      'LossRecord',
  REPORT:    'DailyReport',
  DISCOUNT:  'DiscountAnalysisRecord',
};

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        const s = db.createObjectStore(STORES.PRODUCTS, { keyPath:'id', autoIncrement:true });
        s.createIndex('isActive','isActive',{unique:false});
        s.createIndex('sortOrder','sortOrder',{unique:false});
      }
      [STORES.MFG, STORES.LOSS, STORES.REPORT, STORES.DISCOUNT].forEach(name => {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath:'date' });
      });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

const tx = (store, mode, fn) =>
  openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  }));

const dbGet    = (store, key)  => tx(store,'readonly', s => s.get(key));
const dbGetAll = (store)       => tx(store,'readonly', s => s.getAll()).then(r => r ?? []);
const dbPut    = (store, data) => tx(store,'readwrite',s => s.put(data));
const dbDelete = (store, key)  => tx(store,'readwrite',s => s.delete(key));

async function getActiveProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  return all.filter(p => p.isActive).sort((a,b) => (a.sortOrder??9999)-(b.sortOrder??9999));
}
async function getAllProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  return all.sort((a,b) => (a.sortOrder??9999)-(b.sortOrder??9999));
}

async function exportAllData() {
  const out = {};
  for (const [k,v] of Object.entries(STORES)) out[k] = await dbGetAll(v);
  return out;
}
async function importAllData(data) {
  for (const [k,v] of Object.entries(STORES)) {
    if (!data[k]) continue;
    for (const rec of data[k]) await dbPut(v, rec);
  }
}

/* ========== predict.js ========== */
/**
 * predict.js - 完売予測・割引推奨・追加製造支援
 * 実測データ（160件 2024-07〜2025-06）から算出した曜日別理想在庫を内蔵
 */
/* ============================================================
   実測データから算出した曜日別・時刻別 理想在庫（平均値）
   金曜はサンプル2件のみのため近似値を使用
============================================================ */
const IDEAL = {
  '月': { '17:00':46,'17:10':45,'17:20':43,'17:30':41,'17:40':39,'17:50':37,'18:00':35,'18:10':33,'18:20':31,'18:30':28,'18:40':25,'18:50':21,'19:00':18,'19:10':15,'19:20':10,'19:30':7,'19:40':3,'19:50':1,'20:00':0 },
  '火': { '17:00':49,'17:10':46,'17:20':44,'17:30':42,'17:40':40,'17:50':38,'18:00':36,'18:10':34,'18:20':31,'18:30':28,'18:40':24,'18:50':18,'19:00':16,'19:10':12,'19:20':8,'19:30':6,'19:40':3,'19:50':1,'20:00':0 },
  '水': { '17:00':48,'17:10':46,'17:20':44,'17:30':43,'17:40':40,'17:50':37,'18:00':35,'18:10':33,'18:20':30,'18:30':27,'18:40':23,'18:50':20,'19:00':16,'19:10':11,'19:20':9,'19:30':6,'19:40':3,'19:50':0,'20:00':0 },
  '木': { '17:00':54,'17:10':51,'17:20':48,'17:30':45,'17:40':42,'17:50':40,'18:00':37,'18:10':34,'18:20':31,'18:30':27,'18:40':24,'18:50':20,'19:00':17,'19:10':13,'19:20':9,'19:30':6,'19:40':3,'19:50':1,'20:00':0 },
  '金': { '17:00':55,'17:10':52,'17:20':50,'17:30':47,'17:40':44,'17:50':41,'18:00':37,'18:10':34,'18:20':31,'18:30':27,'18:40':23,'18:50':19,'19:00':15,'19:10':11,'19:20':7,'19:30':3,'19:40':2,'19:50':0,'20:00':0 },
  '土': { '17:00':57,'17:10':54,'17:20':51,'17:30':49,'17:40':45,'17:50':42,'18:00':39,'18:10':35,'18:20':33,'18:30':30,'18:40':27,'18:50':23,'19:00':18,'19:10':14,'19:20':10,'19:30':7,'19:40':3,'19:50':1,'20:00':0 },
  '日': { '17:00':45,'17:10':41,'17:20':38,'17:30':35,'17:40':34,'17:50':33,'18:00':32,'18:10':30,'18:20':27,'18:30':25,'18:40':21,'18:50':18,'19:00':16,'19:10':12,'19:20':9,'19:30':6,'19:40':4,'19:50':1,'20:00':0 },
};

/** 割引時刻の統計（実測データより） */
const DISC_STATS = {
  '20%': { mode:'18:20', avg:'18:19' },
  '30%': { mode:'19:00', avg:'19:07' },
  '50%': { mode:'19:40', avg:'19:39' },
};

const DISC_STATS_PUBLIC = DISC_STATS;

function generateTimeSlots() {
  const s = [];
  for (let h=17;h<=20;h++) for(let m=0;m<60;m+=10) { if(h===20&&m>0)break; s.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`); }
  return s;
}

/** 理想在庫を返す（DBの蓄積データが3件以上あればそちらを優先） */
async function calcIdealStock(weekday) {
  const dbAvg = await getWeekdayAverageStock(weekday, []);
  const slots = generateTimeSlots();
  const hist  = IDEAL[weekday] || IDEAL['月'];
  const result = {};
  slots.forEach(t => { result[t] = (dbAvg[t] != null) ? dbAvg[t] : (hist[t] ?? 0); });
  return result;
}

async function getWeekdayAverageStock(weekday, excludeDates=[]) {
  const all  = await dbGetAll(STORES.DISCOUNT);
  const same = all.filter(r => r.weekday===weekday && !excludeDates.includes(r.date));
  const slots = generateTimeSlots();
  const result = {};
  slots.forEach(t => {
    const vals = same.map(r=>(r.inventoryLogs||[]).find(l=>l.time===t)?.stock).filter(v=>v!=null);
    result[t] = vals.length >= 3 ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
  });
  return result;
}

async function getYesterdayStock() {
  const d = new Date(); d.setDate(d.getDate()-1);
  const ystr = fmtDate(d);
  const all = await dbGetAll(STORES.DISCOUNT);
  const rec = all.find(r=>r.date===ystr);
  const slots = generateTimeSlots();
  const result = {};
  slots.forEach(t => { const l = rec?(rec.inventoryLogs||[]).find(l=>l.time===t):null; result[t]=l?l.stock:null; });
  return result;
}

function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function getIdeal17(weekday) { return IDEAL[weekday]?.['17:00'] ?? 48; }

/**
 * 完売予測 - 直近の減少ペースと理想在庫の両方を考慮した高精度モデル
 */
function predictSoldOut(inventoryLogs, idealStock={}) {
  if (!inventoryLogs || inventoryLogs.length < 2) return { probability:0, predictedTime:null };

  const sorted = [...inventoryLogs].sort((a,b)=>a.time.localeCompare(b.time));
  const last = sorted[sorted.length-1];

  // 直近4点で平均ペースを計算
  const span = sorted.slice(Math.max(0,sorted.length-4));
  const first = span[0];
  const minsDiff = toMin(last.time)-toMin(first.time);
  const stockDiff = first.stock-last.stock;

  if (minsDiff<=0 || stockDiff<=0) return { probability:15, predictedTime:null };

  const rate = stockDiff/minsDiff;
  const minsToZero = last.stock/rate;
  const predMin = toMin(last.time)+minsToZero;
  const closeMin = toMin('20:00');

  // 理想在庫との乖離も考慮して補正
  const idealNow = idealStock[last.time];
  let bonus = 0;
  if (idealNow!=null) {
    const diff = last.stock - idealNow;
    if (diff < -5) bonus = -10; // 在庫が理想より少ない→完売しやすい
    if (diff >  5) bonus =  10; // 在庫が理想より多い→完売しにくい
  }

  let prob;
  if (predMin<=closeMin) {
    const margin = closeMin-predMin;
    prob = Math.min(99, Math.round(65+margin/1.5) + bonus);
  } else {
    const over = predMin-closeMin;
    prob = Math.max(5, Math.round(55-over*1.5) + bonus);
  }

  return {
    probability: Math.max(0,Math.min(99,prob)),
    predictedTime: minsToTime(Math.round(predMin)),
  };
}

function getDiscountRecommendation(currentStock, idealStock, prediction) {
  const reasons = [];
  let rate = 0;
  if (idealStock!=null && currentStock>idealStock) {
    const over = Math.round(currentStock-idealStock);
    reasons.push(`現在在庫が理想在庫を${over}個上回っています`);
    if      (over>=15) rate=50;
    else if (over>=8)  rate=30;
    else if (over>=3)  rate=20;
  }
  if (prediction.predictedTime) reasons.push(`完売予測時刻：${prediction.predictedTime}`);
  if (prediction.probability<50 && rate===0) { rate=20; reasons.push('完売確率が低いため早めの割引を検討してください'); }
  return { show:rate>0, rate, reasons };
}

/**
 * 追加製造推奨 - 現在時刻の理想在庫との差分で計算
 * @param {number} currentStock 現在在庫
 * @param {string} weekday 曜日
 * @param {string} currentTime 現在時刻 HH:MM
 */
function getManufactureRecommendation(currentStock, weekday, currentTime='17:00') {
  const slots = generateTimeSlots();
  // 現在時刻に最も近いスロットの理想在庫
  const nearSlot = [...slots].filter(t=>t<=currentTime).pop() || '17:00';
  const idealNow = IDEAL[weekday]?.[nearSlot] ?? getIdeal17(weekday);
  const count = Math.max(0, Math.round(idealNow - currentStock));
  const prob  = count>0 ? Math.min(95,60+Math.round(count*0.8)) : 55;
  return { count, probability:prob, idealNow, nearSlot };
}

/**
 * 過去データからおすすめ商品を分析
 * @param {Array} mfgRecords 製造記録
 * @param {Array} lossRecords ロス記録
 * @param {Array} products 商品マスタ
 * @param {string} weekday 曜日
 */
function getProductRecommendations(mfgRecords, lossRecords, products, weekday) {
  // 同曜日のデータを優先
  const sameDayMfg  = mfgRecords.filter(r => r.weekday===weekday || !r.weekday);
  const sameDayLoss = lossRecords.filter(r => r.weekday===weekday || !r.weekday);

  const productMap = {};
  products.forEach(p => {
    productMap[p.id] = { name:p.name, price:p.price, cost:p.cost,
      totalMfg:0, totalLoss:0, totalDiscount:0, lossRate:0 };
  });

  sameDayMfg.forEach(r  => (r.items||[]).forEach(i  => { if(productMap[i.productId]) productMap[i.productId].totalMfg+=i.count; }));
  sameDayLoss.forEach(r => (r.items||[]).forEach(i  => {
    if(!productMap[i.productId]) return;
    productMap[i.productId].totalLoss     += i.lossCount||0;
    productMap[i.productId].totalDiscount += (i.discount20||0)+(i.discount30||0)+(i.discount50||0);
  }));

  // ロス率を算出
  Object.values(productMap).forEach(p => {
    if (p.totalMfg>0) p.lossRate = Math.round(p.totalLoss/p.totalMfg*100);
  });

  const list = Object.entries(productMap)
    .filter(([,p])=>p.totalMfg>0)
    .map(([id,p])=>({id,...p}));

  // 売れ筋（製造数多い順）
  const bestsellers = [...list].sort((a,b)=>b.totalMfg-a.totalMfg).slice(0,5);

  // ロスが少なく売れ筋（追加製造おすすめ）
  const goodBets = [...list]
    .filter(p=>p.lossRate<15 && p.totalMfg>3)
    .sort((a,b)=>b.totalMfg-a.totalMfg).slice(0,3);

  // ロス多め（注意）
  const risky = [...list]
    .filter(p=>p.lossRate>=20 && p.totalLoss>0)
    .sort((a,b)=>b.lossRate-a.lossRate).slice(0,3);

  return { bestsellers, goodBets, risky };
}

function toMin(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function minsToTime(m) { const h=Math.floor(m/60)%24; const mm=Math.round(m%60); return `${String(h).padStart(2,'0')}:${String(Math.max(0,mm)).padStart(2,'0')}`; }

/* ========== dashboard.js ========== */
/** dashboard.js - ダッシュボード */
async function initDashboard(container) {
  const today=todayStr(), wd=getWeekdayStr(today);
  const [products,discRec,mfgRecs,lossRecs,reportRec] = await Promise.all([
    getActiveProducts(),
    dbGet(STORES.DISCOUNT,today),
    dbGetAll(STORES.MFG),
    dbGetAll(STORES.LOSS),
    dbGet(STORES.REPORT,today),
  ]);

  const invLogs=discRec?.inventoryLogs||[];
  const idealStock=await calcIdealStock(wd);
  const prediction=predictSoldOut(invLogs,idealStock);

  let rec={show:false,rate:0,reasons:[]};
  if(invLogs.length>0){
    const slots=generateTimeSlots(), nowT=nowTimeStr();
    const nearSlot=[...slots].filter(t=>t<=nowT).pop()||slots[0];
    const latest=[...invLogs].sort((a,b)=>b.time.localeCompare(a.time))[0];
    rec=getDiscountRecommendation(latest.stock, idealStock[nearSlot], prediction);
  }

  const todayMfg =mfgRecs.find(r=>r.date===today);
  const todayLoss=lossRecs.find(r=>r.date===today);
  const salesRank=buildRank(products,mfgRecs,'mfg');
  const lossRank =buildRank(products,lossRecs,'loss');
  const [,m,d]=today.split('-');

  container.innerHTML=`<div class="page">
    <div style="text-align:center;margin-bottom:12px;color:var(--text-sub);font-size:14px;font-weight:600;">
      ${Number(m)}月${Number(d)}日（${wd}曜日）
    </div>

    <div class="predict-bar">
      <div class="predict-percent">${prediction.probability}%</div>
      <div class="predict-info">
        <div class="predict-title">完売確率</div>
        <div class="predict-time">${prediction.predictedTime?'予測完売時刻 '+prediction.predictedTime:'割引分析で在庫を入力してください'}</div>
      </div>
    </div>

    ${rec.show?`<div class="recommend-banner">
      <div class="recommend-title">🏷️ ${rec.rate}%割引を推奨</div>
      <ul class="recommend-reasons">${rec.reasons.map(r=>`<li>${escHtml(r)}</li>`).join('')}</ul>
    </div>`:''}

    <div class="section-title">今日のサマリー</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-icon">🏭</div><div class="stat-label">総製造数</div>
        <div class="stat-value">${todayMfg?todayMfg.totalCount:'－'}<span class="stat-unit">${todayMfg?'個':''}</span></div></div>
      <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">製造総額</div>
        <div class="stat-value" style="font-size:20px;">${todayMfg?(todayMfg.totalPrice||0).toLocaleString():'－'}<span class="stat-unit">${todayMfg?'円':''}</span></div></div>
      <div class="stat-card"><div class="stat-icon">📉</div><div class="stat-label">ロス金額</div>
        <div class="stat-value" style="font-size:20px;">${todayLoss?(todayLoss.totalLossPrice||0).toLocaleString():'－'}<span class="stat-unit">${todayLoss?'円':''}</span></div></div>
      <div class="stat-card"><div class="stat-icon">🏷️</div><div class="stat-label">割引金額</div>
        <div class="stat-value" style="font-size:20px;">${todayLoss?(todayLoss.totalDiscount||0).toLocaleString():'－'}<span class="stat-unit">${todayLoss?'円':''}</span></div></div>
      ${reportRec?`<div class="stat-card wide"><div class="stat-icon">📊</div><div class="stat-label">売上 / 客数 / 客単価</div>
        <div style="font-size:18px;font-weight:800;color:var(--primary);margin-top:4px;">
          ${reportRec.sales.toLocaleString()}円 ／ ${reportRec.customers}人 ／ ${(reportRec.unitPrice||0).toLocaleString()}円</div></div>`:''}
    </div>

    <div class="card"><div class="card-header"><span class="card-header-icon">🏆</span>売れ筋ランキング（累計）</div>
      <div class="card-body">${salesRank.length?`<ul class="rank-list">${salesRank.map((r,i)=>rankRow(r,i,false)).join('')}</ul>`:emptyRank()}</div></div>

    <div class="card"><div class="card-header"><span class="card-header-icon">📉</span>ロスランキング（累計）</div>
      <div class="card-body">${lossRank.length?`<ul class="rank-list">${lossRank.map((r,i)=>rankRow(r,i,true)).join('')}</ul>`:emptyRank()}</div></div>
  </div>`;
}

function buildRank(products,records,type){
  const tot={};
  records.forEach(r=>(r.items||[]).forEach(i=>{
    tot[i.productId]=(tot[i.productId]||0)+(type==='mfg'?i.count:i.lossPrice||0);
  }));
  return products.map(p=>({name:p.name,val:tot[p.id]||0})).filter(r=>r.val>0).sort((a,b)=>b.val-a.val).slice(0,5);
}
function rankRow(r,i,isCur){
  const cls=i===0?'r1':i===1?'r2':i===2?'r3':'';
  return `<li class="rank-item"><span class="rank-badge ${cls}">${i+1}</span><span class="rank-name">${escHtml(r.name)}</span><span class="rank-value">${isCur?r.val.toLocaleString()+'円':r.val+'個'}</span></li>`;
}
function emptyRank(){ return '<div style="padding:16px;text-align:center;color:var(--text-hint);font-size:14px;">データがありません</div>'; }

/* ========== manufacture.js ========== */
/**
 * manufacture.js - 製造計算
 * ±5/±1スピナー・右下固定保存ボタン・過去データ参照
 */
let _manufacture_products=[], counts={}, history=[];

async function initManufacture(container) {
  _manufacture_products = await getActiveProducts();
  const today = todayStr();
  const existing = await dbGet(STORES.MFG, today);
  counts={};
  _manufacture_products.forEach(p=>{ counts[p.id]=0; });
  if(existing) existing.items.forEach(i=>{ counts[i.productId]=i.count; });
  history=[];
  _manufacture_render(container);
}

function _manufacture_calcTotals() {
  let cnt=0,price=0;
  _manufacture_products.forEach(p=>{ const c=counts[p.id]||0; cnt+=c; price+=c*p.price; });
  return {cnt,price};
}

function _manufacture_render(container) {
  const {cnt,price}=_manufacture_calcTotals();
  const hasBig = history.length>0;

  container.innerHTML=`
    <div class="page">
      ${_manufacture_products.length===0?emptyState('🏭','製造計算','商品管理で商品を追加してください'):`
        <!-- 履歴ボタン -->
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="btn btn-ghost btn-sm" id="histBtn">📅 過去データ</button>
        </div>

        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl mfg-tbl" style="table-layout:fixed;">
              <colgroup>
                <col style="width:28%">
                <col style="width:58%">
                <col style="width:14%">
              </colgroup>
              <thead><tr><th>品名</th><th style="text-align:center;">製造個数</th><th style="text-align:right;padding-right:8px;">小計</th></tr></thead>
              <tbody>
                ${_manufacture_products.map(p=>mfgRow(p)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="summary-bar">
          <div class="summary-row"><span>総製造数</span><span class="summary-value" id="totalCnt">${cnt}個</span></div>
          <div class="summary-row total"><span>総額</span><span class="summary-value" id="totalPrice">${price.toLocaleString()}円</span></div>
        </div>

        <div class="btn-group mb-md">
          <button class="btn ${hasBig?'btn-outline':'btn-ghost'}" id="undoBtn" ${hasBig?'':'disabled'}>
            ↩ 元に戻す${hasBig?`（${history.length}）`:''}
          </button>
          <button class="btn btn-outline" id="clearBtn">クリア</button>
        </div>
      `}
    </div>

    <!-- 固定保存ボタン -->
    <button class="fab-save" id="saveBtn" title="保存">
      <span class="fab-save-icon">💾</span>
      <span>保存</span>
    </button>

    <!-- 過去データモーダル -->
    <div class="modal-overlay d-none" id="histModal">
      <div class="modal">
        <div class="modal-title">過去の製造データ<button class="modal-close" id="histClose">✕</button></div>
        <div id="histList"></div>
      </div>
    </div>
  `;

  if(_manufacture_products.length>0) bindMfgEvents(container);
}

function mfgRow(p) {
  const c=counts[p.id]||0;
  return `
    <tr data-id="${p.id}">
      <td class="product-cell" title="${escHtml(p.name)}">${escHtml(p.name)}<br><span style="font-size:11px;color:var(--text-sub);font-weight:400;">${p.price}円</span></td>
      <td>
        <div class="qty-wrap">
          <button class="qty-btn-5" data-step="-5" data-id="${p.id}">−5</button>
          <button class="qty-btn-1" data-step="-1" data-id="${p.id}">−1</button>
          <input type="number" class="qty-display count-input" data-id="${p.id}" value="${c}" min="0" inputmode="numeric"/>
          <button class="qty-btn-1" data-step="+1" data-id="${p.id}">＋1</button>
          <button class="qty-btn-5" data-step="+5" data-id="${p.id}">＋5</button>
        </div>
      </td>
      <td class="subtotal" data-id="${p.id}" style="text-align:right;font-weight:700;font-size:12px;padding-right:6px;">${(c*p.price).toLocaleString()}円</td>
    </tr>`;
}

function bindMfgEvents(container) {
  // スピナーボタン
  container.querySelectorAll('.qty-btn-5,.qty-btn-1').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.dataset.id, step=Number(btn.dataset.step);
      pushHistory();
      counts[id]=Math.max(0,(counts[id]||0)+step);
      refreshRow(container,id);
      _manufacture_refreshTotals(container);
      refreshUndo(container);
    });
  });
  // 直接入力
  container.querySelectorAll('.count-input').forEach(inp=>{
    inp.addEventListener('change',()=>{
      const id=inp.dataset.id;
      pushHistory();
      counts[id]=Math.max(0,Number(inp.value)||0);
      refreshRow(container,id);
      _manufacture_refreshTotals(container);
      refreshUndo(container);
    });
  });
  // 元に戻す
  container.querySelector('#undoBtn').addEventListener('click',()=>{
    if(!history.length) return;
    counts=JSON.parse(history.pop());
    _manufacture_render(container);
  });
  // クリア
  container.querySelector('#clearBtn').addEventListener('click',async()=>{
    if(!confirm('クリアしますか？（現在のデータは自動保存されます）')) return;
    await _manufacture_saveData(); pushHistory();
    _manufacture_products.forEach(p=>{ counts[p.id]=0; });
    _manufacture_render(container); showToast('✅ クリアしました（自動保存済み）');
  });
  // 保存
  container.querySelector('#saveBtn').addEventListener('click',async()=>{
    await _manufacture_saveData(); showToast('✅ 保存しました');
  });
  // 過去データ
  container.querySelector('#histBtn').addEventListener('click',async()=>{
    await _manufacture_showHistory(container);
  });
  container.querySelector('#histClose').addEventListener('click',()=>{
    container.querySelector('#histModal').classList.add('d-none');
  });
}

function refreshRow(container, id) {
  const p=_manufacture_products.find(p=>p.id==id);
  const c=counts[id]||0;
  const inp=container.querySelector(`.count-input[data-id="${id}"]`);
  const sub=container.querySelector(`.subtotal[data-id="${id}"]`);
  if(inp) inp.value=c;
  if(sub && p) sub.textContent=`${(c*p.price).toLocaleString()}円`;
}
function _manufacture_refreshTotals(container) {
  const {cnt,price}=_manufacture_calcTotals();
  const e1=container.querySelector('#totalCnt'), e2=container.querySelector('#totalPrice');
  if(e1) e1.textContent=`${cnt}個`;
  if(e2) e2.textContent=`${price.toLocaleString()}円`;
}
function refreshUndo(container) {
  const btn=container.querySelector('#undoBtn'); if(!btn) return;
  const has=history.length>0;
  btn.disabled=!has;
  btn.className=`btn ${has?'btn-outline':'btn-ghost'}`;
  btn.textContent=`↩ 元に戻す${has?`（${history.length}）`:''}`;
}
function pushHistory() { history.push(JSON.stringify(counts)); if(history.length>20) history.shift(); }

async function _manufacture_saveData() {
  const {cnt,price}=_manufacture_calcTotals();
  const items=_manufacture_products.filter(p=>(counts[p.id]||0)>0).map(p=>({productId:p.id,count:counts[p.id],subtotal:counts[p.id]*p.price}));
  await dbPut(STORES.MFG,{date:todayStr(),weekday:getCurrentWeekday(),items,totalCount:cnt,totalPrice:price,updatedAt:new Date().toISOString()});
}

function getCurrentWeekday() {
  const days=['日','月','火','水','木','金','土'];
  return days[new Date().getDay()];
}

async function _manufacture_showHistory(container) {
  const all = await dbGetAll(STORES.MFG);
  const today=todayStr();
  const past = all.filter(r=>r.date!==today).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  const listEl = container.querySelector('#histList');
  if(past.length===0) { listEl.innerHTML='<div class="empty-state"><div class="empty-text">過去データがありません</div></div>'; }
  else {
    listEl.innerHTML=past.map(r=>`
      <div class="history-item" data-date="${r.date}">
        <div class="history-date">${fmtDateJP(r.date)}（${r.weekday||getWeekdayStr(r.date)}）</div>
        <div class="history-meta">総製造 ${r.totalCount}個 / ${(r.totalPrice||0).toLocaleString()}円</div>
      </div>`).join('');
    listEl.querySelectorAll('.history-item').forEach(el=>{
      el.addEventListener('click',()=>{
        const rec=past.find(r=>r.date===el.dataset.date);
        if(!rec) return;
        pushHistory();
        _manufacture_products.forEach(p=>{ counts[p.id]=0; });
        (rec.items||[]).forEach(i=>{ counts[i.productId]=i.count; });
        container.querySelector('#histModal').classList.add('d-none');
        _manufacture_render(container);
        showToast(`✅ ${fmtDateJP(rec.date)}のデータを読み込みました`);
      });
    });
  }
  container.querySelector('#histModal').classList.remove('d-none');
}

function fmtDateJP(d) { const [,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }
function emptyState(icon,title,desc) { return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${title}：${desc}</div></div>`; }

/* ========== loss.js ========== */
/**
 * loss.js - ロス計算
 * 割引タブ / ロスタブ切替・±1スピナー・右下固定保存・過去データ参照
 */
let _loss_products=[], rows={}, _loss_currentTab='discount';

async function initLoss(container) {
  _loss_products = await getActiveProducts();
  const today = todayStr();
  const existing = await dbGet(STORES.LOSS, today);
  rows={};
  _loss_products.forEach(p=>{ rows[p.id]={d20:0,d30:0,d50:0,lossCount:0}; });
  if(existing) existing.items.forEach(i=>{
    rows[i.productId]={d20:i.discount20||0,d30:i.discount30||0,d50:i.discount50||0,lossCount:i.lossCount||0};
  });
  _loss_currentTab='discount';
  _loss_render(container);
}

/* ---- 計算 ---- */
function calcItem(p,r) {
  const disc=Math.round(r.d20*p.price*.2)+Math.round(r.d30*p.price*.3)+Math.round(r.d50*p.price*.5);
  return { disc, lossPrice:r.lossCount*p.price };
}
function _loss_calcTotals() {
  let t20=0,t30=0,t50=0,tDisc=0,tLC=0,tLP=0;
  _loss_products.forEach(p=>{ const r=rows[p.id]; const {disc,lossPrice}=calcItem(p,r);
    t20+=r.d20; t30+=r.d30; t50+=r.d50; tDisc+=disc; tLC+=r.lossCount; tLP+=lossPrice; });
  return {t20,t30,t50,tDisc,tLC,tLP};
}

/* ---- レンダリング ---- */
function _loss_render(container) {
  const t=_loss_calcTotals();
  container.innerHTML=`
    <div class="page">
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="btn btn-ghost btn-sm" id="histBtn">📅 過去データ</button>
      </div>

      <!-- タブ -->
      <div class="tab-bar">
        <button class="tab-btn ${_loss_currentTab==='discount'?'active':''}" data-tab="discount">🏷️ 割引計算</button>
        <button class="tab-btn ${_loss_currentTab==='loss'?'active':''}"     data-tab="loss">📉 ロス計算</button>
      </div>

      ${_loss_products.length===0
        ? '<div class="empty-state"><div class="empty-icon">📉</div><div class="empty-text">商品管理で商品を追加してください</div></div>'
        : _loss_currentTab==='discount' ? renderDiscountTab(t) : renderLossTab(t)
      }
    </div>

    <!-- 固定保存ボタン -->
    <button class="fab-save" id="saveBtn"><span class="fab-save-icon">💾</span><span>保存</span></button>

    <!-- 過去データモーダル -->
    <div class="modal-overlay d-none" id="histModal">
      <div class="modal">
        <div class="modal-title">過去のロスデータ<button class="modal-close" id="histClose">✕</button></div>
        <div id="histList"></div>
      </div>
    </div>
  `;
  _loss_bindEvents(container);
}

function renderDiscountTab(t) {
  return `
    <div class="card">
      <div class="tbl-wrap">
        <table class="tbl loss-tbl" style="table-layout:fixed;">
          <colgroup><col style="width:28%"><col style="width:24%"><col style="width:24%"><col style="width:24%"></colgroup>
          <thead><tr><th>品名</th><th>20%</th><th>30%</th><th>50%</th></tr></thead>
          <tbody>
            ${_loss_products.map(p=>{
              const r=rows[p.id];
              return `<tr data-id="${p.id}">
                <td>${escHtml(p.name)}</td>
                <td>${lossSpinner(p.id,'d20',r.d20)}</td>
                <td>${lossSpinner(p.id,'d30',r.d30)}</td>
                <td>${lossSpinner(p.id,'d50',r.d50)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="summary-bar">
      <div class="summary-row"><span>20%割引個数</span><span class="summary-value" id="t20">${t.t20}個</span></div>
      <div class="summary-row"><span>30%割引個数</span><span class="summary-value" id="t30">${t.t30}個</span></div>
      <div class="summary-row"><span>50%割引個数</span><span class="summary-value" id="t50">${t.t50}個</span></div>
      <div class="summary-row total"><span>総割引金額</span><span class="summary-value" id="tDisc">${t.tDisc.toLocaleString()}円</span></div>
    </div>`;
}

function renderLossTab(t) {
  return `
    <div class="card">
      <div class="tbl-wrap">
        <table class="tbl loss-tbl" style="table-layout:fixed;">
          <colgroup><col style="width:38%"><col style="width:32%"><col style="width:30%"></colgroup>
          <thead><tr><th>品名</th><th>ロス個数</th><th>ロス金額</th></tr></thead>
          <tbody>
            ${_loss_products.map(p=>{
              const r=rows[p.id];
              const {lossPrice}=calcItem(p,r);
              return `<tr data-id="${p.id}">
                <td>${escHtml(p.name)}</td>
                <td>${lossSpinner(p.id,'lossCount',r.lossCount)}</td>
                <td class="loss-price" data-id="${p.id}" style="text-align:right;font-weight:700;">${lossPrice.toLocaleString()}円</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="summary-bar">
      <div class="summary-row"><span>ロス個数</span><span class="summary-value" id="tLC">${t.tLC}個</span></div>
      <div class="summary-row total"><span>ロス金額</span><span class="summary-value" id="tLP">${t.tLP.toLocaleString()}円</span></div>
    </div>`;
}

function lossSpinner(productId, field, value) {
  return `<div class="loss-qty-wrap" style="margin:0 auto;width:fit-content;">
    <button class="loss-qty-btn" data-id="${productId}" data-field="${field}" data-step="-1">－</button>
    <input type="number" class="loss-qty-display loss-inp" data-id="${productId}" data-field="${field}" value="${value}" min="0" inputmode="numeric"/>
    <button class="loss-qty-btn" data-id="${productId}" data-field="${field}" data-step="+1">＋</button>
  </div>`;
}

function _loss_bindEvents(container) {
  // タブ切替
  container.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ _loss_currentTab=btn.dataset.tab; _loss_render(container); });
  });

  // スピナーボタン
  container.querySelectorAll('.loss-qty-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const {id,field,step}=btn.dataset;
      rows[id][field]=Math.max(0,(rows[id][field]||0)+Number(step));
      // 対応するinputを更新
      const inp=container.querySelector(`.loss-inp[data-id="${id}"][data-field="${field}"]`);
      if(inp) inp.value=rows[id][field];
      _loss_refreshTotals(container);
      if(field==='lossCount') refreshLossPrice(container,id);
    });
  });

  // 直接入力
  container.querySelectorAll('.loss-inp').forEach(inp=>{
    inp.addEventListener('change',()=>{
      const {id,field}=inp.dataset;
      rows[id][field]=Math.max(0,Number(inp.value)||0);
      inp.value=rows[id][field];
      _loss_refreshTotals(container);
      if(field==='lossCount') refreshLossPrice(container,id);
    });
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault();
        const allInps=[...container.querySelectorAll('.loss-inp')];
        const idx=allInps.indexOf(inp);
        if(allInps[idx+1]) { allInps[idx+1].focus(); allInps[idx+1].select(); }
      }
    });
    inp.addEventListener('focus',()=>inp.select());
  });

  // 保存
  container.querySelector('#saveBtn').addEventListener('click',async()=>{
    await _loss_saveData(); showToast('✅ 保存しました');
  });

  // 過去データ
  container.querySelector('#histBtn').addEventListener('click',()=>_loss_showHistory(container));
  container.querySelector('#histClose').addEventListener('click',()=>{
    container.querySelector('#histModal').classList.add('d-none');
  });
}

function _loss_refreshTotals(container) {
  const t=_loss_calcTotals();
  const set=(id,val)=>{ const el=container.querySelector(id); if(el) el.textContent=val; };
  set('#t20',`${t.t20}個`); set('#t30',`${t.t30}個`); set('#t50',`${t.t50}個`);
  set('#tDisc',`${t.tDisc.toLocaleString()}円`);
  set('#tLC',`${t.tLC}個`); set('#tLP',`${t.tLP.toLocaleString()}円`);
}
function refreshLossPrice(container, id) {
  const p=_loss_products.find(p=>p.id==id);
  const el=container.querySelector(`.loss-price[data-id="${id}"]`);
  if(el && p) el.textContent=`${(rows[id].lossCount*p.price).toLocaleString()}円`;
}

async function _loss_saveData() {
  const t=_loss_calcTotals();
  const items=_loss_products.filter(p=>{ const r=rows[p.id]; return r.d20||r.d30||r.d50||r.lossCount; })
    .map(p=>{ const r=rows[p.id]; const {disc,lossPrice}=calcItem(p,r);
      return {productId:p.id,discount20:r.d20,discount30:r.d30,discount50:r.d50,
              discountPrice:disc,lossCount:r.lossCount,lossPrice}; });
  await dbPut(STORES.LOSS,{date:todayStr(),weekday:getWeekdayStr(),items,
    total20:t.t20,total30:t.t30,total50:t.t50,totalDiscount:t.tDisc,
    totalLossCount:t.tLC,totalLossPrice:t.tLP});
}

async function _loss_showHistory(container) {
  const all=await dbGetAll(STORES.LOSS);
  const today=todayStr();
  const past=all.filter(r=>r.date!==today).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  const listEl=container.querySelector('#histList');
  listEl.innerHTML=past.length===0
    ? '<div class="empty-state"><div class="empty-text">過去データがありません</div></div>'
    : past.map(r=>`<div class="history-item" data-date="${r.date}">
        <div class="history-date">${_loss_fmtJP(r.date)}（${r.weekday||getWeekdayStr(r.date)}）</div>
        <div class="history-meta">割引${r.totalDiscount?.toLocaleString()||0}円 ロス${r.totalLossCount||0}個/${(r.totalLossPrice||0).toLocaleString()}円</div>
      </div>`).join('');
  listEl.querySelectorAll('.history-item').forEach(el=>{
    el.addEventListener('click',()=>{
      const rec=past.find(r=>r.date===el.dataset.date); if(!rec) return;
      _loss_products.forEach(p=>{ rows[p.id]={d20:0,d30:0,d50:0,lossCount:0}; });
      (rec.items||[]).forEach(i=>{ rows[i.productId]={d20:i.discount20||0,d30:i.discount30||0,d50:i.discount50||0,lossCount:i.lossCount||0}; });
      container.querySelector('#histModal').classList.add('d-none');
      _loss_render(container); showToast(`✅ ${_loss_fmtJP(rec.date)}のデータを読み込みました`);
    });
  });
  container.querySelector('#histModal').classList.remove('d-none');
}

function _loss_fmtJP(d){ const [,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }

/* ========== report.js ========== */
/** report.js - 日報（自動保存・コピーのみ） */
let data={sales:0,customers:0,body:'',name:''}, timer=null;

async function initReport(container) {
  const existing=await dbGet(STORES.REPORT,todayStr());
  data=existing?{sales:existing.sales,customers:existing.customers,body:existing.body,name:existing.name}:{sales:0,customers:0,body:'',name:''};
  _report_render(container);
}

function unitPrice(){ return data.customers?Math.round(data.sales/data.customers):0; }

function buildText(){
  const d=todayStr(),[,m,dd]=d.split('-'),wd=getWeekdayStr(d);
  return `お疲れ様です。\n丸井店舗売上報告をいたします。\n${Number(m)}月${Number(dd)}日 ${wd}曜日\n総売上 ${data.sales.toLocaleString()}円\n客数 ${data.customers}人\n客単価 ${unitPrice().toLocaleString()}円\n総括\n${data.body}\n${data.name}`;
}

function _report_render(container){
  const d=todayStr(),[,m,dd]=d.split('-'),wd=getWeekdayStr(d);
  container.innerHTML=`
    <div class="page">
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📅</span>${Number(m)}月${Number(dd)}日（${wd}）
          <span id="autoChip" class="chip" style="margin-left:auto;font-size:11px;"></span>
        </div>
        <div class="card-body">
          <div class="form-group"><label class="form-label">売上（円）</label>
            <input type="number" class="form-input" id="sales" inputmode="numeric" value="${data.sales||''}" placeholder="例：85000"/></div>
          <div class="form-group"><label class="form-label">客数（人）</label>
            <input type="number" class="form-input" id="customers" inputmode="numeric" value="${data.customers||''}" placeholder="例：120"/></div>
          <div class="form-group mb-sm"><label class="form-label">客単価（自動）</label>
            <div class="chip" id="unitChip">${unitPrice().toLocaleString()}円</div></div>
          <div class="form-group"><label class="form-label">総括（本文）</label>
            <textarea class="form-textarea" id="body" placeholder="申し送り等">${data.body}</textarea></div>
          <div class="form-group"><label class="form-label">名前</label>
            <input type="text" class="form-input" id="name" value="${data.name}" placeholder="例：山田"/></div>
        </div>
      </div>
      <div class="section-title">プレビュー</div>
      <div class="report-preview" id="preview">${escHtml(buildText())}</div>
      <button class="btn btn-accent btn-full mt-md" id="copyBtn">📋 LINEにコピー</button>
    </div>`;
  _report_bind(container);
}

function _report_bind(container){
  const upd=()=>{
    data.sales=Number(container.querySelector('#sales').value)||0;
    data.customers=Number(container.querySelector('#customers').value)||0;
    data.body=container.querySelector('#body').value;
    data.name=container.querySelector('#name').value;
    container.querySelector('#unitChip').textContent=unitPrice().toLocaleString()+'円';
    container.querySelector('#preview').textContent=buildText();
    const chip=container.querySelector('#autoChip');
    chip.textContent='保存中…';
    clearTimeout(timer);
    timer=setTimeout(async()=>{
      await autoSave();
      chip.textContent='✅ 自動保存済み';
      setTimeout(()=>chip.textContent='',2000);
    },2000);
  };
  ['#sales','#customers','#body','#name'].forEach(sel=>container.querySelector(sel).addEventListener('input',upd));
  container.querySelector('#copyBtn').addEventListener('click',async()=>{
    try{ await navigator.clipboard.writeText(buildText()); }
    catch{ const ta=document.createElement('textarea'); ta.value=buildText(); ta.style.cssText='position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    showToast('✅ コピーしました');
  });
}
async function autoSave(){
  await dbPut(STORES.REPORT,{date:todayStr(),sales:data.sales,customers:data.customers,unitPrice:unitPrice(),body:data.body,name:data.name});
}

/* ========== discount.js ========== */
/**
 * discount.js - 割引分析画面
 * タブ1: 割引分析（在庫入力・グラフ・完売予測・割引推奨）
 * タブ2: 追加製造支援（時刻別推奨・おすすめ商品・記録）
 */
let record=null, idealStock={}, weekdayAvg={}, yesterdayStock={};
let _discount_products=[], mfgRecords=[], lossRecords=[];
let _discount_currentTab='analysis';
let chartInst=null;
const SLOTS=generateTimeSlots();

async function initDiscount(container) {
  const today=todayStr(), wd=getWeekdayStr(today);
  const existing=await dbGet(STORES.DISCOUNT, today);
  record=existing||{date:today,weekday:wd,inventoryLogs:[],discountLogs:[],manufactureLogs:[],hourlySales:{},hourlyCustomers:{}};

  [weekdayAvg, yesterdayStock, _discount_products, mfgRecords, lossRecords] = await Promise.all([
    getWeekdayAverageStock(wd,[today]),
    getYesterdayStock(),
    getActiveProducts(),
    dbGetAll(STORES.MFG),
    dbGetAll(STORES.LOSS),
  ]);
  idealStock=await calcIdealStock(wd);
  _discount_render(container);
}

/* ============================================================ 共通 */
function getStock(t){ const l=record.inventoryLogs.find(l=>l.time===t); return l?l.stock:null; }
function setStock(t,v){
  const idx=record.inventoryLogs.findIndex(l=>l.time===t);
  if(v===''||v==null){ if(idx>=0) record.inventoryLogs.splice(idx,1); return; }
  if(idx>=0) record.inventoryLogs[idx].stock=Number(v);
  else record.inventoryLogs.push({time:t,stock:Number(v)});
}
function latestLog(){ return [...record.inventoryLogs].sort((a,b)=>b.time.localeCompare(a.time))[0]||null; }
function _discount_fmtJP(d){ const[,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }

/* ============================================================ メインレンダー */
function _discount_render(container) {
  const today=todayStr(), wd=getWeekdayStr(today);
  const latest=latestLog();
  const prediction=predictSoldOut(record.inventoryLogs, idealStock);
  const nowT=nowTimeStr();
  const nearSlot=[...SLOTS].filter(t=>t<=nowT).pop()||SLOTS[0];
  const rec=latest?getDiscountRecommendation(latest.stock, idealStock[nearSlot], prediction):{show:false,rate:0,reasons:[]};

  container.innerHTML=`
    <div class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span class="text-muted" style="font-size:13px;">${_discount_fmtJP(today)}（${wd}曜日）</span>
        <button class="btn btn-ghost btn-sm" id="histBtn">📅 過去データ</button>
      </div>

      <!-- タブ -->
      <div class="tab-bar">
        <button class="tab-btn ${_discount_currentTab==='analysis'?'active':''}" data-tab="analysis">📈 割引分析</button>
        <button class="tab-btn ${_discount_currentTab==='manufacture'?'active':''}" data-tab="manufacture">➕ 追加製造支援</button>
      </div>

      ${_discount_currentTab==='analysis'
        ? renderAnalysisTab(prediction, rec, latest, nearSlot)
        : renderManufactureTab(wd, nowT)}
    </div>

    <button class="fab-save" id="saveBtn"><span class="fab-save-icon">💾</span><span>保存</span></button>

    <!-- 過去データモーダル -->
    <div class="modal-overlay d-none" id="histModal">
      <div class="modal">
        <div class="modal-title">過去の割引分析データ<button class="modal-close" id="histClose">✕</button></div>
        <div id="histList"></div>
      </div>
    </div>
  `;

  _discount_bindEvents(container);
  if(_discount_currentTab==='analysis') renderChart(container);
}

/* ============================================================ 割引分析タブ */
function renderAnalysisTab(prediction, rec, latest, nearSlot) {
  return `
    <!-- 完売予測 -->
    <div class="predict-bar">
      <div class="predict-percent">${prediction.probability}%</div>
      <div class="predict-info">
        <div class="predict-title">完売確率</div>
        <div class="predict-time">${prediction.predictedTime?'予測完売時刻 '+prediction.predictedTime:'在庫を入力してください'}</div>
      </div>
    </div>

    <!-- 割引推奨 -->
    ${rec.show?`<div class="recommend-banner">
      <div class="recommend-title">🏷️ ${rec.rate}%割引を推奨</div>
      <ul class="recommend-reasons">${rec.reasons.map(r=>`<li>${escHtml(r)}</li>`).join('')}</ul>
    </div>`:''}

    <!-- 割引ボタン -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">🏷️</span>割引開始記録</div>
      <div class="card-body">
        <div class="btn-group mb-md">
          <button class="btn btn-outline disc-start" data-rate="20">20%開始</button>
          <button class="btn btn-outline disc-start" data-rate="30">30%開始</button>
          <button class="btn btn-outline disc-start" data-rate="50">50%開始</button>
        </div>
        ${record.discountLogs.length>0?`
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${record.discountLogs.map((d,i)=>`
              <span class="disc-badge disc-${d.rate}">${d.time} ${d.rate}%
                <span style="cursor:pointer;margin-left:4px;" class="del-disc" data-i="${i}">✕</span>
              </span>`).join('')}
          </div>`
          :'<div class="form-hint">まだ割引は記録されていません</div>'}
      </div>
    </div>

    <!-- 在庫入力 -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">📦</span>在庫入力（10分ごと）</div>
      <div class="card-body">
        <div class="timeline-grid">
          ${SLOTS.map(t=>{
            const v=getStock(t);
            const ideal=idealStock[t];
            const diff=v!=null&&ideal!=null?v-ideal:null;
            const diffColor=diff!=null?(diff>5?'#C62828':diff<-5?'#1565C0':'inherit'):'inherit';
            return `<span class="timeline-time">${t}</span>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" class="timeline-input stock-inp ${v!=null?'has-value':''}" data-t="${t}"
                  value="${v??''}" placeholder="個" inputmode="numeric" min="0"/>
                <span style="font-size:11px;color:${diffColor};min-width:40px;">
                  ${ideal!=null?`理想:${ideal}個`:''}
                  ${diff!=null?`(${diff>0?'+':''}${diff})` : ''}
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- グラフ -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">📈</span>在庫推移グラフ</div>
      <div class="card-body">
        <div style="font-size:11px;color:var(--text-sub);margin-bottom:6px;display:flex;flex-wrap:wrap;gap:8px;">
          <span style="color:#2E7D32;">■ 現在</span>
          <span style="color:#1565C0;">■ 理想</span>
          <span style="color:#9E9E9E;">■ 曜日平均</span>
          <span style="color:#F57F17;">■ 昨日</span>
          <span style="color:#C62828;">■ 完売予測</span>
        </div>
        <div class="chart-wrap"><canvas id="stockChart"></canvas></div>
      </div>
    </div>`;
}

/* ============================================================ 追加製造支援タブ */
function renderManufactureTab(wd, nowT) {
  const latest=latestLog();
  const currentStock=latest?latest.stock:null;
  const mfgRec=getManufactureRecommendation(currentStock??0, wd, nowT);
  const prodRec=getProductRecommendations(mfgRecords, lossRecords, _discount_products, wd);

  // 時刻別の推奨追加製造数テーブル
  const futureSlots=SLOTS.filter(t=>t>=nowT).slice(0,6);

  return `
    <!-- 現在状況 -->
    <div class="stat-grid mb-md">
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">現在在庫</div>
        <div class="stat-value">${currentStock??'－'}<span class="stat-unit">${currentStock!=null?'個':''}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🎯</div>
        <div class="stat-label">理想在庫（${mfgRec.nearSlot}）</div>
        <div class="stat-value">${mfgRec.idealNow}<span class="stat-unit">個</span></div>
      </div>
    </div>

    <!-- 今すぐの推奨 -->
    <div class="card" style="border-left:4px solid var(--accent);">
      <div class="card-body" style="background:var(--warning-light);">
        <div style="font-size:17px;font-weight:700;color:var(--accent-dark);margin-bottom:4px;">
          🏭 今すぐ追加製造：＋${mfgRec.count}個
        </div>
        <div style="font-size:13px;color:var(--text-sub);">
          ${nowT}時点 / 完売確率 ${mfgRec.probability}% / 理想在庫 ${mfgRec.idealNow}個
        </div>
      </div>
    </div>

    <!-- 時刻別推奨テーブル -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">⏰</span>時刻別 推奨追加製造数</div>
      <div class="card-body" style="padding:0;">
        <table class="tbl">
          <thead><tr><th>時刻</th><th>理想在庫</th><th style="text-align:right;">推奨追加数</th></tr></thead>
          <tbody>
            ${futureSlots.map(t=>{
              const ideal=idealStock[t]??0;
              const add=Math.max(0,ideal-(currentStock??0));
              return `<tr>
                <td>${t}</td>
                <td style="text-align:center;">${ideal}個</td>
                <td style="text-align:right;font-weight:700;color:var(--accent);">＋${add}個</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- おすすめ商品 -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">⭐</span>追加製造おすすめ商品（${wd}曜日 実績）</div>
      <div class="card-body">
        ${prodRec.goodBets.length>0?`
          <div class="section-title mb-sm">よく売れる・ロスが少ない商品</div>
          ${prodRec.goodBets.map(p=>`
            <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
              <span style="flex:1;font-weight:600;">${escHtml(p.name)}</span>
              <span style="font-size:12px;color:var(--text-sub);margin-right:8px;">ロス率${p.lossRate}%</span>
              <span class="chip">累計${p.totalMfg}個</span>
            </div>`).join('')}`
          :'<div class="form-hint">データが蓄積されると表示されます</div>'}

        ${prodRec.risky.length>0?`
          <div class="section-title mb-sm mt-md" style="color:var(--danger);border-color:var(--danger);">⚠️ ロスが多い商品（注意）</div>
          ${prodRec.risky.map(p=>`
            <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
              <span style="flex:1;font-weight:600;">${escHtml(p.name)}</span>
              <span class="chip" style="background:var(--danger-light);color:var(--danger);">ロス率${p.lossRate}%</span>
            </div>`).join('')}`:''}
      </div>
    </div>

    <!-- 追加製造記録 -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">📝</span>追加製造を記録</div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">時間</label>
          <input type="text" class="form-input" id="mfgTime" value="${nowT}" placeholder="例：17:05"/>
        </div>
        <div style="display:flex;gap:12px;">
          <div class="form-group" style="flex:1;">
            <label class="form-label">おすすめ製造数</label>
            <input type="number" class="form-input" id="mfgRecommend" value="${mfgRec.count}" inputmode="numeric"/>
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label">実際製造数</label>
            <input type="number" class="form-input" id="mfgActual" inputmode="numeric" placeholder="実際の数"/>
          </div>
        </div>
        <button class="btn btn-accent btn-full" id="addMfgBtn">追加製造を記録</button>
        ${record.manufactureLogs.length>0?`
          <div class="mt-md">
            ${record.manufactureLogs.map((m,i)=>`
              <div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
                <span style="flex:1;font-size:14px;">${m.time} 推奨${m.recommendCount}個 → 実際${m.actualCount}個</span>
                <span class="del-mfg" data-i="${i}" style="cursor:pointer;color:var(--danger);padding:4px;">✕</span>
              </div>`).join('')}
          </div>`:''}
      </div>
    </div>`;
}

/* ============================================================ イベント */
function _discount_bindEvents(container) {
  // タブ
  container.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ _discount_currentTab=btn.dataset.tab; _discount_render(container); });
  });

  // 保存
  container.querySelector('#saveBtn').addEventListener('click',async()=>{
    await dbPut(STORES.DISCOUNT,record); showToast('✅ 保存しました');
  });

  // 過去データ
  container.querySelector('#histBtn').addEventListener('click',()=>_discount_showHistory(container));
  container.querySelector('#histClose').addEventListener('click',()=>{
    container.querySelector('#histModal').classList.add('d-none');
  });

  if(_discount_currentTab==='analysis') {
    // 在庫入力
    container.querySelectorAll('.stock-inp').forEach(inp=>{
      inp.addEventListener('change',()=>{ setStock(inp.dataset.t, inp.value); _discount_render(container); });
    });
    // 割引開始
    container.querySelectorAll('.disc-start').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const rate=Number(btn.dataset.rate);
        const t=prompt('割引開始時刻（例: 18:30）', nowTimeStr()); if(!t) return;
        record.discountLogs.push({time:t,rate});
        record.discountLogs.sort((a,b)=>a.time.localeCompare(b.time));
        _discount_render(container); showToast(`✅ ${rate}%割引を記録しました`);
      });
    });
    // 割引削除
    container.querySelectorAll('.del-disc').forEach(el=>{
      el.addEventListener('click',()=>{ record.discountLogs.splice(Number(el.dataset.i),1); _discount_render(container); });
    });
  }

  if(_discount_currentTab==='manufacture') {
    // 追加製造記録
    container.querySelector('#addMfgBtn')?.addEventListener('click',()=>{
      const t=container.querySelector('#mfgTime').value.trim();
      const rec=Number(container.querySelector('#mfgRecommend').value)||0;
      const act=Number(container.querySelector('#mfgActual').value)||0;
      if(!t){ showToast('時間を入力してください'); return; }
      record.manufactureLogs.push({time:t,recommendCount:rec,actualCount:act});
      record.manufactureLogs.sort((a,b)=>a.time.localeCompare(b.time));
      _discount_render(container); showToast('✅ 追加製造を記録しました');
    });
    // 追加製造削除
    container.querySelectorAll('.del-mfg').forEach(el=>{
      el.addEventListener('click',()=>{ record.manufactureLogs.splice(Number(el.dataset.i),1); _discount_render(container); });
    });
  }
}

/* ============================================================ グラフ */
function renderChart(container) {
  const canvas=container.querySelector('#stockChart');
  if(!canvas||typeof Chart==='undefined') return;
  if(chartInst){ chartInst.destroy(); chartInst=null; }

  const current  = SLOTS.map(t=>getStock(t));
  const ideal    = SLOTS.map(t=>idealStock[t]??null);
  const wdAvg    = SLOTS.map(t=>weekdayAvg[t]??null);
  const yesterday= SLOTS.map(t=>yesterdayStock[t]??null);

  // 完売予測線
  const pred=predictSoldOut(record.inventoryLogs,idealStock);
  const predLine=buildPredLine(pred);

  // 割引開始時刻のアノテーション（縦線の代わりにデータポイントに表示）
  chartInst=new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{
      labels:SLOTS,
      datasets:[
        {label:'現在在庫',  data:current,   borderColor:'#2E7D32',backgroundColor:'rgba(46,125,50,.1)',borderWidth:3,tension:.3,spanGaps:true},
        {label:'理想在庫',  data:ideal,     borderColor:'#1565C0',borderDash:[6,4],borderWidth:2,tension:.3,spanGaps:true,pointRadius:0},
        {label:'曜日平均',  data:wdAvg,     borderColor:'#9E9E9E',borderDash:[2,2],borderWidth:1.5,tension:.3,spanGaps:true,pointRadius:0},
        {label:'昨日',      data:yesterday, borderColor:'#F57F17',borderWidth:1.5,tension:.3,spanGaps:true,pointRadius:0},
        {label:'完売予測',  data:predLine,  borderColor:'#C62828',borderDash:[4,4],borderWidth:2,tension:0,spanGaps:true,pointRadius:0},
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false}},
      scales:{
        y:{beginAtZero:true,title:{display:true,text:'在庫数'}},
        x:{ticks:{maxRotation:60,minRotation:60,font:{size:10}}},
      }
    }
  });
}

function buildPredLine(pred) {
  const sorted=[...record.inventoryLogs].sort((a,b)=>a.time.localeCompare(b.time));
  if(!sorted.length||!pred.predictedTime) return SLOTS.map(()=>null);
  const last=sorted[sorted.length-1];
  return SLOTS.map(t=>{
    if(t<last.time) return null;
    if(toMin(t)>=toMin(pred.predictedTime)) return 0;
    const total=toMin(pred.predictedTime)-toMin(last.time);
    const elapsed=toMin(t)-toMin(last.time);
    return total<=0?last.stock:Math.max(0,Math.round(last.stock*(1-elapsed/total)));
  });
}

/* ============================================================ 過去データ */
async function _discount_showHistory(container) {
  const all=await dbGetAll(STORES.DISCOUNT);
  const today=todayStr();
  const past=all.filter(r=>r.date!==today).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  const listEl=container.querySelector('#histList');
  listEl.innerHTML=past.length===0
    ? '<div class="empty-state"><div class="empty-text">過去データがありません</div></div>'
    : past.map(r=>{
        const pred=predictSoldOut(r.inventoryLogs||[]);
        const discTimes=(r.discountLogs||[]).map(d=>`${d.time}(${d.rate}%)`).join(' ');
        return `<div class="history-item" data-date="${r.date}">
          <div class="history-date">${_discount_fmtJP(r.date)}（${r.weekday||getWeekdayStr(r.date)}）</div>
          <div class="history-meta">
            在庫データ${(r.inventoryLogs||[]).length}点
            ${discTimes?` ／ 割引: ${discTimes}`:''}
          </div>
        </div>`;
      }).join('');
  listEl.querySelectorAll('.history-item').forEach(el=>{
    el.addEventListener('click',()=>{
      const rec=past.find(r=>r.date===el.dataset.date); if(!rec) return;
      record={...rec,date:todayStr(),weekday:getWeekdayStr(todayStr())};
      container.querySelector('#histModal').classList.add('d-none');
      _discount_render(container); showToast(`✅ ${_discount_fmtJP(rec.date)}のデータを参照しています`);
    });
  });
  container.querySelector('#histModal').classList.remove('d-none');
}

function _discount_fmtJP(d){ const[,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }

/* ========== products.js ========== */
/** _products_products.js - 商品管理 */
let _products_products=[];

async function initProducts(container) {
  _products_products=await getAllProducts(); _products_render(container);
}

function _products_render(container){
  const active=_products_products.filter(p=>p.isActive), inactive=_products_products.filter(p=>!p.isActive);
  container.innerHTML=`
    <div class="page">
      <div class="card">
        <div class="card-header"><span class="card-header-icon">🛒</span>商品一覧</div>
        <div class="card-body" style="padding:0;">
          ${active.length===0?'<div class="empty-state"><div class="empty-text">商品がありません</div></div>':active.map(p=>row(p,true)).join('')}
        </div>
      </div>
      <button class="btn btn-primary btn-full mb-md" id="addBtn">＋ 商品を追加</button>
      ${inactive.length?`<div class="section-title">販売終了</div><div class="card"><div class="card-body" style="padding:0;">${inactive.map(p=>row(p,false)).join('')}</div></div>`:''}
    </div>

    <div class="modal-overlay d-none" id="modalOverlay">
      <div class="modal">
        <div class="modal-title" id="modalTitle">商品を追加<button class="modal-close" id="modalClose">✕</button></div>
        <form id="productForm">
          <input type="hidden" id="pid"/>
          <div class="form-group"><label class="form-label">商品名</label><input type="text" class="form-input" id="pname" required/></div>
          <div class="form-group"><label class="form-label">カテゴリ</label><input type="text" class="form-input" id="pcat" placeholder="例：フルーツ系"/></div>
          <div class="form-group"><label class="form-label">税込価格（円）</label><input type="number" class="form-input" id="pprice" inputmode="numeric" required min="0"/></div>
          <div class="form-group"><label class="form-label">原価（円）</label><input type="number" class="form-input" id="pcost" inputmode="numeric" required min="0"/></div>
          <div class="btn-group mt-md"><button type="button" class="btn btn-ghost" id="cancelBtn">キャンセル</button><button type="submit" class="btn btn-primary">保存</button></div>
        </form>
      </div>
    </div>`;
  _products_bind(container);
}

function row(p,isActive){
  return `<div class="product-item ${isActive?'':'product-inactive'}" data-id="${p.id}">
    <div class="product-info">
      <div class="product-name">${escHtml(p.name)}</div>
      <div class="product-meta">${p.category?escHtml(p.category)+' / ':''}${p.price}円（原価${p.cost}円）</div>
    </div>
    <div class="product-actions">
      <button class="btn btn-sm btn-outline edit-btn" data-id="${p.id}">編集</button>
      ${isActive?`<button class="btn btn-sm btn-danger end-btn" data-id="${p.id}">終了</button>`
               :`<button class="btn btn-sm btn-primary restore-btn" data-id="${p.id}">復活</button>`}
    </div>
  </div>`;
}

function _products_bind(container){
  const overlay=container.querySelector('#modalOverlay');
  const open=(p)=>{
    container.querySelector('#modalTitle').childNodes[0].textContent=p?'商品を編集':'商品を追加';
    container.querySelector('#pid').value=p?p.id:'';
    container.querySelector('#pname').value=p?p.name:'';
    container.querySelector('#pcat').value=p?p.category||'':'';
    container.querySelector('#pprice').value=p?p.price:'';
    container.querySelector('#pcost').value=p?p.cost:'';
    overlay.classList.remove('d-none');
  };
  const close=()=>overlay.classList.add('d-none');

  container.querySelector('#addBtn').addEventListener('click',()=>open(null));
  container.querySelector('#modalClose').addEventListener('click',close);
  container.querySelector('#cancelBtn').addEventListener('click',close);
  overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });

  container.querySelectorAll('.edit-btn').forEach(btn=>{
    btn.addEventListener('click',()=>open(_products_products.find(p=>p.id==btn.dataset.id)));
  });
  container.querySelectorAll('.end-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!confirm('販売終了にしますか？')) return;
      const p=_products_products.find(p=>p.id==btn.dataset.id); p.isActive=false;
      await dbPut(STORES.PRODUCTS,p); showToast('✅ 販売終了にしました');
      _products_products=await getAllProducts(); _products_render(container);
    });
  });
  container.querySelectorAll('.restore-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const p=_products_products.find(p=>p.id==btn.dataset.id); p.isActive=true;
      await dbPut(STORES.PRODUCTS,p); showToast('✅ 販売を再開しました');
      _products_products=await getAllProducts(); _products_render(container);
    });
  });

  container.querySelector('#productForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const id=container.querySelector('#pid').value;
    const name=container.querySelector('#pname').value.trim();
    const cat=container.querySelector('#pcat').value.trim();
    const price=Number(container.querySelector('#pprice').value);
    const cost=Number(container.querySelector('#pcost').value);
    if(!name){ showToast('商品名を入力してください'); return; }
    if(id){
      const p=_products_products.find(p=>p.id==id); Object.assign(p,{name,category:cat,price,cost});
      await dbPut(STORES.PRODUCTS,p); showToast('✅ 更新しました');
    } else {
      const maxOrder=_products_products.reduce((m,p)=>Math.max(m,p.sortOrder||0),0);
      await dbPut(STORES.PRODUCTS,{name,category:cat,price,cost,sortOrder:maxOrder+1,isActive:true});
      showToast('✅ 追加しました');
    }
    close(); _products_products=await getAllProducts(); _products_render(container);
  });
}

/* ========== settings.js ========== */
/** settings.js - 設定（文字サイズ・バックアップ・インポート） */
async function initSettings(container) { _settings_render(container); }

function _settings_render(container){
  const cur=getSavedFontSize();
  container.innerHTML=`<div class="page">
    <div class="section-title">表示設定</div>
    <div class="card"><div class="card-body">
      <div class="form-label" style="margin-bottom:12px;">文字の大きさ</div>
      <div class="font-size-group">
        <button class="font-size-btn ${cur==='small'?'active':''}" data-size="small"><span style="font-size:13px;">小</span></button>
        <button class="font-size-btn ${cur==='medium'?'active':''}" data-size="medium"><span style="font-size:16px;">中</span></button>
        <button class="font-size-btn ${cur==='large'?'active':''}" data-size="large"><span style="font-size:20px;">大</span></button>
      </div>
    </div></div>

    <div class="section-title">データ管理</div>
    <div class="card">
      <a class="setting-item" id="expJson" href="#"><span class="setting-icon">💾</span><div class="setting-info"><div class="setting-name">JSONバックアップ出力</div><div class="setting-desc">全データをJSONで保存</div></div><span class="setting-arrow">›</span></a>
      <a class="setting-item" id="expCsv"  href="#"><span class="setting-icon">📊</span><div class="setting-info"><div class="setting-name">CSV出力</div><div class="setting-desc">日報・製造・ロスをCSVで出力</div></div><span class="setting-arrow">›</span></a>
      <a class="setting-item" id="impJson" href="#"><span class="setting-icon">📥</span><div class="setting-info"><div class="setting-name">JSONインポート</div><div class="setting-desc">バックアップから復元</div></div><span class="setting-arrow">›</span></a>
      <input type="file" id="fileInput" accept="application/json" class="d-none"/>
    </div>

    <div class="section-title">アプリ情報</div>
    <div class="card"><div class="card-body">
      <div class="text-muted" style="font-size:14px;">サンドイッチ販売支援システム v2.0</div>
    </div></div>
  </div>`;
  _settings_bind(container);
}

function _settings_bind(container){
  container.querySelectorAll('.font-size-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      applyFontSize(btn.dataset.size);
      container.querySelectorAll('.font-size-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      showToast('✅ 文字サイズを変更しました');
    });
  });
  container.querySelector('#expJson').addEventListener('click',async e=>{ e.preventDefault(); await exportJson(); });
  container.querySelector('#expCsv').addEventListener('click',async e=>{ e.preventDefault(); await exportCsv(); });
  const fi=container.querySelector('#fileInput');
  container.querySelector('#impJson').addEventListener('click',e=>{ e.preventDefault(); fi.click(); });
  fi.addEventListener('change',async e=>{
    const f=e.target.files[0]; if(!f) return;
    if(!confirm('インポートすると既存データに上書きされます。よろしいですか？')){ fi.value=''; return; }
    try{ await importAllData(JSON.parse(await f.text())); showToast('✅ インポートしました'); }
    catch{ showToast('⚠️ インポートに失敗しました'); }
    fi.value='';
  });
}

async function exportJson(){
  const data=await exportAllData();
  dl(JSON.stringify(data,null,2),`sandwich-backup-${todayStr()}.json`,'application/json');
  showToast('✅ バックアップを出力しました');
}

async function exportCsv(){
  const products=await getAllProducts();
  const pm={}; products.forEach(p=>pm[p.id]=p.name);
  const mfg=await dbGetAll(STORES.MFG), loss=await dbGetAll(STORES.LOSS), rep=await dbGetAll(STORES.REPORT);
  let csv='【日報】\n日付,売上,客数,客単価,名前,本文\n';
  rep.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{ csv+=[r.date,r.sales,r.customers,r.unitPrice,q(r.name),q(r.body)].join(',')+'\n'; });
  csv+='\n【製造記録】\n日付,商品名,個数,小計\n';
  mfg.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{ (r.items||[]).forEach(i=>{ csv+=[r.date,q(pm[i.productId]||''),i.count,i.subtotal].join(',')+'\n'; }); });
  csv+='\n【ロス記録】\n日付,商品名,20%,30%,50%,割引金額,ロス個数,ロス金額\n';
  loss.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{ (r.items||[]).forEach(i=>{ csv+=[r.date,q(pm[i.productId]||''),i.discount20,i.discount30,i.discount50,i.discountPrice,i.lossCount,i.lossPrice].join(',')+'\n'; }); });
  dl('\uFEFF'+csv,`sandwich-data-${todayStr()}.csv`,'text/csv');
  showToast('✅ CSVを出力しました');
}

function q(s){ if(s==null) return ''; const v=String(s).replace(/"/g,'""'); return (v.includes(',')||v.includes('\n')||v.includes('"'))?`"${v}"`:v; }
function dl(content,filename,mime){ const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([content],{type:mime})),download:filename}); document.body.appendChild(a); a.click(); document.body.removeChild(a); }

/* ========== app.js ========== */
/** app.js - エントリーポイント・ルーティング・共通UI */
const PAGES = {
  dashboard:   { title:'ダッシュボード', init:initDashboard },
  manufacture: { title:'製造計算',       init:initManufacture },
  loss:        { title:'ロス計算',        init:initLoss },
  discount:    { title:'割引分析',        init:initDiscount },
  report:      { title:'日報',            init:initReport },
  products:    { title:'商品管理',        init:initProducts },
  settings:    { title:'設定',            init:initSettings },
};

const $ = id => document.getElementById(id);
const menuBtn=$('menuBtn'), drawer=$('drawer'), overlay=$('drawerOverlay'),
      drawerClose=$('drawerClose'), mainContent=$('mainContent'),
      headerTitle=$('headerTitle'), headerDate=$('headerDate'), toast=$('toast');

/* ---------- トースト ---------- */
function showToast(msg, duration=3000) {
  toast.textContent=msg; toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'), duration);
}

/* ---------- 日付ユーティリティ ---------- */
function todayStr() {
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getWeekdayStr(dateStr) {
  const days=['日','月','火','水','木','金','土'];
  return days[(dateStr?new Date(dateStr):new Date()).getDay()];
}
function nowTimeStr() {
  const d=new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function escHtml(s) { const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }

/* ---------- フォントサイズ ---------- */
const FS_KEY='app_font_size';
const FS_MAP={ small:'14px', medium:'16px', large:'19px' };
function applyFontSize(size) {
  document.documentElement.style.setProperty('--fs-base', FS_MAP[size]||'16px');
  localStorage.setItem(FS_KEY, size);
}
function getSavedFontSize() { return localStorage.getItem(FS_KEY)||'medium'; }

/* ---------- ドロワー ---------- */
const openDrawer  = () => { drawer.classList.add('open');  overlay.classList.add('active');  drawer.setAttribute('aria-hidden','false'); };
const closeDrawer = () => { drawer.classList.remove('open'); overlay.classList.remove('active'); drawer.setAttribute('aria-hidden','true'); };
menuBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);

/* ---------- ルーティング ---------- */
async function navigateTo(pageId) {
  if (!PAGES[pageId]) return;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page===pageId));
  headerTitle.textContent = PAGES[pageId].title;
  closeDrawer();
  mainContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try { await PAGES[pageId].init(mainContent); }
  catch(e) { console.error(e); mainContent.innerHTML='<div class="page"><div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">読み込みに失敗しました</div></div></div>'; }
}

document.querySelectorAll('.nav-item').forEach(el =>
  el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.page); })
);

/* ---------- ヘッダー日付 ---------- */
function updateDate() {
  const d=new Date(), days=['日','月','火','水','木','金','土'];
  headerDate.textContent=`${d.getMonth()+1}/${d.getDate()}（${days[d.getDay()]}）`;
}

/* ---------- 初期商品投入（実データ21品） ---------- */
async function seedProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  if (all.length>0) return;
  const products = [
    {name:'いちごサンド',           category:'フルーツ系',price:550,cost:197,sortOrder: 1,isActive:true},
    {name:'甘夏サンド',             category:'フルーツ系',price:500,cost:154,sortOrder: 2,isActive:true},
    {name:'フルーツミックスサンド', category:'フルーツ系',price:500,cost:148,sortOrder: 3,isActive:true},
    {name:'ブルーベリーサンド',     category:'フルーツ系',price:380,cost:114,sortOrder: 4,isActive:true},
    {name:'バナナショコラサンド',   category:'フルーツ系',price:400,cost: 93,sortOrder: 5,isActive:true},
    {name:'ピーナツバターサンド',   category:'その他',    price:270,cost: 83,sortOrder: 6,isActive:true},
    {name:'照り焼きチキンサンド',   category:'惣菜系',    price:440,cost:126,sortOrder: 7,isActive:true},
    {name:'ハムタマゴサンド',       category:'惣菜系',    price:410,cost:131,sortOrder: 8,isActive:true},
    {name:'ツナサラダサンド',       category:'惣菜系',    price:380,cost:117,sortOrder: 9,isActive:true},
    {name:'ハム野菜サンド',         category:'惣菜系',    price:380,cost:108,sortOrder:10,isActive:true},
    {name:'メンチカツサンド',       category:'揚げ物系',  price:480,cost:139,sortOrder:11,isActive:true},
    {name:'味噌カツサンド',         category:'揚げ物系',  price:480,cost:157,sortOrder:12,isActive:true},
    {name:'フィッシュサンド',       category:'揚げ物系',  price:380,cost:100,sortOrder:13,isActive:true},
    {name:'コロッケサンド',         category:'揚げ物系',  price:400,cost:118,sortOrder:14,isActive:true},
    {name:'タマゴサンド',           category:'惣菜系',    price:320,cost:111,sortOrder:15,isActive:true},
    {name:'タマゴ野菜サンド',       category:'惣菜系',    price:350,cost:113,sortOrder:16,isActive:true},
    {name:'ごぼうサラダサンド',     category:'惣菜系',    price:380,cost:115,sortOrder:17,isActive:true},
    {name:'アボカドサーモンサンド', category:'惣菜系',    price:530,cost:186,sortOrder:18,isActive:true},
    {name:'エビとブロッコリーのサンド',category:'惣菜系', price:480,cost:164,sortOrder:19,isActive:true},
    {name:'ポテトサンド',           category:'その他',    price:340,cost: 96,sortOrder:20,isActive:true},
    {name:'パストラミビーフサンド', category:'惣菜系',    price:430,cost:143,sortOrder:21,isActive:true},
  ];
  for (const p of products) await dbPut(STORES.PRODUCTS, p);
}

/* ---------- 起動 ---------- */
async function main() {
  await openDB();
  await seedProducts();
  applyFontSize(getSavedFontSize());
  updateDate();
  setInterval(updateDate, 60000);
  await navigateTo('dashboard');
}
main().catch(console.error);

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));

})().catch(console.error);