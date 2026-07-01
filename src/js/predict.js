/**
 * predict.js - 完売予測・割引推奨・追加製造支援の計算ロジック
 * 割引分析画面とダッシュボードで共通利用する
 */

import { dbGetAll, dbGetByIndex, STORES } from './db.js';
import { getWeekdayStr, todayStr } from './app.js';

/**
 * 過去の同曜日のDiscountAnalysisRecordから17:00〜20:00の曜日別平均在庫を算出
 * @param {string} weekday 曜日（例: '月'）
 * @param {string[]} excludeDates 除外する日付（当日など）
 * @returns {Promise<object>} time -> 平均在庫数
 */
export async function getWeekdayAverageStock(weekday, excludeDates = []) {
  const all = await dbGetAll(STORES.DISCOUNT_ANALYSIS);
  const sameWeekday = all.filter(r => r.weekday === weekday && !excludeDates.includes(r.date));

  const timeSlots = generateTimeSlots();
  const result = {};

  timeSlots.forEach(time => {
    const values = sameWeekday
      .map(r => (r.inventoryLogs || []).find(log => log.time === time)?.stock)
      .filter(v => v != null);

    result[time] = values.length > 0
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : null;
  });

  return result;
}

/**
 * 昨日のDiscountAnalysisRecordの在庫推移を取得
 */
export async function getYesterdayStock() {
  const yesterday = getYesterdayStr();
  const record = await dbGetAll(STORES.DISCOUNT_ANALYSIS).then(all => all.find(r => r.date === yesterday));

  const timeSlots = generateTimeSlots();
  const result = {};
  timeSlots.forEach(time => {
    const log = record ? (record.inventoryLogs || []).find(l => l.time === time) : null;
    result[time] = log ? log.stock : null;
  });
  return result;
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * 17:00〜20:00の10分刻み時刻リストを生成
 */
export function generateTimeSlots() {
  const slots = [];
  for (let h = 17; h <= 20; h++) {
    for (let m = 0; m < 60; m += 10) {
      if (h === 20 && m > 0) break; // 20:00で終了
      slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return slots;
}

/**
 * 理想在庫を計算（Version1: 曜日別平均をそのまま使用）
 * @param {object} weekdayAvg time -> 平均在庫
 */
export function calcIdealStock(weekdayAvg) {
  // Version1はそのまま曜日別平均を理想在庫とする
  return { ...weekdayAvg };
}

/**
 * 完売予測：現在の在庫減少ペースから完売時刻・完売確率を算出
 * @param {Array<{time, stock}>} inventoryLogs 当日の実測在庫ログ（時系列）
 * @returns {{ probability: number, predictedTime: string|null }}
 */
export function predictSoldOut(inventoryLogs) {
  if (!inventoryLogs || inventoryLogs.length < 2) {
    return { probability: 0, predictedTime: null };
  }

  // 直近2点から減少ペース（個/分）を算出
  const sorted = [...inventoryLogs].sort((a, b) => a.time.localeCompare(b.time));
  const last = sorted[sorted.length - 1];
  const prev = sorted[Math.max(0, sorted.length - 3)]; // やや手前の点も使って平滑化

  const minutesDiff = timeToMinutes(last.time) - timeToMinutes(prev.time);
  const stockDiff = prev.stock - last.stock; // 正なら減少中

  if (minutesDiff <= 0 || stockDiff <= 0) {
    // 在庫が減っていない・データ不足の場合は確率低め
    return { probability: 10, predictedTime: null };
  }

  const ratePerMinute = stockDiff / minutesDiff;
  const minutesToZero = last.stock / ratePerMinute;
  const predictedMinutes = timeToMinutes(last.time) + minutesToZero;

  // 20:00（閉店想定）までに完売するかで確率を算出
  const closeMinutes = timeToMinutes('20:00');
  let probability;
  if (predictedMinutes <= closeMinutes) {
    // 早く完売するほど確率が高い
    const margin = closeMinutes - predictedMinutes;
    probability = Math.min(99, Math.round(60 + margin / 2));
  } else {
    // 閉店までに完売しない場合は低確率
    const overrun = predictedMinutes - closeMinutes;
    probability = Math.max(5, Math.round(50 - overrun));
  }

  return {
    probability: Math.max(0, Math.min(99, probability)),
    predictedTime: minutesToTime(Math.round(predictedMinutes)),
  };
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2,'0')}:${String(Math.max(0,m)).padStart(2,'0')}`;
}

/**
 * 割引推奨を算出
 * @param {number} currentStock 現在在庫
 * @param {number} idealStock 理想在庫（その時刻）
 * @param {object} prediction predictSoldOutの結果
 * @param {string} currentTime 現在時刻
 * @returns {{ show: boolean, rate: number, reasons: string[] }}
 */
export function getDiscountRecommendation(currentStock, idealStock, prediction, currentTime) {
  const reasons = [];
  let rate = 0;

  if (idealStock != null && currentStock > idealStock) {
    const over = currentStock - idealStock;
    reasons.push(`現在在庫が理想在庫を${over}個上回っています`);

    if (over >= 15) rate = 50;
    else if (over >= 8) rate = 30;
    else if (over >= 3) rate = 20;
  }

  if (prediction.predictedTime) {
    reasons.push(`完売予測が${prediction.predictedTime}です`);
    if (prediction.probability < 50 && rate === 0) {
      rate = 20;
      reasons.push('完売確率が低めのため早期割引を検討してください');
    }
  }

  return {
    show: rate > 0,
    rate,
    reasons,
  };
}

/**
 * 追加製造の推奨数を算出（17:00時点用）
 * @param {number} currentStock 現在在庫
 * @param {number} idealStock 理想在庫（17:00時点）
 */
export function getManufactureRecommendation(currentStock, idealStock) {
  if (idealStock == null) return { count: 0, probability: null };
  const diff = idealStock - currentStock;
  const count = Math.max(0, diff);
  // 在庫が理想に近いほど完売確率が高いと仮定した簡易指標
  const probability = count > 0 ? Math.min(95, 70 + count) : 60;
  return { count, probability };
}
