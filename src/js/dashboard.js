/**
 * dashboard.js - ダッシュボード画面
 * 完売確率・今日の推奨割引・売れ筋ランキング・ロスランキングを表示する
 */

import { dbGet, dbGetAll, STORES, getActiveProducts } from './db.js';
import { todayStr, getWeekdayStr, nowTimeStr } from './app.js';
import {
  predictSoldOut,
  getDiscountRecommendation,
  generateTimeSlots,
  getWeekdayAverageStock,
  calcIdealStock,
} from './predict.js';

export async function initDashboard(container) {
  const today = todayStr();
  const weekday = getWeekdayStr(today);

  const [products, discountRecord, manufactureRecords, lossRecords] = await Promise.all([
    getActiveProducts(),
    dbGet(STORES.DISCOUNT_ANALYSIS, today),
    dbGetAll(STORES.MANUFACTURE),
    dbGetAll(STORES.LOSS),
  ]);

  // 完売予測
  const inventoryLogs = discountRecord?.inventoryLogs || [];
  const prediction = predictSoldOut(inventoryLogs);

  // 割引推奨
  let recommendation = { show: false, rate: 0, reasons: [] };
  if (inventoryLogs.length > 0) {
    const weekdayAvg = await getWeekdayAverageStock(weekday, [today]);
    const idealStock = calcIdealStock(weekdayAvg);
    const latestLog = [...inventoryLogs].sort((a,b) => b.time.localeCompare(a.time))[0];
    const currentTime = nowTimeStr();
    const timeSlots = generateTimeSlots();
    const sorted = timeSlots.filter(t => t <= currentTime).sort();
    const nearestTime = sorted[sorted.length - 1] || timeSlots[0];
    const idealNow = idealStock[nearestTime];
    recommendation = getDiscountRecommendation(latestLog.stock, idealNow, prediction, currentTime);
  }

  // 売れ筋ランキング（直近の製造記録から算出。製造数の累計が多い順）
  const salesRanking = buildSalesRanking(products, manufactureRecords);

  // ロスランキング（ロス記録から算出。ロス金額の累計が多い順）
  const lossRanking = buildLossRanking(products, lossRecords);

  render(container, {
    prediction,
    recommendation,
    salesRanking,
    lossRanking,
  });
}

function buildSalesRanking(products, manufactureRecords) {
  const totals = {};
  manufactureRecords.forEach(record => {
    (record.items || []).forEach(item => {
      totals[item.productId] = (totals[item.productId] || 0) + item.count;
    });
  });

  return products
    .map(p => ({ name: p.name, value: totals[p.id] || 0 }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function buildLossRanking(products, lossRecords) {
  const totals = {};
  lossRecords.forEach(record => {
    (record.items || []).forEach(item => {
      totals[item.productId] = (totals[item.productId] || 0) + (item.lossPrice || 0);
    });
  });

  return products
    .map(p => ({ name: p.name, value: totals[p.id] || 0 }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function render(container, { prediction, recommendation, salesRanking, lossRanking }) {
  container.innerHTML = `
    <div class="page page-enter">

      <!-- 完売確率 -->
      <div class="predict-bar">
        <div class="predict-percent">${prediction.probability}%</div>
        <div class="predict-info">
          <div class="predict-title">完売確率</div>
          <div class="predict-time">${prediction.predictedTime ? '予測完売時刻 ' + prediction.predictedTime : '割引分析で在庫を入力してください'}</div>
        </div>
      </div>

      <!-- 推奨割引 -->
      ${recommendation.show ? `
        <div class="recommend-banner">
          <div class="recommend-title">🏷️ 今日の推奨割引：${recommendation.rate}%</div>
          <ul class="recommend-reasons">
            ${recommendation.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>
      ` : `
        <div class="card mb-md">
          <div class="card-body text-center text-muted" style="font-size:14px;">
            現在、割引の推奨はありません
          </div>
        </div>
      `}

      <!-- 売れ筋ランキング -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">🏆</span>売れ筋ランキング</div>
        <div class="card-body">
          ${salesRanking.length === 0 ? emptyRank('まだ製造データがありません') : `
            <ul class="rank-list">
              ${salesRanking.map((r, i) => rankItem(r, i)).join('')}
            </ul>
          `}
        </div>
      </div>

      <!-- ロスランキング -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📉</span>ロスランキング</div>
        <div class="card-body">
          ${lossRanking.length === 0 ? emptyRank('まだロスデータがありません') : `
            <ul class="rank-list">
              ${lossRanking.map((r, i) => rankItem(r, i, true)).join('')}
            </ul>
          `}
        </div>
      </div>

    </div>
  `;
}

function rankItem(r, index, isCurrency = false) {
  const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
  const value = isCurrency ? r.value.toLocaleString() + '円' : r.value + '個';
  return `
    <li class="rank-item">
      <span class="rank-badge ${rankClass}">${index + 1}</span>
      <span class="rank-name">${escapeHtml(r.name)}</span>
      <span class="rank-value">${value}</span>
    </li>
  `;
}

function emptyRank(text) {
  return `<div class="empty-state" style="padding:24px 0;"><div class="empty-state-text" style="font-size:14px;">${text}</div></div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
