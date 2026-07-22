/**
 * manufacture.js - 製造計算
 * ±5/±1スピナー・右下固定保存ボタン・過去データ参照
 */
import { dbGet, dbGetAll, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr, getWeekdayStr, escHtml } from './app.js';

let products=[], counts={}, history=[];

export async function initManufacture(container) {
  products = await getActiveProducts();
  const today = todayStr();
  const existing = await dbGet(STORES.MFG, today);
  counts={};
  products.forEach(p=>{ counts[p.id]=0; });
  if(existing) existing.items.forEach(i=>{ counts[i.productId]=i.count; });
  history=[];
  render(container);
}

function calcTotals() {
  let cnt=0,price=0;
  products.forEach(p=>{ const c=counts[p.id]||0; cnt+=c; price+=c*p.price; });
  return {cnt,price};
}

function render(container) {
  const {cnt,price}=calcTotals();
  const hasBig = history.length>0;

  container.innerHTML=`
    <div class="page">
      ${products.length===0?emptyState('🏭','製造計算','商品管理で商品を追加してください'):`
        <!-- 履歴ボタン -->
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="btn btn-ghost btn-sm" id="histBtn">📅 過去データ</button>
        </div>

        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl">
              <colgroup><col style="width:34%"><col style="width:16%"><col style="width:36%"><col style="width:14%"></colgroup>
              <thead><tr><th>品名</th><th>価格</th><th>製造個数</th><th>小計</th></tr></thead>
              <tbody>
                ${products.map(p=>mfgRow(p)).join('')}
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

  if(products.length>0) bindMfgEvents(container);
}

function mfgRow(p) {
  const c=counts[p.id]||0;
  return `
    <tr data-id="${p.id}">
      <td>${escHtml(p.name)}</td>
      <td style="text-align:center;">${p.price}円</td>
      <td>
        <div class="qty-wrap" style="margin:0 auto;width:fit-content;">
          <div class="qty-5-row">
            <button class="qty-btn" data-step="-5" data-id="${p.id}">－5</button>
            <button class="qty-btn" data-step="+5" data-id="${p.id}">＋5</button>
          </div>
          <div class="qty-1-row">
            <button class="qty-btn" data-step="-1" data-id="${p.id}">－</button>
            <input type="number" class="qty-display count-input" data-id="${p.id}" value="${c}" min="0" inputmode="numeric"/>
            <button class="qty-btn" data-step="+1" data-id="${p.id}">＋</button>
          </div>
        </div>
      </td>
      <td class="subtotal" data-id="${p.id}" style="text-align:right;font-weight:700;">${(c*p.price).toLocaleString()}円</td>
    </tr>`;
}

function bindMfgEvents(container) {
  // スピナーボタン
  container.querySelectorAll('.qty-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.dataset.id, step=Number(btn.dataset.step);
      pushHistory();
      counts[id]=Math.max(0,(counts[id]||0)+step);
      refreshRow(container,id);
      refreshTotals(container);
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
      refreshTotals(container);
      refreshUndo(container);
    });
  });
  // 元に戻す
  container.querySelector('#undoBtn').addEventListener('click',()=>{
    if(!history.length) return;
    counts=JSON.parse(history.pop());
    render(container);
  });
  // クリア
  container.querySelector('#clearBtn').addEventListener('click',async()=>{
    if(!confirm('クリアしますか？（現在のデータは自動保存されます）')) return;
    await saveData(); pushHistory();
    products.forEach(p=>{ counts[p.id]=0; });
    render(container); showToast('✅ クリアしました（自動保存済み）');
  });
  // 保存
  container.querySelector('#saveBtn').addEventListener('click',async()=>{
    await saveData(); showToast('✅ 保存しました');
  });
  // 過去データ
  container.querySelector('#histBtn').addEventListener('click',async()=>{
    await showHistory(container);
  });
  container.querySelector('#histClose').addEventListener('click',()=>{
    container.querySelector('#histModal').classList.add('d-none');
  });
}

function refreshRow(container, id) {
  const p=products.find(p=>p.id==id);
  const c=counts[id]||0;
  const inp=container.querySelector(`.count-input[data-id="${id}"]`);
  const sub=container.querySelector(`.subtotal[data-id="${id}"]`);
  if(inp) inp.value=c;
  if(sub && p) sub.textContent=`${(c*p.price).toLocaleString()}円`;
}
function refreshTotals(container) {
  const {cnt,price}=calcTotals();
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

async function saveData() {
  const {cnt,price}=calcTotals();
  const items=products.filter(p=>(counts[p.id]||0)>0).map(p=>({productId:p.id,count:counts[p.id],subtotal:counts[p.id]*p.price}));
  await dbPut(STORES.MFG,{date:todayStr(),weekday:getCurrentWeekday(),items,totalCount:cnt,totalPrice:price,updatedAt:new Date().toISOString()});
}

function getCurrentWeekday() {
  const days=['日','月','火','水','木','金','土'];
  return days[new Date().getDay()];
}

async function showHistory(container) {
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
        products.forEach(p=>{ counts[p.id]=0; });
        (rec.items||[]).forEach(i=>{ counts[i.productId]=i.count; });
        container.querySelector('#histModal').classList.add('d-none');
        render(container);
        showToast(`✅ ${fmtDateJP(rec.date)}のデータを読み込みました`);
      });
    });
  }
  container.querySelector('#histModal').classList.remove('d-none');
}

function fmtDateJP(d) { const [,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }
function emptyState(icon,title,desc) { return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${title}：${desc}</div></div>`; }
