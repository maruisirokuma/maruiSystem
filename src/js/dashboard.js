/** dashboard.js - ダッシュボード */
import { dbGet, dbGetAll, STORES, getActiveProducts } from './db.js';
import { todayStr, getWeekdayStr, nowTimeStr, escHtml } from './app.js';
import { predictSoldOut, getDiscountRecommendation, calcIdealStock, getWeekdayAverageStock, generateTimeSlots } from './predict.js';

export async function initDashboard(container) {
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
