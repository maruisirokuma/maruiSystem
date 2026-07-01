/**
 * db.js - IndexedDB データベース管理モジュール
 * 全テーブルの CRUD 操作を提供する
 */

// DBバージョン（スキーマ変更時にインクリメント）
const DB_NAME    = 'SandwichSalesDB';
const DB_VERSION = 1;

// ObjectStore 名
export const STORES = {
  PRODUCTS:           'ProductMaster',
  MANUFACTURE:        'ManufactureRecord',
  LOSS:               'LossRecord',
  DAILY_REPORT:       'DailyReport',
  DISCOUNT_ANALYSIS:  'DiscountAnalysisRecord',
};

let _db = null;

/**
 * DBを開く（初回はスキーマ作成）
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // ProductMaster
      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        const store = db.createObjectStore(STORES.PRODUCTS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('isActive',  'isActive',  { unique: false });
        store.createIndex('sortOrder', 'sortOrder', { unique: false });
        store.createIndex('category',  'category',  { unique: false });
      }

      // ManufactureRecord（keyPath: date）
      if (!db.objectStoreNames.contains(STORES.MANUFACTURE)) {
        db.createObjectStore(STORES.MANUFACTURE, { keyPath: 'date' });
      }

      // LossRecord（keyPath: date）
      if (!db.objectStoreNames.contains(STORES.LOSS)) {
        db.createObjectStore(STORES.LOSS, { keyPath: 'date' });
      }

      // DailyReport（keyPath: date）
      if (!db.objectStoreNames.contains(STORES.DAILY_REPORT)) {
        db.createObjectStore(STORES.DAILY_REPORT, { keyPath: 'date' });
      }

      // DiscountAnalysisRecord（keyPath: date）
      if (!db.objectStoreNames.contains(STORES.DISCOUNT_ANALYSIS)) {
        db.createObjectStore(STORES.DISCOUNT_ANALYSIS, { keyPath: 'date' });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => {
      console.error('IndexedDB open error', e.target.error);
      reject(e.target.error);
    };
  });
}

/* ------------------------------------------------
   汎用 CRUD ヘルパー
------------------------------------------------ */

/**
 * 1件取得
 * @param {string} storeName
 * @param {*} key
 */
export async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req   = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * 全件取得
 * @param {string} storeName
 */
export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * 保存（追加/上書き）
 * @param {string} storeName
 * @param {object} data
 */
export async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req   = store.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * 削除
 * @param {string} storeName
 * @param {*} key
 */
export async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req   = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * インデックスで検索
 * @param {string} storeName
 * @param {string} indexName
 * @param {*} value
 */
export async function dbGetByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req   = index.getAll(value);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * 全データ削除（設定画面から利用）
 */
export async function dbClearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = Object.values(STORES);
    const tx = db.transaction(storeNames, 'readwrite');

    let cleared = 0;
    storeNames.forEach((name) => {
      const req = tx.objectStore(name).clear();
      req.onsuccess = () => {
        cleared++;
        if (cleared === storeNames.length) resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/* ------------------------------------------------
   商品マスタ 専用操作
------------------------------------------------ */

/**
 * アクティブ商品を並び順で取得
 */
export async function getActiveProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  return all
    .filter(p => p.isActive)
    .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
}

/**
 * 全商品（非アクティブ含む）を並び順で取得
 */
export async function getAllProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  return all.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
}

/* ------------------------------------------------
   バックアップ / インポート
------------------------------------------------ */

/**
 * 全データをJSONオブジェクトで返す
 */
export async function exportAllData() {
  const data = {};
  for (const [key, storeName] of Object.entries(STORES)) {
    data[key] = await dbGetAll(storeName);
  }
  return data;
}

/**
 * JSONオブジェクトからインポート（既存データは上書き）
 * @param {object} data
 */
export async function importAllData(data) {
  for (const [key, storeName] of Object.entries(STORES)) {
    if (!data[key]) continue;
    for (const record of data[key]) {
      await dbPut(storeName, record);
    }
  }
}
