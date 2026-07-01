/**
 * products.js - 商品管理画面
 * 商品の追加・編集・販売終了・並び替えを行う
 */

import { dbPut, dbDelete, getAllProducts } from './db.js';
import { showToast } from './app.js';

let products = [];
let draggingId = null;

export async function initProducts(container) {
  products = await getAllProducts();
  render(container);
}

function render(container) {
  const activeList = products.filter(p => p.isActive);
  const inactiveList = products.filter(p => !p.isActive);

  container.innerHTML = `
    <div class="page page-enter">
      <div class="card">
        <div class="card-header">
          <span class="card-header-icon">🛒</span>商品一覧
        </div>
        <div class="card-body" style="padding:0;">
          ${activeList.length === 0 ? emptyState() : activeList.map(p => productRow(p, true)).join('')}
        </div>
      </div>

      <button class="btn btn-primary btn-full mb-md" id="addProductBtn">
        ＋ 商品を追加
      </button>

      ${inactiveList.length > 0 ? `
        <div class="section-title">販売終了商品</div>
        <div class="card">
          <div class="card-body" style="padding:0;">
            ${inactiveList.map(p => productRow(p, false)).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <!-- 商品編集モーダル -->
    <div class="modal-overlay d-none" id="productModalOverlay">
      <div class="modal">
        <div class="modal-title" id="modalTitle">商品を追加</div>
        <form id="productForm">
          <input type="hidden" id="productId" />
          <div class="form-group">
            <label class="form-label">商品名</label>
            <input type="text" class="form-input" id="productName" required />
          </div>
          <div class="form-group">
            <label class="form-label">カテゴリ</label>
            <input type="text" class="form-input" id="productCategory" placeholder="例：サンドイッチ" />
          </div>
          <div class="form-group">
            <label class="form-label">税込価格（円）</label>
            <input type="number" class="form-input" id="productPrice" inputmode="numeric" required min="0" />
          </div>
          <div class="form-group">
            <label class="form-label">原価（円）</label>
            <input type="number" class="form-input" id="productCost" inputmode="numeric" required min="0" />
          </div>
          <div class="btn-group mt-md">
            <button type="button" class="btn btn-ghost" id="cancelModalBtn">キャンセル</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;

  bindEvents(container);
}

function emptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🥪</div>
      <div class="empty-state-text">商品が登録されていません</div>
    </div>
  `;
}

function productRow(p, isActive) {
  return `
    <div class="product-item ${isActive ? '' : 'product-inactive'}" draggable="${isActive}" data-id="${p.id}">
      ${isActive ? '<span style="cursor:grab; color:var(--text-hint); font-size:20px;">⠿</span>' : ''}
      <div class="product-info">
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-meta">
          ${p.category ? escapeHtml(p.category) + ' / ' : ''}${p.price}円（原価 ${p.cost}円）
        </div>
      </div>
      <div class="product-actions">
        <button class="btn btn-sm btn-outline edit-btn" data-id="${p.id}">編集</button>
        ${isActive
          ? `<button class="btn btn-sm btn-danger end-btn" data-id="${p.id}">終了</button>`
          : `<button class="btn btn-sm btn-primary restore-btn" data-id="${p.id}">復活</button>`}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function bindEvents(container) {
  const overlay = container.querySelector('#productModalOverlay');
  const form = container.querySelector('#productForm');
  const modalTitle = container.querySelector('#modalTitle');

  // 追加ボタン
  container.querySelector('#addProductBtn').addEventListener('click', () => {
    openModal(null);
  });

  // キャンセル
  container.querySelector('#cancelModalBtn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // 編集ボタン
  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const product = products.find(p => p.id === id);
      openModal(product);
    });
  });

  // 販売終了ボタン
  container.querySelectorAll('.end-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (!confirm('この商品を販売終了にしますか？')) return;
      const product = products.find(p => p.id === id);
      product.isActive = false;
      await dbPut('ProductMaster', product);
      showToast('✅ 販売終了にしました');
      products = await getAllProducts();
      render(container.closest('.main-content') || container.parentElement);
    });
  });

  // 復活ボタン
  container.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const product = products.find(p => p.id === id);
      product.isActive = true;
      await dbPut('ProductMaster', product);
      showToast('✅ 販売を再開しました');
      products = await getAllProducts();
      render(container.closest('.main-content') || container.parentElement);
    });
  });

  // フォーム送信
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = container.querySelector('#productId').value;
    const name = container.querySelector('#productName').value.trim();
    const category = container.querySelector('#productCategory').value.trim();
    const price = Number(container.querySelector('#productPrice').value);
    const cost = Number(container.querySelector('#productCost').value);

    if (!name) {
      showToast('商品名を入力してください');
      return;
    }

    if (idVal) {
      // 編集
      const product = products.find(p => p.id === Number(idVal));
      product.name = name;
      product.category = category;
      product.price = price;
      product.cost = cost;
      await dbPut('ProductMaster', product);
      showToast('✅ 商品を更新しました');
    } else {
      // 新規追加
      const maxOrder = products.reduce((max, p) => Math.max(max, p.sortOrder ?? 0), 0);
      await dbPut('ProductMaster', {
        name, category, price, cost,
        sortOrder: maxOrder + 1,
        isActive: true,
      });
      showToast('✅ 商品を追加しました');
    }

    closeModal();
    products = await getAllProducts();
    render(container.closest('.main-content') || container.parentElement);
  });

  // 並び替え（ドラッグ＆ドロップ）
  setupDragSort(container);

  function openModal(product) {
    modalTitle.textContent = product ? '商品を編集' : '商品を追加';
    container.querySelector('#productId').value = product ? product.id : '';
    container.querySelector('#productName').value = product ? product.name : '';
    container.querySelector('#productCategory').value = product ? (product.category || '') : '';
    container.querySelector('#productPrice').value = product ? product.price : '';
    container.querySelector('#productCost').value = product ? product.cost : '';
    overlay.classList.remove('d-none');
  }

  function closeModal() {
    overlay.classList.add('d-none');
    form.reset();
  }
}

function setupDragSort(container) {
  const items = container.querySelectorAll('.product-item[draggable="true"]');

  items.forEach(item => {
    item.addEventListener('dragstart', () => {
      draggingId = item.dataset.id;
      item.style.opacity = '0.5';
    });

    item.addEventListener('dragend', async () => {
      item.style.opacity = '1';
      await persistOrder(container);
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = container.querySelector(`[data-id="${draggingId}"]`);
      if (!dragging || dragging === item) return;
      const rect = item.getBoundingClientRect();
      const next = (e.clientY - rect.top) / rect.height > 0.5;
      item.parentNode.insertBefore(dragging, next ? item.nextSibling : item);
    });

    // タッチデバイス向け簡易対応（長押し不要、ボタンで上下移動も可とする代替）
  });
}

async function persistOrder(container) {
  const items = [...container.querySelectorAll('.product-item[draggable="true"]')];
  for (let i = 0; i < items.length; i++) {
    const id = Number(items[i].dataset.id);
    const product = products.find(p => p.id === id);
    if (product && product.sortOrder !== i + 1) {
      product.sortOrder = i + 1;
      await dbPut('ProductMaster', product);
    }
  }
  showToast('✅ 並び順を更新しました');
}
