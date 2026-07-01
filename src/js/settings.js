/**
 * settings.js - 設定画面
 * JSONバックアップ出力、CSV出力、JSONインポート、全データ削除
 */

import { exportAllData, importAllData, dbClearAll, dbGetAll, STORES, getAllProducts } from './db.js';
import { showToast, todayStr } from './app.js';

export async function initSettings(container) {
  render(container);
}

function render(container) {
  container.innerHTML = `
    <div class="page page-enter">
      <div class="section-title">データ管理</div>
      <div class="card">
        <a class="setting-item" id="exportJsonBtn" href="#">
          <span class="setting-icon">💾</span>
          <div class="setting-info">
            <div class="setting-name">JSONバックアップ出力</div>
            <div class="setting-desc">全データをJSONファイルとして保存します</div>
          </div>
          <span class="setting-arrow">›</span>
        </a>
        <a class="setting-item" id="exportCsvBtn" href="#">
          <span class="setting-icon">📊</span>
          <div class="setting-info">
            <div class="setting-name">CSV出力</div>
            <div class="setting-desc">日報・製造・ロスデータをCSVで出力します</div>
          </div>
          <span class="setting-arrow">›</span>
        </a>
        <a class="setting-item" id="importBtn" href="#">
          <span class="setting-icon">📥</span>
          <div class="setting-info">
            <div class="setting-name">JSONインポート</div>
            <div class="setting-desc">バックアップファイルからデータを復元します</div>
          </div>
          <span class="setting-arrow">›</span>
        </a>
        <input type="file" id="importFileInput" accept="application/json" class="d-none" />
      </div>

      <div class="section-title">危険な操作</div>
      <div class="card">
        <a class="setting-item" id="clearAllBtn" href="#">
          <span class="setting-icon">🗑️</span>
          <div class="setting-info">
            <div class="setting-name text-danger">全データ削除</div>
            <div class="setting-desc">すべてのデータを完全に削除します（元に戻せません）</div>
          </div>
          <span class="setting-arrow">›</span>
        </a>
      </div>

      <div class="section-title">アプリ情報</div>
      <div class="card">
        <div class="card-body">
          <div class="form-group" style="margin-bottom:0;">
            <div class="text-muted" style="font-size:14px;">サンドイッチ販売支援システム</div>
            <div class="text-muted" style="font-size:13px; margin-top:4px;">バージョン 1.0.0（Phase1〜3）</div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents(container);
}

function bindEvents(container) {
  container.querySelector('#exportJsonBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await exportJson();
  });

  container.querySelector('#exportCsvBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await exportCsv();
  });

  const importBtn = container.querySelector('#importBtn');
  const fileInput = container.querySelector('#importFileInput');

  importBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('インポートすると既存データに上書きされます。よろしいですか？')) {
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      showToast('✅ インポートしました');
    } catch (err) {
      console.error(err);
      showToast('⚠️ インポートに失敗しました');
    }
    fileInput.value = '';
  });

  container.querySelector('#clearAllBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('本当にすべてのデータを削除しますか？この操作は元に戻せません。')) return;
    if (!confirm('最終確認：全データを完全に削除します。よろしいですか？')) return;
    await dbClearAll();
    showToast('✅ 全データを削除しました');
  });
}

/* ------------------------------------------------
   JSONバックアップ出力
------------------------------------------------ */
async function exportJson() {
  const data = await exportAllData();
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `sandwich-backup-${todayStr()}.json`, 'application/json');
  showToast('✅ バックアップを出力しました');
}

/* ------------------------------------------------
   CSV出力
------------------------------------------------ */
async function exportCsv() {
  const products = await getAllProducts();
  const productMap = {};
  products.forEach(p => { productMap[p.id] = p.name; });

  const manufactureRecords = await dbGetAll(STORES.MANUFACTURE);
  const lossRecords = await dbGetAll(STORES.LOSS);
  const reportRecords = await dbGetAll(STORES.DAILY_REPORT);

  let csv = '';

  // 日報CSV
  csv += '【日報】\n';
  csv += '日付,売上,客数,客単価,名前,本文\n';
  reportRecords
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(r => {
      csv += [r.date, r.sales, r.customers, r.unitPrice, csvEscape(r.name), csvEscape(r.body)].join(',') + '\n';
    });

  csv += '\n【製造記録】\n';
  csv += '日付,商品名,製造個数,小計\n';
  manufactureRecords
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(r => {
      (r.items || []).forEach(item => {
        csv += [r.date, csvEscape(productMap[item.productId] || `ID:${item.productId}`), item.count, item.subtotal].join(',') + '\n';
      });
    });

  csv += '\n【ロス記録】\n';
  csv += '日付,商品名,20%個数,30%個数,50%個数,割引金額,ロス個数,ロス金額\n';
  lossRecords
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(r => {
      (r.items || []).forEach(item => {
        csv += [
          r.date,
          csvEscape(productMap[item.productId] || `ID:${item.productId}`),
          item.discount20, item.discount30, item.discount50,
          item.discountPrice, item.lossCount, item.lossPrice,
        ].join(',') + '\n';
      });
    });

  // BOM付きでExcel文字化け対策
  downloadFile('\uFEFF' + csv, `sandwich-data-${todayStr()}.csv`, 'text/csv');
  showToast('✅ CSVを出力しました');
}

function csvEscape(str) {
  if (str == null) return '';
  const s = String(str).replace(/"/g, '""');
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return `"${s}"`;
  }
  return s;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
