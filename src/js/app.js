/**
 * app.js - アプリケーションエントリーポイント
 * ページルーティング・ナビゲーション・共通UI・フォントサイズ設定管理
 */

import { openDB, STORES, dbPut, dbGetAll, getActiveProducts } from './db.js';
import { initDashboard } from './dashboard.js';
import { initManufacture } from './manufacture.js';
import { initLoss } from './loss.js';
import { initReport } from './report.js';
import { initDiscount } from './discount.js';
import { initProducts } from './products.js';
import { initSettings } from './settings.js';

/* ====================================================
   ページ定義
==================================================== */
const PAGES = {
  dashboard:   { title: 'ダッシュボード', init: initDashboard },
  manufacture: { title: '製造計算',       init: initManufacture },
  loss:        { title: 'ロス計算',        init: initLoss },
  discount:    { title: '割引分析',        init: initDiscount },
  report:      { title: '日報',            init: initReport },
  products:    { title: '商品管理',        init: initProducts },
  settings:    { title: '設定',            init: initSettings },
};

/* ====================================================
   DOM参照
==================================================== */
const menuBtn       = document.getElementById('menuBtn');
const drawer        = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const drawerClose   = document.getElementById('drawerClose');
const mainContent   = document.getElementById('mainContent');
const headerTitle   = document.getElementById('headerTitle');
const headerDate    = document.getElementById('headerDate');
const toast         = document.getElementById('toast');

/* ====================================================
   共通ユーティリティ（グローバル公開）
==================================================== */

export function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function formatCurrency(n) {
  return Number(n || 0).toLocaleString('ja-JP') + '円';
}

export function getWeekdayStr(dateStr) {
  const days = ['日','月','火','水','木','金','土'];
  const d = dateStr ? new Date(dateStr) : new Date();
  return days[d.getDay()];
}

export function getWeekdayIndex(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.getDay(); // 0=日, 1=月, ...6=土
}

export function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ====================================================
   フォントサイズ設定（localStorage保持）
==================================================== */
const FONT_SIZE_KEY = 'app_font_size';
const FONT_SIZE_MAP = { small: '14px', medium: '16px', large: '19px' };

export function applyFontSize(size) {
  document.documentElement.style.fontSize = FONT_SIZE_MAP[size] || '16px';
  localStorage.setItem(FONT_SIZE_KEY, size);
}

export function getSavedFontSize() {
  return localStorage.getItem(FONT_SIZE_KEY) || 'medium';
}

/* ====================================================
   ドロワーナビ制御
==================================================== */
function openDrawer() {
  drawer.classList.add('open');
  drawerOverlay.classList.add('active');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawerOverlay.classList.remove('active');
  drawer.setAttribute('aria-hidden', 'true');
}

menuBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

/* ====================================================
   ページルーティング
==================================================== */
export async function navigateTo(pageId) {
  if (!PAGES[pageId]) return;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  headerTitle.textContent = PAGES[pageId].title;
  closeDrawer();
  mainContent.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    await PAGES[pageId].init(mainContent);
  } catch (err) {
    console.error(`Page init error [${pageId}]:`, err);
    mainContent.innerHTML = `
      <div class="page">
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-text">ページの読み込みに失敗しました</div>
        </div>
      </div>`;
  }
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(el.dataset.page);
  });
});

/* ====================================================
   ヘッダー日付表示
==================================================== */
function updateHeaderDate() {
  const d = new Date();
  const days = ['日','月','火','水','木','金','土'];
  headerDate.textContent = `${d.getMonth()+1}/${d.getDate()}（${days[d.getDay()]}）`;
}

/* ====================================================
   初期商品データ投入（ユーザー指定データ）
==================================================== */
async function seedProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  if (all.length > 0) return;

  const initialProducts = [
    { name: 'いちごサンド',             price: 550, cost: 197, sortOrder:  1, isActive: true },
    { name: '甘夏サンド',               price: 500, cost: 154, sortOrder:  2, isActive: true },
    { name: 'ピーナツバターサンド',     price: 270, cost:  83, sortOrder:  3, isActive: true },
    { name: 'フルーツミックスサンド',   price: 500, cost: 148, sortOrder:  4, isActive: true },
    { name: 'ブルーベリーサンド',       price: 380, cost: 114, sortOrder:  5, isActive: true },
    { name: 'バナナショコラサンド',     price: 400, cost:  93, sortOrder:  6, isActive: true },
    { name: '照り焼きチキンサンド',     price: 440, cost: 126, sortOrder:  7, isActive: true },
    { name: 'ハムタマゴサンド',         price: 410, cost: 131, sortOrder:  8, isActive: true },
    { name: 'ツナサラダサンド',         price: 380, cost: 117, sortOrder:  9, isActive: true },
    { name: 'ハム野菜サンド',           price: 380, cost: 108, sortOrder: 10, isActive: true },
    { name: 'メンチカツサンド',         price: 480, cost: 139, sortOrder: 11, isActive: true },
    { name: '味噌カツサンド',           price: 480, cost: 157, sortOrder: 12, isActive: true },
    { name: 'フィッシュサンド',         price: 380, cost: 100, sortOrder: 13, isActive: true },
    { name: 'タマゴサンド',             price: 320, cost: 111, sortOrder: 14, isActive: true },
    { name: 'ごぼうサラダサンド',       price: 380, cost: 115, sortOrder: 15, isActive: true },
    { name: 'アボカドサーモンサンド',   price: 530, cost: 186, sortOrder: 16, isActive: true },
    { name: 'エビとブロッコリーのサンド', price: 480, cost: 164, sortOrder: 17, isActive: true },
    { name: 'ポテトサンド',             price: 340, cost:  96, sortOrder: 18, isActive: true },
    { name: 'タマゴ野菜サンド',         price: 350, cost: 113, sortOrder: 19, isActive: true },
    { name: 'パストラミビーフサンド',   price: 430, cost: 143, sortOrder: 20, isActive: true },
    { name: 'コロッケサンド',           price: 400, cost: 118, sortOrder: 21, isActive: true },
  ];

  for (const p of initialProducts) {
    await dbPut(STORES.PRODUCTS, { ...p, category: '' });
  }
  console.log('商品マスタ（ユーザー指定データ21商品）を投入しました');
}

/* ====================================================
   アプリ起動
==================================================== */
async function main() {
  await openDB();
  await seedProducts();

  // フォントサイズ復元
  applyFontSize(getSavedFontSize());

  updateHeaderDate();
  setInterval(updateHeaderDate, 60_000);

  await navigateTo('dashboard');
}

main().catch(console.error);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
