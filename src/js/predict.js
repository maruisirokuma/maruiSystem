/**
 * predict.js - 完売予測・割引推奨・追加製造支援の計算ロジック
 *
 * 理想在庫（17:00時点の推奨個数）
 *   月・火・水 → 48個
 *   木・金     → 55個
 *   土         → 60個
 *   日         → 48個（暫定）
 */

import { dbGetAll, STORES } from './db.js';

/* ------------------------------------------------
   曜日別 17:00 推奨在庫（実店舗データより）
------------------------------------------------ */
const IDEAL_17_BY_WEEKDAY = {
  '日': 48, '月': 48, '火': 48, '水': 48,
  '木': 55, '金': 55, '土': 60,
};

/**
 * 17:00〜20:00の10分刻み時刻リストを生成
 */
export function generateTimeSlots() {
  const slots = [];
  for (let h = 17; h <= 20; h++) {
    for (let m = 0; m < 60; m += 10) {
      if (h === 20 && m > 0) break;
      slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return slots; // 19スロット: 17:00〜20:00
}

/**
 * 過去の同曜日データから曜日別平均在庫を算出
 * データがない時刻は null を返す（グラフ上で線が途切れる）
 */
export async function getWeekdayAverageStock(weekday, excludeDates = []) {
  const all = await dbGetAll(STORES.DISCOUNT_ANALYSIS);
  const sameDay = all.filter(r => r.weekday === weekday && !excludeDates.includes(r.date));
  const slots = generateTimeSlots();
  const result = {};

  slots.forEach(time => {
    const values = sameDay
      .map(r => (r.inventoryLogs || []).find(l => l.time === time)?.stock)
      .filter(v => v != null);
    result[time] = values.length > 0
      ? Math.round(values.reduce((a,b) => a+b, 0) / values.length)
      : null;
  });

  return result;
}

/**
 * 昨日の在庫ログを取得
 */
export async function getYesterdayStock() {
  const yesterday = getYesterdayStr();
  const all = await dbGetAll(STORES.DISCOUNT_ANALYSIS);
  const record = all.find(r => r.date === yesterday);
  const slots = generateTimeSlots();
  const result = {};
  slots.forEach(time => {
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
 * 理想在庫を計算（Version1: 曜日別平均 or 実績ベース推奨数）
 * - 過去データがあるスロットは平均値
 * - 過去データがないスロットは 17:00 推奨数から線形に減少する想定ラインを使用
 */
export function calcIdealStock(weekdayAvg, weekday) {
  const slots = generateTimeSlots();
  const base17 = IDEAL_17_BY_WEEKDAY[weekday] ?? 48;
  // 17:00〜20:00 で完売(0個)になるよう線形に減少する理想ライン
  const totalSlots = slots.length - 1; // 18段階

  const result = {};
  slots.forEach((time, i) => {
    if (weekdayAvg[time] != null) {
      result[time] = weekdayAvg[time];
    } else {
      // 線形補間: 17:00=base17, 20:00=0
      result[time] = Math.max(0, Math.round(base17 * (1 - i / totalSlots)));
    }
  });
  return result;
}

/**
 * 17:00時点の推奨在庫数を返す（曜日ごと）
 */
export function getIdeal17(weekday) {
  return IDEAL_17_BY_WEEKDAY[weekday] ?? 48;
}

/**
 * 完売予測：在庫減少ペースから完売時刻・確率を算出
 */
export function predictSoldOut(inventoryLogs) {
  if (!inventoryLogs || inventoryLogs.length < 2) {
    return { probability: 0, predictedTime: null };
  }

  const sorted = [...inventoryLogs].sort((a,b) => a.time.localeCompare(b.time));
  const last = sorted[sorted.length - 1];

  // 直近3点の平均ペースで計算（急激な変化を平滑化）
  const span = sorted.slice(Math.max(0, sorted.length - 4));
  const first = span[0];
  const minutesDiff = toMinutes(last.time) - toMinutes(first.time);
  const stockDiff = first.stock - last.stock;

  if (minutesDiff <= 0 || stockDiff <= 0) {
    return { probability: 15, predictedTime: null };
  }

  const ratePerMin = stockDiff / minutesDiff;
  const minsToZero = last.stock / ratePerMin;
  const predictedMins = toMinutes(last.time) + minsToZero;
  const closeMins = toMinutes('20:00');

  let probability;
  if (predictedMins <= closeMins) {
    const margin = closeMins - predictedMins;
    probability = Math.min(99, Math.round(65 + margin / 1.5));
  } else {
    const overrun = predictedMins - closeMins;
    probability = Math.max(5, Math.round(55 - overrun * 1.5));
  }

  return {
    probability: Math.max(0, Math.min(99, probability)),
    predictedTime: minsToTime(Math.round(predictedMins)),
  };
}

/**
 * 割引推奨を算出
 */
export function getDiscountRecommendation(currentStock, idealStock, prediction) {
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
    reasons.push(`完売予測時刻：${prediction.predictedTime}`);
  }

  if (prediction.probability < 50 && rate === 0) {
    rate = 20;
    reasons.push('完売確率が低いため早めの割引を検討してください');
  }

  return { show: rate > 0, rate, reasons };
}

/**
 * 追加製造の推奨数を算出（17:00時点）
 */
export function getManufactureRecommendation(currentStock, weekday) {
  const ideal17 = getIdeal17(weekday);
  const count = Math.max(0, ideal17 - currentStock);
  const probability = count > 0
    ? Math.min(95, 60 + Math.round(count * 0.8))
    : 55;
  return { count, probability, ideal17 };
}

export function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minsToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2,'0')}:${String(Math.max(0,m)).padStart(2,'0')}`;
}
