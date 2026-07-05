/**
 * settings.js - 設定画面
 * 修正：全データ削除を削除、文字サイズ設定を追加
 */

import { exportAllData, importAllData, dbGetAll, STORES, getAllProducts } from './db.js';
import { showToast, todayStr, applyFontSize, getSavedFontSize } from './app.js';

export async function initSettings(container) {
  render(container);
}

function render(container) {
  const currentSize = getSavedFontSize();

  container.innerHTML = `
    <div class="page page-enter">

      <!-- 文字サイズ -->
      <div class="section-title">表示設定</div>
      <div class="card">
        <div class="card-body">
          <div class="form-label" style="margin-bottom:12px;">文字の大きさ</div>
          <div class="font-size-group">
            <button class="font-size-btn ${currentSize === 'small'  ? 'active' : ''}" data-size="small">
              <span style="font-size:13px;">小</span>
            </button>
            <button class="font-size-btn ${currentSize === 'medium' ? 'active' : ''}" data-size="medium">
              <span style="font-size:16px;">中</span>
            </button>
            <button class="font-size-btn ${currentSize === 'large'  ? 'active' : ''}" data-size="large">
              <span style="font-size:20px;">大</span>
            </button>
          </div>
          <div class="form-hint mt-sm">設定はブラウザに保存されます</div>
        </div>
      </div>

      <!-- データ管理 -->
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

      <!-- アプリ情報 -->
      <div class="section-title">アプリ情報</div>
      <div class="card">
        <div class="card-body">
          <div class="text-muted" style="font-size:14px;">サンドイッチ販売支援システム</div>
          <div class="text-muted" style="font-size:13px; margin-top:4px;">バージョン 1.1.0</div>
        </div>
      </div>
    </div>
  `;

  bindEvents(container);
}

function bindEvents(container) {
  // 文字サイズ切替
  container.querySelectorAll('.font-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.size;
      applyFontSize(size);
      container.querySelectorAll('.font-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`✅ 文字サイズを「${size === 'small' ? '小' : size === 'medium' ? '中' : '大'}」に変更しました`);
    });
  });

  // JSONエクスポート
  container.querySelector('#exportJsonBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    const data = await exportAllData();
    downloadFile(JSON.stringify(data, null, 2), `sandwich-backup-${todayStr()}.json`, 'application/json');
    showToast('✅ バックアップを出力しました');
  });

  // CSVエクスポート
  container.querySelector('#exportCsvBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await exportCsv();
  });

  // インポート
  const importBtn   = container.querySelector('#importBtn');
  const fileInput   = container.querySelector('#importFileInput');
  importBtn.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('インポートすると既存データに上書きされます。よろしいですか？')) {
      fileInput.value = ''; return;
    }
    try {
      const text = await file.text();
      await importAllData(JSON.parse(text));
      showToast('✅ インポートしました');
    } catch (err) {
      console.error(err);
      showToast('⚠️ インポートに失敗しました');
    }
    fileInput.value = '';
  });
}

async function exportCsv() {
  const products = await getAllProducts();
  const productMap = {};
  products.forEach(p => { productMap[p.id] = p.name; });

  const mfg     = await dbGetAll(STORES.MANUFACTURE);
  const loss    = await dbGetAll(STORES.LOSS);
  const reports = await dbGetAll(STORES.DAILY_REPORT);

  let csv = '【日報】\n日付,売上,客数,客単価,名前,本文\n';
  reports.sort((a,b) => a.date.localeCompare(b.date)).forEach(r => {
    csv += [r.date, r.sales, r.customers, r.unitPrice, q(r.name), q(r.body)].join(',') + '\n';
  });

  csv += '\n【製造記録】\n日付,商品名,製造個数,小計\n';
  mfg.sort((a,b) => a.date.localeCompare(b.date)).forEach(r => {
    (r.items || []).forEach(item => {
      csv += [r.date, q(productMap[item.productId] || `ID:${item.productId}`), item.count, item.subtotal].join(',') + '\n';
    });
  });

  csv += '\n【ロス記録】\n日付,商品名,20%,30%,50%,割引金額,ロス個数,ロス金額\n';
  loss.sort((a,b) => a.date.localeCompare(b.date)).forEach(r => {
    (r.items || []).forEach(item => {
      csv += [r.date, q(productMap[item.productId] || `ID:${item.productId}`),
        item.discount20, item.discount30, item.discount50,
        item.discountPrice, item.lossCount, item.lossPrice].join(',') + '\n';
    });
  });

  downloadFile('\uFEFF' + csv, `sandwich-data-${todayStr()}.csv`, 'text/csv');
  showToast('✅ CSVを出力しました');
}

function q(str) {
  if (str == null) return '';
  const s = String(str).replace(/"/g, '""');
  return (s.includes(',') || s.includes('\n') || s.includes('"')) ? `"${s}"` : s;
}

function downloadFile(content, filename, mime) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: mime })),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
