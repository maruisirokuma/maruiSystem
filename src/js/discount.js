/**
 * discount.js - 割引分析画面（最重要機能）
 * 17:00〜20:00の10分刻み在庫入力、割引タイミング記録、追加製造記録、
 * Chart.jsによる在庫推移グラフ、完売予測、割引推奨、追加製造支援を提供する
 */

import { dbGet, dbPut, STORES } from './db.js';
import { showToast, todayStr, getWeekdayStr, nowTimeStr } from './app.js';
import {
  generateTimeSlots,
  getWeekdayAverageStock,
  getYesterdayStock,
  calcIdealStock,
  predictSoldOut,
  getDiscountRecommendation,
  getManufactureRecommendation,
} from './predict.js';

let record = null;       // 当日のDiscountAnalysisRecord
let timeSlots = [];
let chartInstance = null;
let idealStock = {};
let weekdayAvg = {};
let yesterdayStock = {};

export async function initDiscount(container) {
  const today = todayStr();
  const weekday = getWeekdayStr(today);
  timeSlots = generateTimeSlots();

  const existing = await dbGet(STORES.DISCOUNT_ANALYSIS, today);

  record = existing || {
    date: today,
    weekday,
    hourlySales: {},
    hourlyCustomers: {},
    inventoryLogs: [],
    discountLogs: [],
    manufactureLogs: [],
  };

  // 曜日別平均・昨日在庫を取得
  weekdayAvg = await getWeekdayAverageStock(weekday, [today]);
  idealStock = calcIdealStock(weekdayAvg);
  yesterdayStock = await getYesterdayStock();

  render(container);
}

function getStockAt(time) {
  const log = record.inventoryLogs.find(l => l.time === time);
  return log ? log.stock : null;
}

function setStockAt(time, value) {
  const idx = record.inventoryLogs.findIndex(l => l.time === time);
  if (value === '' || value == null) {
    if (idx >= 0) record.inventoryLogs.splice(idx, 1);
    return;
  }
  const stock = Number(value);
  if (idx >= 0) {
    record.inventoryLogs[idx].stock = stock;
  } else {
    record.inventoryLogs.push({ time, stock });
  }
}

function render(container) {
  const prediction = predictSoldOut(record.inventoryLogs);
  const currentTime = nowTimeStr();
  const latestLog = [...record.inventoryLogs].sort((a,b) => b.time.localeCompare(a.time))[0];
  const currentStock = latestLog ? latestLog.stock : null;
  const idealNow = findNearestIdeal(currentTime);

  const recommendation = currentStock != null
    ? getDiscountRecommendation(currentStock, idealNow, prediction, currentTime)
    : { show: false, rate: 0, reasons: [] };

  const manufactureRec = getManufactureRecommendation(currentStock ?? 0, idealStock['17:00']);

  container.innerHTML = `
    <div class="page page-enter">

      <!-- 完売予測 -->
      <div class="predict-bar">
        <div class="predict-percent">${prediction.probability}%</div>
        <div class="predict-info">
          <div class="predict-title">完売確率</div>
          <div class="predict-time">${prediction.predictedTime ? '予測完売時刻 ' + prediction.predictedTime : '在庫データを入力してください'}</div>
        </div>
      </div>

      <!-- 割引推奨 -->
      ${recommendation.show ? `
        <div class="recommend-banner">
          <div class="recommend-title">🏷️ ${recommendation.rate}%割引を推奨</div>
          <ul class="recommend-reasons">
            ${recommendation.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <!-- 割引ボタン -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">🏷️</span>割引開始</div>
        <div class="card-body">
          <div class="discount-btn-group">
            <button class="btn btn-outline discount-start-btn" data-rate="20">20%開始</button>
            <button class="btn btn-outline discount-start-btn" data-rate="30">30%開始</button>
            <button class="btn btn-outline discount-start-btn" data-rate="50">50%開始</button>
          </div>
          ${record.discountLogs.length > 0 ? `
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">記録済み</label>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                ${record.discountLogs.map((d, i) => `
                  <span class="discount-badge discount-badge-${d.rate}">${d.time} ${d.rate}%
                    <span class="del-discount-log" data-index="${i}" style="margin-left:6px; cursor:pointer;">✕</span>
                  </span>
                `).join('')}
              </div>
            </div>
          ` : '<div class="form-hint">まだ割引は記録されていません</div>'}
        </div>
      </div>

      <!-- 在庫入力 -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📦</span>在庫入力（10分ごと）</div>
        <div class="card-body">
          <div class="timeline-grid">
            ${timeSlots.map(time => `
              <span class="timeline-time">${time}</span>
              <input type="number" class="timeline-input stock-input" data-time="${time}"
                value="${getStockAt(time) ?? ''}" placeholder="個数" inputmode="numeric" min="0" />
            `).join('')}
          </div>
        </div>
      </div>

      <!-- グラフ -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📈</span>在庫推移</div>
        <div class="card-body">
          <div class="chart-wrap">
            <canvas id="stockChart"></canvas>
          </div>
        </div>
      </div>

      <!-- 追加製造支援（17:00時点） -->
      <div class="card">
        <div class="card-header"><span class="card-header-icon">➕</span>追加製造支援</div>
        <div class="card-body">
          <div class="stat-grid mb-md">
            <div class="stat-card">
              <div class="stat-icon">📦</div>
              <div class="stat-label">推奨追加製造数</div>
              <div class="stat-value">＋${manufactureRec.count}<span class="stat-unit">個</span></div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">🎯</div>
              <div class="stat-label">完売確率</div>
              <div class="stat-value">${manufactureRec.probability ?? '-'}<span class="stat-unit">%</span></div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">時間</label>
            <input type="text" class="form-input" id="mfgTime" value="${nowTimeStr()}" placeholder="例：17:05" />
          </div>
          <div class="form-group">
            <label class="form-label">おすすめ製造数</label>
            <input type="number" class="form-input" id="mfgRecommend" value="${manufactureRec.count}" inputmode="numeric" />
          </div>
          <div class="form-group">
            <label class="form-label">実際製造数</label>
            <input type="number" class="form-input" id="mfgActual" inputmode="numeric" placeholder="実際に作った数" />
          </div>
          <button class="btn btn-accent btn-full" id="addMfgLogBtn">追加製造を記録</button>

          ${record.manufactureLogs.length > 0 ? `
            <div class="mt-md">
              ${record.manufactureLogs.map((m, i) => `
                <div class="rank-item">
                  <span class="rank-name">${m.time} 推奨${m.recommendCount}個 → 実際${m.actualCount}個</span>
                  <span class="del-mfg-log" data-index="${i}" style="cursor:pointer; color:var(--danger);">✕</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>

      <button class="btn btn-primary btn-full" id="saveBtn">保存</button>
    </div>
  `;

  bindEvents(container);
  renderChart(container);
}

function findNearestIdeal(time) {
  // 指定時刻以下で最も近いtimeSlotの理想在庫を返す
  const sorted = [...timeSlots].filter(t => t <= time).sort();
  const nearest = sorted[sorted.length - 1] || timeSlots[0];
  return idealStock[nearest];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function bindEvents(container) {
  // 在庫入力
  container.querySelectorAll('.stock-input').forEach(input => {
    input.addEventListener('change', () => {
      setStockAt(input.dataset.time, input.value);
      render(container); // 再描画して予測・推奨を更新
    });
  });

  // 割引開始ボタン
  container.querySelectorAll('.discount-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rate = Number(btn.dataset.rate);
      const time = prompt('割引開始時刻を入力（例: 18:30）', nowTimeStr());
      if (!time) return;
      record.discountLogs.push({ time, rate });
      record.discountLogs.sort((a, b) => a.time.localeCompare(b.time));
      render(container);
      showToast(`✅ ${rate}%割引を記録しました`);
    });
  });

  // 割引ログ削除
  container.querySelectorAll('.del-discount-log').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.index);
      record.discountLogs.splice(idx, 1);
      render(container);
    });
  });

  // 追加製造記録
  container.querySelector('#addMfgLogBtn').addEventListener('click', () => {
    const time = container.querySelector('#mfgTime').value.trim();
    const recommendCount = Number(container.querySelector('#mfgRecommend').value) || 0;
    const actualCount = Number(container.querySelector('#mfgActual').value) || 0;

    if (!time) {
      showToast('時間を入力してください');
      return;
    }

    record.manufactureLogs.push({ time, recommendCount, actualCount });
    record.manufactureLogs.sort((a, b) => a.time.localeCompare(b.time));
    render(container);
    showToast('✅ 追加製造を記録しました');
  });

  // 追加製造ログ削除
  container.querySelectorAll('.del-mfg-log').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.index);
      record.manufactureLogs.splice(idx, 1);
      render(container);
    });
  });

  // 保存
  container.querySelector('#saveBtn').addEventListener('click', async () => {
    await dbPut(STORES.DISCOUNT_ANALYSIS, record);
    showToast('✅ 保存しました');
  });
}

function renderChart(container) {
  const canvas = container.querySelector('#stockChart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const currentData = timeSlots.map(t => getStockAt(t));
  const idealData = timeSlots.map(t => idealStock[t] ?? null);
  const weekdayAvgData = timeSlots.map(t => weekdayAvg[t] ?? null);
  const yesterdayData = timeSlots.map(t => yesterdayStock[t] ?? null);

  // 完売予測線：現在在庫から予測完売時刻まで線形に0へ向かう仮想ライン
  const prediction = predictSoldOut(record.inventoryLogs);
  const predictData = buildPredictLine(prediction);

  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: timeSlots,
      datasets: [
        {
          label: '現在在庫',
          data: currentData,
          borderColor: '#2E7D32',
          backgroundColor: 'rgba(46,125,50,0.1)',
          borderWidth: 3,
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: '理想在庫',
          data: idealData,
          borderColor: '#1565C0',
          borderDash: [6, 4],
          borderWidth: 2,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 0,
        },
        {
          label: '曜日平均在庫',
          data: weekdayAvgData,
          borderColor: '#9E9E9E',
          borderDash: [2, 2],
          borderWidth: 1.5,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 0,
        },
        {
          label: '昨日在庫',
          data: yesterdayData,
          borderColor: '#F57F17',
          borderWidth: 1.5,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 0,
        },
        {
          label: '完売予測',
          data: predictData,
          borderColor: '#C62828',
          borderWidth: 2,
          borderDash: [4, 4],
          tension: 0,
          spanGaps: true,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: '在庫数' },
        },
        x: {
          ticks: { maxRotation: 60, minRotation: 60, font: { size: 10 } },
        },
      },
    },
  });
}

function buildPredictLine(prediction) {
  const sorted = [...record.inventoryLogs].sort((a, b) => a.time.localeCompare(b.time));
  if (sorted.length === 0 || !prediction.predictedTime) {
    return timeSlots.map(() => null);
  }
  const last = sorted[sorted.length - 1];

  return timeSlots.map(t => {
    if (t < last.time) return null;
    if (t > prediction.predictedTime) return 0;
    // 線形補間
    const totalMin = toMinutes(prediction.predictedTime) - toMinutes(last.time);
    const elapsedMin = toMinutes(t) - toMinutes(last.time);
    if (totalMin <= 0) return last.stock;
    const ratio = elapsedMin / totalMin;
    return Math.max(0, Math.round(last.stock * (1 - ratio)));
  });
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
