/**
 * manufacture.js - 製造計算画面
 * 修正：小計の表示ずれ修正、元に戻すボタンの見た目改善
 */

import { dbGet, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr } from './app.js';

let products = [];
let counts = {};
let history = [];

export async function initManufacture(container) {
  products = await getActiveProducts();
  const today = todayStr();
  const existing = await dbGet(STORES.MANUFACTURE, today);

  counts = {};
  products.forEach(p => { counts[p.id] = 0; });
  if (existing) {
    existing.items.forEach(item => {
      counts[item.productId] = item.count;
    });
  }

  history = [];
  render(container);
}

function calcTotals() {
  let totalCount = 0, totalPrice = 0;
  products.forEach(p => {
    const c = counts[p.id] || 0;
    totalCount += c;
    totalPrice += c * p.price;
  });
  return { totalCount, totalPrice };
}

function render(container) {
  const { totalCount, totalPrice } = calcTotals();
  const hasHistory = history.length > 0;

  container.innerHTML = `
    <div class="page page-enter">
      ${products.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">🏭</div>
          <div class="empty-state-text">商品が登録されていません。<br>商品管理画面で商品を追加してください。</div>
        </div>
      ` : `
        <div class="card">
          <div class="data-table-wrap">
            <table class="data-table manufacture-table">
              <colgroup>
                <col style="width:35%">
                <col style="width:18%">
                <col style="width:28%">
                <col style="width:19%">
              </colgroup>
              <thead>
                <tr>
                  <th style="text-align:left;">品名</th>
                  <th>税込価格</th>
                  <th>製造個数</th>
                  <th>小計</th>
                </tr>
              </thead>
              <tbody>
                ${products.map(p => rowHtml(p)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="summary-bar">
          <div class="summary-row">
            <span>総製造数</span>
            <span class="summary-value" id="totalCount">${totalCount}個</span>
          </div>
          <div class="summary-row total">
            <span>総額</span>
            <span class="summary-value" id="totalPrice">${totalPrice.toLocaleString()}円</span>
          </div>
        </div>

        <div class="btn-group mb-md">
          <button class="btn ${hasHistory ? 'btn-outline' : 'btn-ghost'}" id="undoBtn" ${hasHistory ? '' : 'disabled'}
            style="${hasHistory ? '' : 'opacity:0.35; cursor:not-allowed;'}">
            ↩ 元に戻す${hasHistory ? `（${history.length}）` : ''}
          </button>
          <button class="btn btn-outline" id="clearBtn">クリア</button>
        </div>
        <button class="btn btn-primary btn-full" id="saveBtn">保存</button>
      `}
    </div>
  `;

  if (products.length > 0) bindEvents(container);
}

function rowHtml(p) {
  const count = counts[p.id] || 0;
  const subtotal = count * p.price;
  return `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.name)}</td>
      <td style="text-align:center;">${p.price}円</td>
      <td style="text-align:center;">
        <div class="qty-spinner" style="margin:0 auto;">
          <button class="qty-btn minus-btn" data-id="${p.id}">－</button>
          <input type="number" class="qty-input count-input" data-id="${p.id}"
            value="${count}" min="0" inputmode="numeric" />
          <button class="qty-btn plus-btn" data-id="${p.id}">＋</button>
        </div>
      </td>
      <td class="subtotal-cell" data-id="${p.id}" style="text-align:right; font-weight:700; padding-right:8px;">
        ${subtotal.toLocaleString()}円
      </td>
    </tr>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function pushHistory() {
  history.push(JSON.stringify(counts));
  if (history.length > 20) history.shift();
}

function updateCount(container, productId, newValue) {
  const v = Math.max(0, Number(newValue) || 0);
  pushHistory();
  counts[productId] = v;
  // DOM部分更新（再レンダリングせず）
  const input = container.querySelector(`.count-input[data-id="${productId}"]`);
  const subtotalCell = container.querySelector(`.subtotal-cell[data-id="${productId}"]`);
  const product = products.find(p => p.id == productId);
  if (input) input.value = v;
  if (subtotalCell && product) {
    subtotalCell.textContent = (v * product.price).toLocaleString() + '円';
  }
  refreshTotals(container);
  refreshUndoButton(container);
}

function refreshTotals(container) {
  const { totalCount, totalPrice } = calcTotals();
  const el1 = container.querySelector('#totalCount');
  const el2 = container.querySelector('#totalPrice');
  if (el1) el1.textContent = `${totalCount}個`;
  if (el2) el2.textContent = `${totalPrice.toLocaleString()}円`;
}

function refreshUndoButton(container) {
  const btn = container.querySelector('#undoBtn');
  if (!btn) return;
  const hasHistory = history.length > 0;
  btn.disabled = !hasHistory;
  btn.className = `btn ${hasHistory ? 'btn-outline' : 'btn-ghost'}`;
  btn.style.opacity = hasHistory ? '1' : '0.35';
  btn.style.cursor = hasHistory ? 'pointer' : 'not-allowed';
  btn.textContent = `↩ 元に戻す${hasHistory ? `（${history.length}）` : ''}`;
}

function bindEvents(container) {
  container.querySelectorAll('.plus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      updateCount(container, btn.dataset.id, (counts[btn.dataset.id] || 0) + 1);
    });
  });

  container.querySelectorAll('.minus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      updateCount(container, btn.dataset.id, (counts[btn.dataset.id] || 0) - 1);
    });
  });

  container.querySelectorAll('.count-input').forEach(input => {
    input.addEventListener('change', () => {
      updateCount(container, input.dataset.id, input.value);
    });
  });

  container.querySelector('#undoBtn').addEventListener('click', () => {
    if (history.length === 0) return;
    counts = JSON.parse(history.pop());
    render(container);
  });

  container.querySelector('#clearBtn').addEventListener('click', async () => {
    if (!confirm('入力内容をクリアしますか？（自動保存されます）')) return;
    await saveData();
    pushHistory();
    products.forEach(p => { counts[p.id] = 0; });
    render(container);
    showToast('✅ クリアしました（自動保存済み）');
  });

  container.querySelector('#saveBtn').addEventListener('click', async () => {
    await saveData();
    showToast('✅ 保存しました');
  });
}

async function saveData() {
  const { totalCount, totalPrice } = calcTotals();
  const items = products
    .filter(p => (counts[p.id] || 0) > 0)
    .map(p => ({
      productId: p.id,
      count: counts[p.id],
      subtotal: counts[p.id] * p.price,
    }));

  await dbPut(STORES.MANUFACTURE, {
    date: todayStr(),
    items,
    totalCount,
    totalPrice,
    updatedAt: new Date().toISOString(),
  });
}
