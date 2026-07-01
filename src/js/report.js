/**
 * report.js - 日報画面
 * 売上・客数・本文・名前を入力し、クリップボード用フォーマットを生成する
 */

import { dbGet, dbPut, STORES } from './db.js';
import { showToast, todayStr, getWeekdayStr } from './app.js';

let reportData = {
  sales: 0,
  customers: 0,
  body: '',
  name: '',
};

export async function initReport(container) {
  const today = todayStr();
  const existing = await dbGet(STORES.DAILY_REPORT, today);

  reportData = existing
    ? { sales: existing.sales, customers: existing.customers, body: existing.body, name: existing.name }
    : { sales: 0, customers: 0, body: '', name: '' };

  render(container);
}

function calcUnitPrice() {
  if (!reportData.customers) return 0;
  return Math.round(reportData.sales / reportData.customers);
}

function buildReportText() {
  const today = todayStr();
  const [y, m, d] = today.split('-');
  const weekday = getWeekdayStr(today);
  const unitPrice = calcUnitPrice();

  return `お疲れ様です。
丸井店舗売上報告をいたします。
${Number(m)}月${Number(d)}日 ${weekday}曜日
総売上 ${reportData.sales.toLocaleString()}円
客数 ${reportData.customers}人
客単価 ${unitPrice.toLocaleString()}円
♥
総括
${reportData.body}
${reportData.name}`;
}

function render(container) {
  const today = todayStr();
  const [y, m, d] = today.split('-');
  const weekday = getWeekdayStr(today);
  const unitPrice = calcUnitPrice();

  container.innerHTML = `
    <div class="page page-enter">
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📅</span>${Number(m)}月${Number(d)}日（${weekday}）</div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">売上（円）</label>
            <input type="number" class="form-input" id="salesInput" inputmode="numeric" value="${reportData.sales || ''}" placeholder="例：85000" />
          </div>
          <div class="form-group">
            <label class="form-label">客数（人）</label>
            <input type="number" class="form-input" id="customersInput" inputmode="numeric" value="${reportData.customers || ''}" placeholder="例：120" />
          </div>
          <div class="form-group mb-sm">
            <label class="form-label">客単価（自動計算）</label>
            <div class="chip" id="unitPriceChip">${unitPrice.toLocaleString()}円</div>
          </div>
          <div class="form-group">
            <label class="form-label">総括（本文）</label>
            <textarea class="form-textarea" id="bodyInput" placeholder="今日の業務で気づいたこと、申し送り事項など">${reportData.body}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">名前</label>
            <input type="text" class="form-input" id="nameInput" value="${reportData.name}" placeholder="例：山田" />
          </div>
        </div>
      </div>

      <div class="section-title">プレビュー</div>
      <div class="report-preview" id="reportPreview">${escapeHtml(buildReportText())}</div>

      <div class="btn-group mt-md">
        <button class="btn btn-accent" id="copyBtn">📋 コピー</button>
        <button class="btn btn-primary" id="saveBtn">保存</button>
      </div>
    </div>
  `;

  bindEvents(container);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function bindEvents(container) {
  const salesInput = container.querySelector('#salesInput');
  const customersInput = container.querySelector('#customersInput');
  const bodyInput = container.querySelector('#bodyInput');
  const nameInput = container.querySelector('#nameInput');
  const preview = container.querySelector('#reportPreview');
  const unitPriceChip = container.querySelector('#unitPriceChip');

  function updatePreview() {
    reportData.sales = Number(salesInput.value) || 0;
    reportData.customers = Number(customersInput.value) || 0;
    reportData.body = bodyInput.value;
    reportData.name = nameInput.value;

    unitPriceChip.textContent = calcUnitPrice().toLocaleString() + '円';
    preview.textContent = buildReportText();
  }

  [salesInput, customersInput, bodyInput, nameInput].forEach(el => {
    el.addEventListener('input', updatePreview);
  });

  container.querySelector('#copyBtn').addEventListener('click', async () => {
    const text = buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ コピーしました');
    } catch (err) {
      // フォールバック: textareaを使ったコピー
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('✅ コピーしました');
    }
  });

  container.querySelector('#saveBtn').addEventListener('click', async () => {
    await dbPut(STORES.DAILY_REPORT, {
      date: todayStr(),
      sales: reportData.sales,
      customers: reportData.customers,
      unitPrice: calcUnitPrice(),
      body: reportData.body,
      name: reportData.name,
    });
    showToast('✅ 保存しました');
  });
}
