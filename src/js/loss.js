/**
 * loss.js - ロス計算
 * 割引タブ / ロスタブ切替・±1スピナー・右下固定保存・過去データ参照
 */
import { dbGet, dbGetAll, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr, getWeekdayStr, escHtml } from './app.js';

let products=[], rows={}, currentTab='discount';

export async function initLoss(container) {
  products = await getActiveProducts();
  const today = todayStr();
  const existing = await dbGet(STORES.LOSS, today);
  rows={};
  products.forEach(p=>{ rows[p.id]={d20:0,d30:0,d50:0,lossCount:0}; });
  if(existing) existing.items.forEach(i=>{
    rows[i.productId]={d20:i.discount20||0,d30:i.discount30||0,d50:i.discount50||0,lossCount:i.lossCount||0};
  });
  currentTab='discount';
  render(container);
}

/* ---- 計算 ---- */
function calcItem(p,r) {
  const disc=Math.round(r.d20*p.price*.2)+Math.round(r.d30*p.price*.3)+Math.round(r.d50*p.price*.5);
  return { disc, lossPrice:r.lossCount*p.price };
}
function calcTotals() {
  let t20=0,t30=0,t50=0,tDisc=0,tLC=0,tLP=0;
  products.forEach(p=>{ const r=rows[p.id]; const {disc,lossPrice}=calcItem(p,r);
    t20+=r.d20; t30+=r.d30; t50+=r.d50; tDisc+=disc; tLC+=r.lossCount; tLP+=lossPrice; });
  return {t20,t30,t50,tDisc,tLC,tLP};
}

/* ---- レンダリング ---- */
function render(container) {
  const t=calcTotals();
  container.innerHTML=`
    <div class="page">
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="btn btn-ghost btn-sm" id="histBtn">📅 過去データ</button>
      </div>

      <!-- タブ -->
      <div class="tab-bar">
        <button class="tab-btn ${currentTab==='discount'?'active':''}" data-tab="discount">🏷️ 割引計算</button>
        <button class="tab-btn ${currentTab==='loss'?'active':''}"     data-tab="loss">📉 ロス計算</button>
      </div>

      ${products.length===0
        ? '<div class="empty-state"><div class="empty-icon">📉</div><div class="empty-text">商品管理で商品を追加してください</div></div>'
        : currentTab==='discount' ? renderDiscountTab(t) : renderLossTab(t)
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
  bindEvents(container);
}

function renderDiscountTab(t) {
  return `
    <div class="card">
      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup><col style="width:30%"><col style="width:23%"><col style="width:23%"><col style="width:24%"></colgroup>
          <thead><tr><th>品名</th><th>20%</th><th>30%</th><th>50%</th></tr></thead>
          <tbody>
            ${products.map(p=>{
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
        <table class="tbl">
          <colgroup><col style="width:35%"><col style="width:35%"><col style="width:30%"></colgroup>
          <thead><tr><th>品名</th><th>ロス個数</th><th>ロス金額</th></tr></thead>
          <tbody>
            ${products.map(p=>{
              const r=rows[p.id];
              const {lossPrice}=calcItem(p,r);
              return `<tr data-id="${p.id}">
                <td>${escHtml(p.name)}</td>
                <td style="padding:6px 4px;">${lossSpinner(p.id,'lossCount',r.lossCount)}</td>
                <td class="loss-price" data-id="${p.id}" style="text-align:right;font-weight:700;padding:8px 6px;">${lossPrice.toLocaleString()}円</td>
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

function bindEvents(container) {
  // タブ切替
  container.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ currentTab=btn.dataset.tab; render(container); });
  });

  // スピナーボタン
  container.querySelectorAll('.loss-qty-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const {id,field,step}=btn.dataset;
      rows[id][field]=Math.max(0,(rows[id][field]||0)+Number(step));
      // 対応するinputを更新
      const inp=container.querySelector(`.loss-inp[data-id="${id}"][data-field="${field}"]`);
      if(inp) inp.value=rows[id][field];
      refreshTotals(container);
      if(field==='lossCount') refreshLossPrice(container,id);
    });
  });

  // 直接入力
  container.querySelectorAll('.loss-inp').forEach(inp=>{
    inp.addEventListener('change',()=>{
      const {id,field}=inp.dataset;
      rows[id][field]=Math.max(0,Number(inp.value)||0);
      inp.value=rows[id][field];
      refreshTotals(container);
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
    await saveData(); showToast('✅ 保存しました');
  });

  // 過去データ
  container.querySelector('#histBtn').addEventListener('click',()=>showHistory(container));
  container.querySelector('#histClose').addEventListener('click',()=>{
    container.querySelector('#histModal').classList.add('d-none');
  });
}

function refreshTotals(container) {
  const t=calcTotals();
  const set=(id,val)=>{ const el=container.querySelector(id); if(el) el.textContent=val; };
  set('#t20',`${t.t20}個`); set('#t30',`${t.t30}個`); set('#t50',`${t.t50}個`);
  set('#tDisc',`${t.tDisc.toLocaleString()}円`);
  set('#tLC',`${t.tLC}個`); set('#tLP',`${t.tLP.toLocaleString()}円`);
}
function refreshLossPrice(container, id) {
  const p=products.find(p=>p.id==id);
  const el=container.querySelector(`.loss-price[data-id="${id}"]`);
  if(el && p) el.textContent=`${(rows[id].lossCount*p.price).toLocaleString()}円`;
}

async function saveData() {
  const t=calcTotals();
  const items=products.filter(p=>{ const r=rows[p.id]; return r.d20||r.d30||r.d50||r.lossCount; })
    .map(p=>{ const r=rows[p.id]; const {disc,lossPrice}=calcItem(p,r);
      return {productId:p.id,discount20:r.d20,discount30:r.d30,discount50:r.d50,
              discountPrice:disc,lossCount:r.lossCount,lossPrice}; });
  await dbPut(STORES.LOSS,{date:todayStr(),weekday:getWeekdayStr(),items,
    total20:t.t20,total30:t.t30,total50:t.t50,totalDiscount:t.tDisc,
    totalLossCount:t.tLC,totalLossPrice:t.tLP});
}

async function showHistory(container) {
  const all=await dbGetAll(STORES.LOSS);
  const today=todayStr();
  const past=all.filter(r=>r.date!==today).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  const listEl=container.querySelector('#histList');
  listEl.innerHTML=past.length===0
    ? '<div class="empty-state"><div class="empty-text">過去データがありません</div></div>'
    : past.map(r=>`<div class="history-item" data-date="${r.date}">
        <div class="history-date">${fmtJP(r.date)}（${r.weekday||getWeekdayStr(r.date)}）</div>
        <div class="history-meta">割引${r.totalDiscount?.toLocaleString()||0}円 ロス${r.totalLossCount||0}個/${(r.totalLossPrice||0).toLocaleString()}円</div>
      </div>`).join('');
  listEl.querySelectorAll('.history-item').forEach(el=>{
    el.addEventListener('click',()=>{
      const rec=past.find(r=>r.date===el.dataset.date); if(!rec) return;
      products.forEach(p=>{ rows[p.id]={d20:0,d30:0,d50:0,lossCount:0}; });
      (rec.items||[]).forEach(i=>{ rows[i.productId]={d20:i.discount20||0,d30:i.discount30||0,d50:i.discount50||0,lossCount:i.lossCount||0}; });
      container.querySelector('#histModal').classList.add('d-none');
      render(container); showToast(`✅ ${fmtJP(rec.date)}のデータを読み込みました`);
    });
  });
  container.querySelector('#histModal').classList.remove('d-none');
}

function fmtJP(d){ const [,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }
