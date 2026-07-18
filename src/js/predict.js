/**
 * predict.js - 完売予測・割引推奨・追加製造支援
 * 実測データ（160件 2024-07〜2025-06）から算出した曜日別理想在庫を内蔵
 */
import { dbGetAll, STORES } from './db.js';

/* ============================================================
   実測データから算出した曜日別・時刻別 理想在庫（平均値）
   金曜はサンプル2件のみのため近似値を使用
============================================================ */
const IDEAL = {
  '月': { '17:00':46,'17:10':45,'17:20':43,'17:30':41,'17:40':39,'17:50':37,'18:00':35,'18:10':33,'18:20':31,'18:30':28,'18:40':25,'18:50':21,'19:00':18,'19:10':15,'19:20':10,'19:30':7,'19:40':3,'19:50':1,'20:00':0 },
  '火': { '17:00':49,'17:10':46,'17:20':44,'17:30':42,'17:40':40,'17:50':38,'18:00':36,'18:10':34,'18:20':31,'18:30':28,'18:40':24,'18:50':18,'19:00':16,'19:10':12,'19:20':8,'19:30':6,'19:40':3,'19:50':1,'20:00':0 },
  '水': { '17:00':48,'17:10':46,'17:20':44,'17:30':43,'17:40':40,'17:50':37,'18:00':35,'18:10':33,'18:20':30,'18:30':27,'18:40':23,'18:50':20,'19:00':16,'19:10':11,'19:20':9,'19:30':6,'19:40':3,'19:50':0,'20:00':0 },
  '木': { '17:00':54,'17:10':51,'17:20':48,'17:30':45,'17:40':42,'17:50':40,'18:00':37,'18:10':34,'18:20':31,'18:30':27,'18:40':24,'18:50':20,'19:00':17,'19:10':13,'19:20':9,'19:30':6,'19:40':3,'19:50':1,'20:00':0 },
  '金': { '17:00':55,'17:10':52,'17:20':50,'17:30':47,'17:40':44,'17:50':41,'18:00':37,'18:10':34,'18:20':31,'18:30':27,'18:40':23,'18:50':19,'19:00':15,'19:10':11,'19:20':7,'19:30':3,'19:40':2,'19:50':0,'20:00':0 },
  '土': { '17:00':57,'17:10':54,'17:20':51,'17:30':49,'17:40':45,'17:50':42,'18:00':39,'18:10':35,'18:20':33,'18:30':30,'18:40':27,'18:50':23,'19:00':18,'19:10':14,'19:20':10,'19:30':7,'19:40':3,'19:50':1,'20:00':0 },
  '日': { '17:00':45,'17:10':41,'17:20':38,'17:30':35,'17:40':34,'17:50':33,'18:00':32,'18:10':30,'18:20':27,'18:30':25,'18:40':21,'18:50':18,'19:00':16,'19:10':12,'19:20':9,'19:30':6,'19:40':4,'19:50':1,'20:00':0 },
};

/** 割引時刻の統計（実測データより） */
const DISC_STATS = {
  '20%': { mode:'18:20', avg:'18:19' },
  '30%': { mode:'19:00', avg:'19:07' },
  '50%': { mode:'19:40', avg:'19:39' },
};

export const DISC_STATS_PUBLIC = DISC_STATS;

export function generateTimeSlots() {
  const s = [];
  for (let h=17;h<=20;h++) for(let m=0;m<60;m+=10) { if(h===20&&m>0)break; s.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`); }
  return s;
}

/** 理想在庫を返す（DBの蓄積データが3件以上あればそちらを優先） */
export async function calcIdealStock(weekday) {
  const dbAvg = await getWeekdayAverageStock(weekday, []);
  const slots = generateTimeSlots();
  const hist  = IDEAL[weekday] || IDEAL['月'];
  const result = {};
  slots.forEach(t => { result[t] = (dbAvg[t] != null) ? dbAvg[t] : (hist[t] ?? 0); });
  return result;
}

export async function getWeekdayAverageStock(weekday, excludeDates=[]) {
  const all  = await dbGetAll(STORES.DISCOUNT);
  const same = all.filter(r => r.weekday===weekday && !excludeDates.includes(r.date));
  const slots = generateTimeSlots();
  const result = {};
  slots.forEach(t => {
    const vals = same.map(r=>(r.inventoryLogs||[]).find(l=>l.time===t)?.stock).filter(v=>v!=null);
    result[t] = vals.length >= 3 ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
  });
  return result;
}

export async function getYesterdayStock() {
  const d = new Date(); d.setDate(d.getDate()-1);
  const ystr = fmtDate(d);
  const all = await dbGetAll(STORES.DISCOUNT);
  const rec = all.find(r=>r.date===ystr);
  const slots = generateTimeSlots();
  const result = {};
  slots.forEach(t => { const l = rec?(rec.inventoryLogs||[]).find(l=>l.time===t):null; result[t]=l?l.stock:null; });
  return result;
}

function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

export function getIdeal17(weekday) { return IDEAL[weekday]?.['17:00'] ?? 48; }

/**
 * 完売予測 - 直近の減少ペースと理想在庫の両方を考慮した高精度モデル
 */
export function predictSoldOut(inventoryLogs, idealStock={}) {
  if (!inventoryLogs || inventoryLogs.length < 2) return { probability:0, predictedTime:null };

  const sorted = [...inventoryLogs].sort((a,b)=>a.time.localeCompare(b.time));
  const last = sorted[sorted.length-1];

  // 直近4点で平均ペースを計算
  const span = sorted.slice(Math.max(0,sorted.length-4));
  const first = span[0];
  const minsDiff = toMin(last.time)-toMin(first.time);
  const stockDiff = first.stock-last.stock;

  if (minsDiff<=0 || stockDiff<=0) return { probability:15, predictedTime:null };

  const rate = stockDiff/minsDiff;
  const minsToZero = last.stock/rate;
  const predMin = toMin(last.time)+minsToZero;
  const closeMin = toMin('20:00');

  // 理想在庫との乖離も考慮して補正
  const idealNow = idealStock[last.time];
  let bonus = 0;
  if (idealNow!=null) {
    const diff = last.stock - idealNow;
    if (diff < -5) bonus = -10; // 在庫が理想より少ない→完売しやすい
    if (diff >  5) bonus =  10; // 在庫が理想より多い→完売しにくい
  }

  let prob;
  if (predMin<=closeMin) {
    const margin = closeMin-predMin;
    prob = Math.min(99, Math.round(65+margin/1.5) + bonus);
  } else {
    const over = predMin-closeMin;
    prob = Math.max(5, Math.round(55-over*1.5) + bonus);
  }

  return {
    probability: Math.max(0,Math.min(99,prob)),
    predictedTime: minsToTime(Math.round(predMin)),
  };
}

export function getDiscountRecommendation(currentStock, idealStock, prediction) {
  const reasons = [];
  let rate = 0;
  if (idealStock!=null && currentStock>idealStock) {
    const over = Math.round(currentStock-idealStock);
    reasons.push(`現在在庫が理想在庫を${over}個上回っています`);
    if      (over>=15) rate=50;
    else if (over>=8)  rate=30;
    else if (over>=3)  rate=20;
  }
  if (prediction.predictedTime) reasons.push(`完売予測時刻：${prediction.predictedTime}`);
  if (prediction.probability<50 && rate===0) { rate=20; reasons.push('完売確率が低いため早めの割引を検討してください'); }
  return { show:rate>0, rate, reasons };
}

/**
 * 追加製造推奨 - 現在時刻の理想在庫との差分で計算
 * @param {number} currentStock 現在在庫
 * @param {string} weekday 曜日
 * @param {string} currentTime 現在時刻 HH:MM
 */
export function getManufactureRecommendation(currentStock, weekday, currentTime='17:00') {
  const slots = generateTimeSlots();
  // 現在時刻に最も近いスロットの理想在庫
  const nearSlot = [...slots].filter(t=>t<=currentTime).pop() || '17:00';
  const idealNow = IDEAL[weekday]?.[nearSlot] ?? getIdeal17(weekday);
  const count = Math.max(0, Math.round(idealNow - currentStock));
  const prob  = count>0 ? Math.min(95,60+Math.round(count*0.8)) : 55;
  return { count, probability:prob, idealNow, nearSlot };
}

/**
 * 過去データからおすすめ商品を分析
 * @param {Array} mfgRecords 製造記録
 * @param {Array} lossRecords ロス記録
 * @param {Array} products 商品マスタ
 * @param {string} weekday 曜日
 */
export function getProductRecommendations(mfgRecords, lossRecords, products, weekday) {
  // 同曜日のデータを優先
  const sameDayMfg  = mfgRecords.filter(r => r.weekday===weekday || !r.weekday);
  const sameDayLoss = lossRecords.filter(r => r.weekday===weekday || !r.weekday);

  const productMap = {};
  products.forEach(p => {
    productMap[p.id] = { name:p.name, price:p.price, cost:p.cost,
      totalMfg:0, totalLoss:0, totalDiscount:0, lossRate:0 };
  });

  sameDayMfg.forEach(r  => (r.items||[]).forEach(i  => { if(productMap[i.productId]) productMap[i.productId].totalMfg+=i.count; }));
  sameDayLoss.forEach(r => (r.items||[]).forEach(i  => {
    if(!productMap[i.productId]) return;
    productMap[i.productId].totalLoss     += i.lossCount||0;
    productMap[i.productId].totalDiscount += (i.discount20||0)+(i.discount30||0)+(i.discount50||0);
  }));

  // ロス率を算出
  Object.values(productMap).forEach(p => {
    if (p.totalMfg>0) p.lossRate = Math.round(p.totalLoss/p.totalMfg*100);
  });

  const list = Object.entries(productMap)
    .filter(([,p])=>p.totalMfg>0)
    .map(([id,p])=>({id,...p}));

  // 売れ筋（製造数多い順）
  const bestsellers = [...list].sort((a,b)=>b.totalMfg-a.totalMfg).slice(0,5);

  // ロスが少なく売れ筋（追加製造おすすめ）
  const goodBets = [...list]
    .filter(p=>p.lossRate<15 && p.totalMfg>3)
    .sort((a,b)=>b.totalMfg-a.totalMfg).slice(0,3);

  // ロス多め（注意）
  const risky = [...list]
    .filter(p=>p.lossRate>=20 && p.totalLoss>0)
    .sort((a,b)=>b.lossRate-a.lossRate).slice(0,3);

  return { bestsellers, goodBets, risky };
}

export function toMin(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function minsToTime(m) { const h=Math.floor(m/60)%24; const mm=Math.round(m%60); return `${String(h).padStart(2,'0')}:${String(Math.max(0,mm)).padStart(2,'0')}`; }