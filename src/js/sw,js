/**
 * sw.js - Service Worker
 * オフライン対応のためのキャッシュ管理
 */

const CACHE_NAME = 'sandwich-sales-v1';

// キャッシュするリソース一覧
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/dashboard.js',
  './js/manufacture.js',
  './js/loss.js',
  './js/report.js',
  './js/discount.js',
  './js/products.js',
  './js/settings.js',
  './js/predict.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// フェッチ：キャッシュ優先、なければネットワーク
self.addEventListener('fetch', (event) => {
  // IndexedDB などのブラウザ内リクエストは無視
  if (event.request.url.startsWith('chrome-extension')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // 正常なレスポンスのみキャッシュに追加
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // オフライン時のフォールバック
        return caches.match('./index.html');
      });
    })
  );
});
