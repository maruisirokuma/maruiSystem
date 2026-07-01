/**
 * manufacture.js - 製造計算画面
 * 商品ごとの製造個数を入力し、小計・総製造数・総額を計算する
 */

import { dbGet, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr } from './app.js';

let products = [];
let counts = {};      // productId -> count
let history = [];      // 元に戻す用の履歴スタック
let savedSnapshot = null;

export async function initManufacture(container) {
  products = await getActiveProducts();

  // 当日の保存データがあれば復元
  const today = todayStr();
  const existing = await dbGet(STORES.MANUFACTURE, today);

  counts = {};
  if (existing) {
    existing.items.forEach(item => {
      counts[item.productId] = item.count;
    });
  } else {
    products.forEach(p => { counts[p.id] = 0; });
  }

  history = [];
  savedSnapshot = JSON.stringify(counts);

  render(container);
}

function calcTotals() {
  let totalCount = 0;
  let totalPrice = 0;
  products.forEach(p => {
    const c = counts[p.id] || 0;
    totalCount += c;
    totalPrice += c * p.price;
  });
  return { totalCount, totalPrice };
}

function render(container) {
  const { totalCount, totalPrice } = calcTotals();

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
            <table class="data-table">
              <thead>
                <tr>
                  <th>品名</th>
                  <th>税込価格</th>
                  <th>製造個数</th>
                  <th>小計</th>
                </tr>
              </thead>
              <tbody id="manufactureBody">
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
          <button class="btn btn-ghost" id="undoBtn" ${history.length === 0 ? 'disabled' : ''}>↩ 元に戻す</button>
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
      <td>${p.price}円</td>
      <td>
        <div class="qty-spinner">
          <button class="qty-btn minus-btn" data-id="${p.id}" aria-label="減らす">－</button>
          <input type="number" class="qty-input count-input" data-id="${p.id}" value="${count}" min="0" inputmode="numeric" />
          <button class="qty-btn plus-btn" data-id="${p.id}" aria-label="増やす">＋</button>
        </div>
      </td>
      <td class="subtotal-cell" data-id="${p.id}">${subtotal.toLocaleString()}円</td>
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
  if (history.length > 20) history.shift(); // 履歴は最大20件
}

function updateCount(container, productId, newValue) {
  const v = Math.max(0, Number(newValue) || 0);
  pushHistory();
  counts[productId] = v;
  refreshRow(container, productId);
  refreshTotals(container);
  refreshUndoButton(container);
}

function refreshRow(container, productId) {
  const input = container.querySelector(`.count-input[data-id="${productId}"]`);
  const subtotalCell = container.querySelector(`.subtotal-cell[data-id="${productId}"]`);
  const product = products.find(p => p.id == productId);
  if (input) input.value = counts[productId] || 0;
  if (subtotalCell && product) {
    subtotalCell.textContent = ((counts[productId] || 0) * product.price).toLocaleString() + '円';
  }
}

function refreshTotals(container) {
  const { totalCount, totalPrice } = calcTotals();
  const totalCountEl = container.querySelector('#totalCount');
  const totalPriceEl = container.querySelector('#totalPrice');
  if (totalCountEl) totalCountEl.textContent = `${totalCount}個`;
  if (totalPriceEl) totalPriceEl.textContent = `${totalPrice.toLocaleString()}円`;
}

function refreshUndoButton(container) {
  const undoBtn = container.querySelector('#undoBtn');
  if (undoBtn) undoBtn.disabled = history.length === 0;
}

function bindEvents(container) {
  // ＋ボタン
  container.querySelectorAll('.plus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      updateCount(container, id, (counts[id] || 0) + 1);
    });
  });

  // －ボタン
  container.querySelectorAll('.minus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      updateCount(container, id, (counts[id] || 0) - 1);
    });
  });

  // 直接入力
  container.querySelectorAll('.count-input').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.id;
      updateCount(container, id, input.value);
    });
  });

  // 元に戻す
  const undoBtn = container.querySelector('#undoBtn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (history.length === 0) return;
      counts = JSON.parse(history.pop());
      render(container);
    });
  }

  // クリア
  container.querySelector('#clearBtn').addEventListener('click', async () => {
    if (!confirm('入力内容をクリアしますか？（自動保存されます）')) return;
    await saveData(); // クリア前に自動保存
    pushHistory();
    products.forEach(p => { counts[p.id] = 0; });
    render(container);
    showToast('✅ クリアしました（自動保存済み）');
  });

  // 保存
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

  savedSnapshot = JSON.stringify(counts);
}
