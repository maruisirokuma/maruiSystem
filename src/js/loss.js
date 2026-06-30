/**
 * loss.js - ロス計算画面
 * 商品ごとの割引(20%/30%/50%)とロス個数を入力し、各種合計を計算する
 */

import { dbGet, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr } from './app.js';

let products = [];
let rows = {}; // productId -> { d20, d30, d50, lossCount }

export async function initLoss(container) {
  products = await getActiveProducts();

  const today = todayStr();
  const existing = await dbGet(STORES.LOSS, today);

  rows = {};
  if (existing) {
    existing.items.forEach(item => {
      rows[item.productId] = {
        d20: item.discount20 || 0,
        d30: item.discount30 || 0,
        d50: item.discount50 || 0,
        lossCount: item.lossCount || 0,
      };
    });
  }
  products.forEach(p => {
    if (!rows[p.id]) rows[p.id] = { d20: 0, d30: 0, d50: 0, lossCount: 0 };
  });

  render(container);
}

/** 1商品分の割引金額・ロス金額を計算 */
function calcItem(p, r) {
  // 割引金額 = 各割引率の個数 × 価格 × 割引率
  const discountPrice =
    Math.round(r.d20 * p.price * 0.20) +
    Math.round(r.d30 * p.price * 0.30) +
    Math.round(r.d50 * p.price * 0.50);
  const lossPrice = r.lossCount * p.price;
  return { discountPrice, lossPrice };
}

function calcTotals() {
  let total20 = 0, total30 = 0, total50 = 0;
  let totalDiscount = 0;
  let totalLossCount = 0;
  let totalLossPrice = 0;

  products.forEach(p => {
    const r = rows[p.id];
    const { discountPrice, lossPrice } = calcItem(p, r);
    total20 += r.d20;
    total30 += r.d30;
    total50 += r.d50;
    totalDiscount += discountPrice;
    totalLossCount += r.lossCount;
    totalLossPrice += lossPrice;
  });

  return { total20, total30, total50, totalDiscount, totalLossCount, totalLossPrice };
}

function render(container) {
  const t = calcTotals();

  container.innerHTML = `
    <div class="page page-enter">
      ${products.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📉</div>
          <div class="empty-state-text">商品が登録されていません。<br>商品管理画面で商品を追加してください。</div>
        </div>
      ` : `
        <div class="card">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>品名</th>
                  <th>20%</th>
                  <th>30%</th>
                  <th>50%</th>
                  <th>割引金額</th>
                  <th>ロス</th>
                  <th>ロス金額</th>
                </tr>
              </thead>
              <tbody id="lossBody">
                ${products.map(p => rowHtml(p)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="summary-bar">
          <div class="summary-row"><span>総20%</span><span class="summary-value" id="total20">${t.total20}個</span></div>
          <div class="summary-row"><span>総30%</span><span class="summary-value" id="total30">${t.total30}個</span></div>
          <div class="summary-row"><span>総50%</span><span class="summary-value" id="total50">${t.total50}個</span></div>
          <div class="summary-row"><span>総割引金額</span><span class="summary-value" id="totalDiscount">${t.totalDiscount.toLocaleString()}円</span></div>
          <div class="summary-row"><span>総ロス個数</span><span class="summary-value" id="totalLossCount">${t.totalLossCount}個</span></div>
          <div class="summary-row total"><span>総ロス金額</span><span class="summary-value" id="totalLossPrice">${t.totalLossPrice.toLocaleString()}円</span></div>
        </div>

        <button class="btn btn-primary btn-full" id="saveBtn">保存</button>
      `}
    </div>
  `;

  if (products.length > 0) bindEvents(container);
}

function rowHtml(p) {
  const r = rows[p.id];
  const { discountPrice, lossPrice } = calcItem(p, r);
  return `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.name)}</td>
      <td><input type="number" class="timeline-input cell-input" style="width:48px; height:36px; font-size:14px;" data-field="d20" data-id="${p.id}" value="${r.d20}" min="0" inputmode="numeric" /></td>
      <td><input type="number" class="timeline-input cell-input" style="width:48px; height:36px; font-size:14px;" data-field="d30" data-id="${p.id}" value="${r.d30}" min="0" inputmode="numeric" /></td>
      <td><input type="number" class="timeline-input cell-input" style="width:48px; height:36px; font-size:14px;" data-field="d50" data-id="${p.id}" value="${r.d50}" min="0" inputmode="numeric" /></td>
      <td class="discount-price-cell" data-id="${p.id}">${discountPrice.toLocaleString()}円</td>
      <td><input type="number" class="timeline-input cell-input" style="width:48px; height:36px; font-size:14px;" data-field="lossCount" data-id="${p.id}" value="${r.lossCount}" min="0" inputmode="numeric" /></td>
      <td class="loss-price-cell" data-id="${p.id}">${lossPrice.toLocaleString()}円</td>
    </tr>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function bindEvents(container) {
  container.querySelectorAll('.cell-input').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.id;
      const field = input.dataset.field;
      const value = Math.max(0, Number(input.value) || 0);
      rows[id][field] = value;
      input.value = value;
      refreshRow(container, id);
      refreshTotals(container);
    });
  });

  container.querySelector('#saveBtn').addEventListener('click', async () => {
    await saveData();
    showToast('✅ 保存しました');
  });
}

function refreshRow(container, productId) {
  const p = products.find(p => p.id == productId);
  const r = rows[productId];
  const { discountPrice, lossPrice } = calcItem(p, r);
  container.querySelector(`.discount-price-cell[data-id="${productId}"]`).textContent = discountPrice.toLocaleString() + '円';
  container.querySelector(`.loss-price-cell[data-id="${productId}"]`).textContent = lossPrice.toLocaleString() + '円';
}

function refreshTotals(container) {
  const t = calcTotals();
  container.querySelector('#total20').textContent = `${t.total20}個`;
  container.querySelector('#total30').textContent = `${t.total30}個`;
  container.querySelector('#total50').textContent = `${t.total50}個`;
  container.querySelector('#totalDiscount').textContent = `${t.totalDiscount.toLocaleString()}円`;
  container.querySelector('#totalLossCount').textContent = `${t.totalLossCount}個`;
  container.querySelector('#totalLossPrice').textContent = `${t.totalLossPrice.toLocaleString()}円`;
}

async function saveData() {
  const t = calcTotals();
  const items = products
    .filter(p => {
      const r = rows[p.id];
      return r.d20 > 0 || r.d30 > 0 || r.d50 > 0 || r.lossCount > 0;
    })
    .map(p => {
      const r = rows[p.id];
      const { discountPrice, lossPrice } = calcItem(p, r);
      return {
        productId: p.id,
        discount20: r.d20,
        discount30: r.d30,
        discount50: r.d50,
        discountPrice,
        lossCount: r.lossCount,
        lossPrice,
      };
    });

  await dbPut(STORES.LOSS, {
    date: todayStr(),
    items,
    total20: t.total20,
    total30: t.total30,
    total50: t.total50,
    totalDiscount: t.totalDiscount,
    totalLossCount: t.totalLossCount,
    totalLossPrice: t.totalLossPrice,
  });
}