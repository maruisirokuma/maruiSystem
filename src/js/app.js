/** app.js - エントリーポイント・ルーティング・共通UI */
import { openDB, STORES, dbPut, dbGetAll } from './db.js';
import { initDashboard }  from './dashboard.js';
import { initManufacture } from './manufacture.js';
import { initLoss }        from './loss.js';
import { initReport }      from './report.js';
import { initDiscount }    from './discount.js';
import { initProducts }    from './products.js';
import { initSettings }    from './settings.js';

const PAGES = {
  dashboard:   { title:'ダッシュボード', init:initDashboard },
  manufacture: { title:'製造計算',       init:initManufacture },
  loss:        { title:'ロス計算',        init:initLoss },
  discount:    { title:'割引分析',        init:initDiscount },
  report:      { title:'日報',            init:initReport },
  products:    { title:'商品管理',        init:initProducts },
  settings:    { title:'設定',            init:initSettings },
};

const $ = id => document.getElementById(id);
const menuBtn=$('menuBtn'), drawer=$('drawer'), overlay=$('drawerOverlay'),
      drawerClose=$('drawerClose'), mainContent=$('mainContent'),
      headerTitle=$('headerTitle'), headerDate=$('headerDate'), toast=$('toast');

/* ---------- トースト ---------- */
export function showToast(msg, duration=3000) {
  toast.textContent=msg; toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'), duration);
}

/* ---------- 日付ユーティリティ ---------- */
export function todayStr() {
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function getWeekdayStr(dateStr) {
  const days=['日','月','火','水','木','金','土'];
  return days[(dateStr?new Date(dateStr):new Date()).getDay()];
}
export function nowTimeStr() {
  const d=new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
export function escHtml(s) { const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }

/* ---------- フォントサイズ ---------- */
const FS_KEY='app_font_size';
const FS_MAP={ small:'14px', medium:'16px', large:'19px' };
export function applyFontSize(size) {
  document.documentElement.style.setProperty('--fs-base', FS_MAP[size]||'16px');
  localStorage.setItem(FS_KEY, size);
}
export function getSavedFontSize() { return localStorage.getItem(FS_KEY)||'medium'; }

/* ---------- ドロワー ---------- */
const openDrawer  = () => { drawer.classList.add('open');  overlay.classList.add('active');  drawer.setAttribute('aria-hidden','false'); };
const closeDrawer = () => { drawer.classList.remove('open'); overlay.classList.remove('active'); drawer.setAttribute('aria-hidden','true'); };
menuBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);

/* ---------- ルーティング ---------- */
export async function navigateTo(pageId) {
  if (!PAGES[pageId]) return;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page===pageId));
  headerTitle.textContent = PAGES[pageId].title;
  closeDrawer();
  mainContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try { await PAGES[pageId].init(mainContent); }
  catch(e) { console.error(e); mainContent.innerHTML='<div class="page"><div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">読み込みに失敗しました</div></div></div>'; }
}

document.querySelectorAll('.nav-item').forEach(el =>
  el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.page); })
);

/* ---------- ヘッダー日付 ---------- */
function updateDate() {
  const d=new Date(), days=['日','月','火','水','木','金','土'];
  headerDate.textContent=`${d.getMonth()+1}/${d.getDate()}（${days[d.getDay()]}）`;
}

/* ---------- 初期商品投入（実データ21品） ---------- */
async function seedProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  if (all.length>0) return;
  const products = [
    {name:'いちごサンド',           category:'フルーツ系',price:550,cost:197,sortOrder: 1,isActive:true},
    {name:'甘夏サンド',             category:'フルーツ系',price:500,cost:154,sortOrder: 2,isActive:true},
    {name:'フルーツミックスサンド', category:'フルーツ系',price:500,cost:148,sortOrder: 3,isActive:true},
    {name:'ブルーベリーサンド',     category:'フルーツ系',price:380,cost:114,sortOrder: 4,isActive:true},
    {name:'バナナショコラサンド',   category:'フルーツ系',price:400,cost: 93,sortOrder: 5,isActive:true},
    {name:'ピーナツバターサンド',   category:'その他',    price:270,cost: 83,sortOrder: 6,isActive:true},
    {name:'照り焼きチキンサンド',   category:'惣菜系',    price:440,cost:126,sortOrder: 7,isActive:true},
    {name:'ハムタマゴサンド',       category:'惣菜系',    price:410,cost:131,sortOrder: 8,isActive:true},
    {name:'ツナサラダサンド',       category:'惣菜系',    price:380,cost:117,sortOrder: 9,isActive:true},
    {name:'ハム野菜サンド',         category:'惣菜系',    price:380,cost:108,sortOrder:10,isActive:true},
    {name:'メンチカツサンド',       category:'揚げ物系',  price:480,cost:139,sortOrder:11,isActive:true},
    {name:'味噌カツサンド',         category:'揚げ物系',  price:480,cost:157,sortOrder:12,isActive:true},
    {name:'フィッシュサンド',       category:'揚げ物系',  price:380,cost:100,sortOrder:13,isActive:true},
    {name:'コロッケサンド',         category:'揚げ物系',  price:400,cost:118,sortOrder:14,isActive:true},
    {name:'タマゴサンド',           category:'惣菜系',    price:320,cost:111,sortOrder:15,isActive:true},
    {name:'タマゴ野菜サンド',       category:'惣菜系',    price:350,cost:113,sortOrder:16,isActive:true},
    {name:'ごぼうサラダサンド',     category:'惣菜系',    price:380,cost:115,sortOrder:17,isActive:true},
    {name:'アボカドサーモンサンド', category:'惣菜系',    price:530,cost:186,sortOrder:18,isActive:true},
    {name:'エビとブロッコリーのサンド',category:'惣菜系', price:480,cost:164,sortOrder:19,isActive:true},
    {name:'ポテトサンド',           category:'その他',    price:340,cost: 96,sortOrder:20,isActive:true},
    {name:'パストラミビーフサンド', category:'惣菜系',    price:430,cost:143,sortOrder:21,isActive:true},
  ];
  for (const p of products) await dbPut(STORES.PRODUCTS, p);
}

/* ---------- 起動 ---------- */
async function main() {
  await openDB();
  await seedProducts();
  applyFontSize(getSavedFontSize());
  updateDate();
  setInterval(updateDate, 60000);
  await navigateTo('dashboard');
}
main().catch(console.error);

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));