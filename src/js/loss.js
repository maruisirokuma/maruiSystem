/**
 * loss.js - ロス計算画面
 * 修正：
 *  - Enterキーで次セルへフォーカス移動
 *  - 合計ラベル「総20%」→「20%割引個数」
 *  - 総ロス金額を強調しない（同サイズ）
 *  - 割引セクションとロスセクションを線で分割
 */

import { dbGet, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr } from './app.js';

let products = [];
let rows = {};

export async function initLoss(container) {
  products = await getActiveProducts();
  const today = todayStr();
  const existing = await dbGet(STORES.LOSS, today);

  rows = {};
  products.forEach(p => { rows[p.id] = { d20: 0, d30: 0, d50: 0, lossCount: 0 }; });
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

  render(container);
}

function calcItem(p, r) {
  const discountPrice =
    Math.round(r.d20 * p.price * 0.20) +
    Math.round(r.d30 * p.price * 0.30) +
    Math.round(r.d50 * p.price * 0.50);
  const lossPrice = r.lossCount * p.price;
  return { discountPrice, lossPrice };
}

function calcTotals() {
  let total20 = 0, total30 = 0, total50 = 0;
  let totalDiscount = 0, totalLossCount = 0, totalLossPrice = 0;
  products.forEach(p => {
    const r = rows[p.id];
    const { discountPrice, lossPrice } = calcItem(p, r);
    total20 += r.d20; total30 += r.d30; total50 += r.d50;
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
            <table class="data-table loss-table">
              <colgroup>
                <col style="width:24%">
                <col style="width:9%">
                <col style="width:9%">
                <col style="width:9%">
                <col style="width:15%">
                <col style="width:9%">
                <col style="width:15%">
              </colgroup>
              <thead>
                <tr>
                  <th style="text-align:left;">品名</th>
                  <th>20%</th>
                  <th>30%</th>
                  <th>50%</th>
                  <th>割引金額</th>
                  <th>ロス</th>
                  <th>ロス金額</th>
                </tr>
              </thead>
              <tbody>
                ${products.map((p, i) => rowHtml(p, i)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 割引セクション -->
        <div class="summary-bar">
          <div class="summary-section-label">── 割引 ──</div>
          <div class="summary-row">
            <span>20%割引個数</span>
            <span class="summary-value" id="total20">${t.total20}個</span>
          </div>
          <div class="summary-row">
            <span>30%割引個数</span>
            <span class="summary-value" id="total30">${t.total30}個</span>
          </div>
          <div class="summary-row">
            <span>50%割引個数</span>
            <span class="summary-value" id="total50">${t.total50}個</span>
          </div>
          <div class="summary-row">
            <span>総割引金額</span>
            <span class="summary-value" id="totalDiscount">${t.totalDiscount.toLocaleString()}円</span>
          </div>

          <!-- 区切り線 -->
          <div class="summary-divider"></div>

          <!-- ロスセクション -->
          <div class="summary-section-label">── ロス ──</div>
          <div class="summary-row">
            <span>ロス個数</span>
            <span class="summary-value" id="totalLossCount">${t.totalLossCount}個</span>
          </div>
          <div class="summary-row">
            <span>ロス金額</span>
            <span class="summary-value" id="totalLossPrice">${t.totalLossPrice.toLocaleString()}円</span>
          </div>
        </div>

        <button class="btn btn-primary btn-full" id="saveBtn">保存</button>
      `}
    </div>
  `;

  if (products.length > 0) bindEvents(container);
}

function cellInput(field, productId, value, tabIndex) {
  return `<input type="number"
    class="loss-cell-input"
    data-field="${field}"
    data-id="${productId}"
    value="${value}"
    min="0"
    inputmode="numeric"
    tabindex="${tabIndex}"
    style="width:100%; height:36px; border:1.5px solid var(--border);
           border-radius:4px; text-align:center; font-size:15px;
           font-weight:600; font-family:inherit; background:#fff;
           -moz-appearance:textfield;"
  />`;
}

function rowHtml(p, rowIndex) {
  const r = rows[p.id];
  const { discountPrice, lossPrice } = calcItem(p, r);
  // tabindex: 行×4 + 列(0〜3)  → Enterで順に移動
  const base = rowIndex * 4;
  return `
    <tr data-id="${p.id}">
      <td style="font-size:13px; font-weight:500;">${escapeHtml(p.name)}</td>
      <td>${cellInput('d20',       p.id, r.d20,       base+1)}</td>
      <td>${cellInput('d30',       p.id, r.d30,       base+2)}</td>
      <td>${cellInput('d50',       p.id, r.d50,       base+3)}</td>
      <td class="discount-price-cell" data-id="${p.id}" style="text-align:right; font-size:13px;">${discountPrice.toLocaleString()}円</td>
      <td>${cellInput('lossCount', p.id, r.lossCount, base+4)}</td>
      <td class="loss-price-cell" data-id="${p.id}" style="text-align:right; font-size:13px;">${lossPrice.toLocaleString()}円</td>
    </tr>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function bindEvents(container) {
  // 全入力セルをフラットなリストで取得（tabindex順）
  const allInputs = [...container.querySelectorAll('.loss-cell-input')]
    .sort((a, b) => Number(a.tabIndex) - Number(b.tabIndex));

  allInputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      const id = input.dataset.id;
      const field = input.dataset.field;
      rows[id][field] = Math.max(0, Number(input.value) || 0);
      refreshRow(container, id);
      refreshTotals(container);
    });

    input.addEventListener('change', () => {
      const v = Math.max(0, Number(input.value) || 0);
      input.value = v;
      rows[input.dataset.id][input.dataset.field] = v;
    });

    // Enter / Tab で次のセルへ
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = allInputs[idx + 1];
        if (next) {
          next.focus();
          next.select();
        }
      }
    });

    // フォーカス時に全選択（入力しやすく）
    input.addEventListener('focus', () => input.select());
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
  const dc = container.querySelector(`.discount-price-cell[data-id="${productId}"]`);
  const lc = container.querySelector(`.loss-price-cell[data-id="${productId}"]`);
  if (dc) dc.textContent = discountPrice.toLocaleString() + '円';
  if (lc) lc.textContent = lossPrice.toLocaleString() + '円';
}

function refreshTotals(container) {
  const t = calcTotals();
  const set = (id, val) => { const el = container.querySelector(id); if (el) el.textContent = val; };
  set('#total20',        `${t.total20}個`);
  set('#total30',        `${t.total30}個`);
  set('#total50',        `${t.total50}個`);
  set('#totalDiscount',  `${t.totalDiscount.toLocaleString()}円`);
  set('#totalLossCount', `${t.totalLossCount}個`);
  set('#totalLossPrice', `${t.totalLossPrice.toLocaleString()}円`);
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
        discount20: r.d20, discount30: r.d30, discount50: r.d50,
        discountPrice, lossCount: r.lossCount, lossPrice,
      };
    });

  await dbPut(STORES.LOSS, {
    date: todayStr(), items,
    total20: t.total20, total30: t.total30, total50: t.total50,
    totalDiscount: t.totalDiscount,
    totalLossCount: t.totalLossCount,
    totalLossPrice: t.totalLossPrice,
  });
}
