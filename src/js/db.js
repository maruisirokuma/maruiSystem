/** db.js - IndexedDB 操作モジュール */

const DB_NAME = 'SandwichSalesDB';
const DB_VERSION = 1;
export const STORES = {
  PRODUCTS:  'ProductMaster',
  MFG:       'ManufactureRecord',
  LOSS:      'LossRecord',
  REPORT:    'DailyReport',
  DISCOUNT:  'DiscountAnalysisRecord',
};

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        const s = db.createObjectStore(STORES.PRODUCTS, { keyPath:'id', autoIncrement:true });
        s.createIndex('isActive','isActive',{unique:false});
        s.createIndex('sortOrder','sortOrder',{unique:false});
      }
      [STORES.MFG, STORES.LOSS, STORES.REPORT, STORES.DISCOUNT].forEach(name => {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath:'date' });
      });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

const tx = (store, mode, fn) =>
  openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  }));

export const dbGet    = (store, key)  => tx(store,'readonly', s => s.get(key));
export const dbGetAll = (store)       => tx(store,'readonly', s => s.getAll()).then(r => r ?? []);
export const dbPut    = (store, data) => tx(store,'readwrite',s => s.put(data));
export const dbDelete = (store, key)  => tx(store,'readwrite',s => s.delete(key));

export async function getActiveProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  return all.filter(p => p.isActive).sort((a,b) => (a.sortOrder??9999)-(b.sortOrder??9999));
}
export async function getAllProducts() {
  const all = await dbGetAll(STORES.PRODUCTS);
  return all.sort((a,b) => (a.sortOrder??9999)-(b.sortOrder??9999));
}

export async function exportAllData() {
  const out = {};
  for (const [k,v] of Object.entries(STORES)) out[k] = await dbGetAll(v);
  return out;
}
export async function importAllData(data) {
  for (const [k,v] of Object.entries(STORES)) {
    if (!data[k]) continue;
    for (const rec of data[k]) await dbPut(v, rec);
  }
}