/**
 * app.js - アプリケーションエントリーポイント
 * ページルーティング・ナビゲーション・共通UI管理
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
  dashboard:  { title: 'ダッシュボード', init: initDashboard },
  manufacture:{ title: '製造計算',       init: initManufacture },
  loss:       { title: 'ロス計算',        init: initLoss },
  discount:   { title: '割引分析',        init: initDiscount },
  report:     { title: '日報',            init: initReport },
  products:   { title: '商品管理',        init: initProducts },
  settings:   { title: '設定',            init: initSettings },
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

/** トースト表示 */
export function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

/** 今日の日付文字列 "YYYY-MM-DD" */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** 数値を通貨文字列に変換 */
export function formatCurrency(n) {
  return Number(n || 0).toLocaleString('ja-JP') + '円';
}

/** 曜日文字列 */
export function getWeekdayStr(dateStr) {
  const days = ['日','月','火','水','木','金','土'];
  const d = dateStr ? new Date(dateStr) : new Date();
  return days[d.getDay()];
}

/** 現在時刻の "HH:MM" 文字列 */
export function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
let currentPage = null;

export async function navigateTo(pageId) {
  if (!PAGES[pageId]) {
    console.warn('Unknown page:', pageId);
    return;
  }

  // アクティブNavアイテム更新
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  // ヘッダータイトル更新
  headerTitle.textContent = PAGES[pageId].title;

  // ドロワーを閉じる
  closeDrawer();

  // ローディング表示
  mainContent.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  // ページ初期化
  currentPage = pageId;
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

/* ====================================================
   ナビリンクのイベント設定
==================================================== */
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
  headerDate.textContent =
    `${d.getMonth()+1}/${d.getDate()}（${days[d.getDay()]}）`;
}

/* ====================================================
   初期データ投入（サンプル商品）
==================================================== */
async function seedSampleProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  if (all.length > 0) return; // 既にデータがある場合はスキップ

  const sampleProducts = [
    { name: 'ハムサンド',           category: 'サンドイッチ', price: 320, cost: 150, sortOrder: 1, isActive: true },
    { name: '卵サンド',             category: 'サンドイッチ', price: 300, cost: 140, sortOrder: 2, isActive: true },
    { name: 'ツナサンド',           category: 'サンドイッチ', price: 310, cost: 145, sortOrder: 3, isActive: true },
    { name: 'BLTサンド',            category: 'サンドイッチ', price: 380, cost: 180, sortOrder: 4, isActive: true },
    { name: 'フルーツサンド',       category: 'サンドイッチ', price: 350, cost: 170, sortOrder: 5, isActive: true },
    { name: 'チキンサンド',         category: 'サンドイッチ', price: 390, cost: 190, sortOrder: 6, isActive: true },
    { name: 'ミックスサンド',       category: 'サンドイッチ', price: 420, cost: 200, sortOrder: 7, isActive: true },
    { name: 'カツサンド',           category: 'サンドイッチ', price: 450, cost: 220, sortOrder: 8, isActive: true },
  ];

  for (const p of sampleProducts) {
    await dbPut(STORES.PRODUCTS, p);
  }
  console.log('サンプル商品を追加しました');
}

/* ====================================================
   アプリ起動
==================================================== */
async function main() {
  // DB初期化
  await openDB();

  // サンプルデータ投入
  await seedSampleProducts();

  // 日付表示
  updateHeaderDate();

  // 1分ごとに日付更新
  setInterval(updateHeaderDate, 60_000);

  // ダッシュボードから開始
  await navigateTo('dashboard');
}

main().catch(console.error);