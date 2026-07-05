/**
 * dashboard.js - ダッシュボード画面
 * 完売確率・推奨割引・今日のサマリー・売れ筋ランキング・ロスランキングを表示
 */

import { dbGet, dbGetAll, STORES, getActiveProducts } from './db.js';
import { todayStr, getWeekdayStr } from './app.js';
import {
  predictSoldOut,
  getDiscountRecommendation,
  generateTimeSlots,
  getWeekdayAverageStock,
  calcIdealStock,
} from './predict.js';

export async function initDashboard(container) {
  const today   = todayStr();
  const weekday = getWeekdayStr(today);

  const [products, discountRecord, manufactureRecords, lossRecords, todayReport] = await Promise.all([
    getActiveProducts(),
    dbGet(STORES.DISCOUNT_ANALYSIS, today),
    dbGetAll(STORES.MANUFACTURE),
    dbGetAll(STORES.LOSS),
    dbGet(STORES.DAILY_REPORT, today),
  ]);

  // 完売予測
  const inventoryLogs = discountRecord?.inventoryLogs || [];
  const prediction    = predictSoldOut(inventoryLogs);

  // 割引推奨
  let recommendation = { show: false, rate: 0, reasons: [] };
  if (inventoryLogs.length > 0) {
    const weekdayAvg = await getWeekdayAverageStock(weekday, [today]);
    const idealStock = calcIdealStock(weekdayAvg, weekday);
    const slots      = generateTimeSlots();
    const now        = new Date();
    const nowTime    = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const nearestSlot = [...slots].filter(t => t <= nowTime).pop() || slots[0];
    const latestLog   = [...inventoryLogs].sort((a,b) => b.time.localeCompare(a.time))[0];
    recommendation = getDiscountRecommendation(latestLog.stock, idealStock[nearestSlot], prediction);
  }

  // 今日の製造データ
  const todayMfg   = manufactureRecords.find(r => r.date === today);
  const todayLoss  = lossRecords.find(r => r.date === today);

  // ランキング（全期間累計）
  const salesRanking = buildRanking(products, manufactureRecords, 'manufacture');
  const lossRanking  = buildRanking(products, lossRecords, 'loss');

  render(container, {
    today, weekday,
    prediction, recommendation,
    todayMfg, todayLoss, todayReport,
    salesRanking, lossRanking,
  });
}

function buildRanking(products, records, type) {
  const totals = {};
  records.forEach(record => {
    (record.items || []).forEach(item => {
      const pid = item.productId;
      if (type === 'manufacture') {
        totals[pid] = (totals[pid] || 0) + item.count;
      } else {
        totals[pid] = (totals[pid] || 0) + (item.lossPrice || 0);
      }
    });
  });
  return products
    .map(p => ({ name: p.name, value: totals[p.id] || 0 }))
    .filter(r => r.value > 0)
    .sort((a,b) => b.value - a.value)
    .slice(0, 5);
}

function render(container, data) {
  const { today, weekday, prediction, recommendation,
          todayMfg, todayLoss, todayReport,
          salesRanking, lossRanking } = data;
  const [, m, d] = today.split('-');

  container.innerHTML = `
    <div class="page page-enter">

      <!-- 日付バー -->
      <div style="text-align:center; margin-bottom:12px; color:var(--text-secondary); font-size:14px; font-weight:600;">
        ${Number(m)}月${Number(d)}日（${weekday}曜日）
      </div>

      <!-- 完売確率 -->
      <div class="predict-bar">
        <div class="predict-percent">${prediction.probability}%</div>
        <div class="predict-info">
          <div class="predict-title">完売確率</div>
          <div class="predict-time">
            ${prediction.predictedTime
              ? '予測完売時刻 ' + prediction.predictedTime
              : '割引分析で在庫を入力してください'}
          </div>
        </div>
      </div>

      <!-- 割引推奨 -->
      ${recommendation.show ? `
        <div class="recommend-banner">
          <div class="recommend-title">🏷️ ${recommendation.rate}%割引を推奨</div>
          <ul class="recommend-reasons">
            ${recommendation.reasons.map(r => `<li>${escHtml(r)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <!-- 今日のサマリー -->
      <div class="section-title">今日のサマリー</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon">🏭</div>
          <div class="stat-label">総製造数</div>
          <div class="stat-value">${todayMfg ? todayMfg.totalCount : '－'}<span class="stat-unit">${todayMfg ? '個' : ''}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💰</div>
          <div class="stat-label">製造総額</div>
          <div class="stat-value" style="font-size:20px;">${todayMfg ? todayMfg.totalPrice.toLocaleString() : '－'}<span class="stat-unit">${todayMfg ? '円' : ''}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📉</div>
          <div class="stat-label">ロス金額</div>
          <div class="stat-value" style="font-size:20px;">${todayLoss ? todayLoss.totalLossPrice.toLocaleString() : '－'}<span class="stat-unit">${todayLoss ? '円' : ''}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🏷️</div>
          <div class="stat-label">割引金額</div>
          <div class="stat-value" style="font-size:20px;">${todayLoss ? todayLoss.totalDiscount.toLocaleString() : '－'}<span class="stat-unit">${todayLoss ? '円' : ''}</span></div>
        </div>
        ${todayReport ? `
          <div class="stat-card wide">
            <div class="stat-icon">📊</div>
            <div class="stat-label">売上 / 客数 / 客単価</div>
            <div style="font-size:18px; font-weight:800; color:var(--primary); margin-top:4px;">
              ${todayReport.sales.toLocaleString()}円 ／ ${todayReport.customers}人 ／ ${todayReport.unitPrice.toLocaleString()}円
            </div>
          </div>
        ` : ''}
      </div>

      <!-- 売れ筋ランキング -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">🏆</span>売れ筋ランキング（累計）</div>
        <div class="card-body">
          ${salesRanking.length === 0
            ? emptyRank('まだ製造データがありません')
            : `<ul class="rank-list">${salesRanking.map((r,i) => rankItem(r,i,false)).join('')}</ul>`}
        </div>
      </div>

      <!-- ロスランキング -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📉</span>ロスランキング（累計）</div>
        <div class="card-body">
          ${lossRanking.length === 0
            ? emptyRank('まだロスデータがありません')
            : `<ul class="rank-list">${lossRanking.map((r,i) => rankItem(r,i,true)).join('')}</ul>`}
        </div>
      </div>

    </div>
  `;
}

function rankItem(r, i, isCurrency) {
  const cls = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
  const val = isCurrency ? r.value.toLocaleString() + '円' : r.value + '個';
  return `
    <li class="rank-item">
      <span class="rank-badge ${cls}">${i+1}</span>
      <span class="rank-name">${escHtml(r.name)}</span>
      <span class="rank-value">${val}</span>
    </li>`;
}

function emptyRank(text) {
  return `<div class="empty-state" style="padding:20px 0;">
    <div class="empty-state-text" style="font-size:14px;">${text}</div>
  </div>`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
