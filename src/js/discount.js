/**
 * discount.js - 割引分析画面
 * タブ1: 割引分析（在庫入力・グラフ・完売予測・割引推奨）
 * タブ2: 追加製造支援（時刻別推奨・おすすめ商品・記録）
 */
import { dbGet, dbGetAll, dbPut, STORES, getActiveProducts } from './db.js';
import { showToast, todayStr, getWeekdayStr, nowTimeStr, escHtml } from './app.js';
import {
  generateTimeSlots, calcIdealStock, getWeekdayAverageStock,
  getYesterdayStock, predictSoldOut, getDiscountRecommendation,
  getManufactureRecommendation, getProductRecommendations, toMin,
} from './predict.js';

let record=null, idealStock={}, weekdayAvg={}, yesterdayStock={};
let products=[], mfgRecords=[], lossRecords=[];
let currentTab='analysis';
let chartInst=null;
const SLOTS=generateTimeSlots();

export async function initDiscount(container) {
  const today=todayStr(), wd=getWeekdayStr(today);
  const existing=await dbGet(STORES.DISCOUNT, today);
  record=existing||{date:today,weekday:wd,inventoryLogs:[],discountLogs:[],manufactureLogs:[],hourlySales:{},hourlyCustomers:{}};

  [weekdayAvg, yesterdayStock, products, mfgRecords, lossRecords] = await Promise.all([
    getWeekdayAverageStock(wd,[today]),
    getYesterdayStock(),
    getActiveProducts(),
    dbGetAll(STORES.MFG),
    dbGetAll(STORES.LOSS),
  ]);
  idealStock=await calcIdealStock(wd);
  render(container);
}

/* ============================================================ 共通 */
function getStock(t){ const l=record.inventoryLogs.find(l=>l.time===t); return l?l.stock:null; }
function setStock(t,v){
  const idx=record.inventoryLogs.findIndex(l=>l.time===t);
  if(v===''||v==null){ if(idx>=0) record.inventoryLogs.splice(idx,1); return; }
  if(idx>=0) record.inventoryLogs[idx].stock=Number(v);
  else record.inventoryLogs.push({time:t,stock:Number(v)});
}
function latestLog(){ return [...record.inventoryLogs].sort((a,b)=>b.time.localeCompare(a.time))[0]||null; }
function fmtJP(d){ const[,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }

/* ============================================================ メインレンダー */
function render(container) {
  const today=todayStr(), wd=getWeekdayStr(today);
  const latest=latestLog();
  const prediction=predictSoldOut(record.inventoryLogs, idealStock);
  const nowT=nowTimeStr();
  const nearSlot=[...SLOTS].filter(t=>t<=nowT).pop()||SLOTS[0];
  const rec=latest?getDiscountRecommendation(latest.stock, idealStock[nearSlot], prediction):{show:false,rate:0,reasons:[]};

  container.innerHTML=`
    <div class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span class="text-muted" style="font-size:13px;">${fmtJP(today)}（${wd}曜日）</span>
        <button class="btn btn-ghost btn-sm" id="histBtn">📅 過去データ</button>
      </div>

      <!-- タブ -->
      <div class="tab-bar">
        <button class="tab-btn ${currentTab==='analysis'?'active':''}" data-tab="analysis">📈 割引分析</button>
        <button class="tab-btn ${currentTab==='manufacture'?'active':''}" data-tab="manufacture">➕ 追加製造支援</button>
      </div>

      ${currentTab==='analysis'
        ? renderAnalysisTab(prediction, rec, latest, nearSlot)
        : renderManufactureTab(wd, nowT)}
    </div>

    <button class="fab-save" id="saveBtn"><span class="fab-save-icon">💾</span><span>保存</span></button>

    <!-- 過去データモーダル -->
    <div class="modal-overlay d-none" id="histModal">
      <div class="modal">
        <div class="modal-title">過去の割引分析データ<button class="modal-close" id="histClose">✕</button></div>
        <div id="histList"></div>
      </div>
    </div>
  `;

  bindEvents(container);
  if(currentTab==='analysis') renderChart(container);
}

/* ============================================================ 割引分析タブ */
function renderAnalysisTab(prediction, rec, latest, nearSlot) {
  return `
    <!-- 完売予測 -->
    <div class="predict-bar">
      <div class="predict-percent">${prediction.probability}%</div>
      <div class="predict-info">
        <div class="predict-title">完売確率</div>
        <div class="predict-time">${prediction.predictedTime?'予測完売時刻 '+prediction.predictedTime:'在庫を入力してください'}</div>
      </div>
    </div>

    <!-- 割引推奨 -->
    ${rec.show?`<div class="recommend-banner">
      <div class="recommend-title">🏷️ ${rec.rate}%割引を推奨</div>
      <ul class="recommend-reasons">${rec.reasons.map(r=>`<li>${escHtml(r)}</li>`).join('')}</ul>
    </div>`:''}

    <!-- 割引ボタン -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">🏷️</span>割引開始記録</div>
      <div class="card-body">
        <div class="btn-group mb-md">
          <button class="btn btn-outline disc-start" data-rate="20">20%開始</button>
          <button class="btn btn-outline disc-start" data-rate="30">30%開始</button>
          <button class="btn btn-outline disc-start" data-rate="50">50%開始</button>
        </div>
        ${record.discountLogs.length>0?`
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${record.discountLogs.map((d,i)=>`
              <span class="disc-badge disc-${d.rate}">${d.time} ${d.rate}%
                <span style="cursor:pointer;margin-left:4px;" class="del-disc" data-i="${i}">✕</span>
              </span>`).join('')}
          </div>`
          :'<div class="form-hint">まだ割引は記録されていません</div>'}
      </div>
    </div>

    <!-- 在庫入力 -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">📦</span>在庫入力（10分ごと）</div>
      <div class="card-body">
        <div class="timeline-grid">
          ${SLOTS.map(t=>{
            const v=getStock(t);
            const ideal=idealStock[t];
            const diff=v!=null&&ideal!=null?v-ideal:null;
            const diffColor=diff!=null?(diff>5?'#C62828':diff<-5?'#1565C0':'inherit'):'inherit';
            return `<span class="timeline-time">${t}</span>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" class="timeline-input stock-inp ${v!=null?'has-value':''}" data-t="${t}"
                  value="${v??''}" placeholder="個" inputmode="numeric" min="0"/>
                <span style="font-size:11px;color:${diffColor};min-width:40px;">
                  ${ideal!=null?`理想:${ideal}個`:''}
                  ${diff!=null?`(${diff>0?'+':''}${diff})` : ''}
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- グラフ -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">📈</span>在庫推移グラフ</div>
      <div class="card-body">
        <div style="font-size:11px;color:var(--text-sub);margin-bottom:6px;display:flex;flex-wrap:wrap;gap:8px;">
          <span style="color:#1565C0;">■ 現在</span>
          <span style="color:#1565C0;">■ 理想</span>
          <span style="color:#9E9E9E;">■ 曜日平均</span>
          <span style="color:#F57F17;">■ 昨日</span>
          <span style="color:#C62828;">■ 完売予測</span>
        </div>
        <div class="chart-wrap"><canvas id="stockChart"></canvas></div>
      </div>
    </div>`;
}

/* ============================================================ 追加製造支援タブ */
function renderManufactureTab(wd, nowT) {
  const latest=latestLog();
  const currentStock=latest?latest.stock:null;
  const mfgRec=getManufactureRecommendation(currentStock??0, wd, nowT);
  const prodRec=getProductRecommendations(mfgRecords, lossRecords, products, wd);

  // 時刻別の推奨追加製造数テーブル
  const futureSlots=SLOTS.filter(t=>t>=nowT).slice(0,6);

  return `
    <!-- 現在状況 -->
    <div class="stat-grid mb-md">
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">現在在庫</div>
        <div class="stat-value">${currentStock??'－'}<span class="stat-unit">${currentStock!=null?'個':''}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🎯</div>
        <div class="stat-label">理想在庫（${mfgRec.nearSlot}）</div>
        <div class="stat-value">${mfgRec.idealNow}<span class="stat-unit">個</span></div>
      </div>
    </div>

    <!-- 今すぐの推奨 -->
    <div class="card" style="border-left:4px solid var(--accent);">
      <div class="card-body" style="background:var(--warning-light);">
        <div style="font-size:17px;font-weight:700;color:var(--accent-dark);margin-bottom:4px;">
          🏭 今すぐ追加製造：＋${mfgRec.count}個
        </div>
        <div style="font-size:13px;color:var(--text-sub);">
          ${nowT}時点 / 完売確率 ${mfgRec.probability}% / 理想在庫 ${mfgRec.idealNow}個
        </div>
      </div>
    </div>

    <!-- 時刻別推奨テーブル -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">⏰</span>時刻別 推奨追加製造数</div>
      <div class="card-body" style="padding:0;">
        <table class="tbl">
          <thead><tr><th>時刻</th><th>理想在庫</th><th style="text-align:right;">推奨追加数</th></tr></thead>
          <tbody>
            ${futureSlots.map(t=>{
              const ideal=idealStock[t]??0;
              const add=Math.max(0,ideal-(currentStock??0));
              return `<tr>
                <td>${t}</td>
                <td style="text-align:center;">${ideal}個</td>
                <td style="text-align:right;font-weight:700;color:var(--accent);">＋${add}個</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- おすすめ商品 -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">⭐</span>追加製造おすすめ商品（${wd}曜日 実績）</div>
      <div class="card-body">
        ${prodRec.goodBets.length>0?`
          <div class="section-title mb-sm">よく売れる・ロスが少ない商品</div>
          ${prodRec.goodBets.map(p=>`
            <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
              <span style="flex:1;font-weight:600;">${escHtml(p.name)}</span>
              <span style="font-size:12px;color:var(--text-sub);margin-right:8px;">ロス率${p.lossRate}%</span>
              <span class="chip">累計${p.totalMfg}個</span>
            </div>`).join('')}`
          :'<div class="form-hint">データが蓄積されると表示されます</div>'}

        ${prodRec.risky.length>0?`
          <div class="section-title mb-sm mt-md" style="color:var(--danger);border-color:var(--danger);">⚠️ ロスが多い商品（注意）</div>
          ${prodRec.risky.map(p=>`
            <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
              <span style="flex:1;font-weight:600;">${escHtml(p.name)}</span>
              <span class="chip" style="background:var(--danger-light);color:var(--danger);">ロス率${p.lossRate}%</span>
            </div>`).join('')}`:''}
      </div>
    </div>

    <!-- 追加製造記録 -->
    <div class="card">
      <div class="card-header"><span class="card-header-icon">📝</span>追加製造を記録</div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">時間</label>
          <input type="text" class="form-input" id="mfgTime" value="${nowT}" placeholder="例：17:05"/>
        </div>
        <div style="display:flex;gap:12px;">
          <div class="form-group" style="flex:1;">
            <label class="form-label">おすすめ製造数</label>
            <input type="number" class="form-input" id="mfgRecommend" value="${mfgRec.count}" inputmode="numeric"/>
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label">実際製造数</label>
            <input type="number" class="form-input" id="mfgActual" inputmode="numeric" placeholder="実際の数"/>
          </div>
        </div>
        <button class="btn btn-accent btn-full" id="addMfgBtn">追加製造を記録</button>
        ${record.manufactureLogs.length>0?`
          <div class="mt-md">
            ${record.manufactureLogs.map((m,i)=>`
              <div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
                <span style="flex:1;font-size:14px;">${m.time} 推奨${m.recommendCount}個 → 実際${m.actualCount}個</span>
                <span class="del-mfg" data-i="${i}" style="cursor:pointer;color:var(--danger);padding:4px;">✕</span>
              </div>`).join('')}
          </div>`:''}
      </div>
    </div>`;
}

/* ============================================================ イベント */
function bindEvents(container) {
  // タブ
  container.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ currentTab=btn.dataset.tab; render(container); });
  });

  // 保存
  container.querySelector('#saveBtn').addEventListener('click',async()=>{
    await dbPut(STORES.DISCOUNT,record); showToast('✅ 保存しました');
  });

  // 過去データ
  container.querySelector('#histBtn').addEventListener('click',()=>showHistory(container));
  container.querySelector('#histClose').addEventListener('click',()=>{
    container.querySelector('#histModal').classList.add('d-none');
  });

  if(currentTab==='analysis') {
    // 在庫入力
    container.querySelectorAll('.stock-inp').forEach(inp=>{
      inp.addEventListener('change',()=>{ setStock(inp.dataset.t, inp.value); render(container); });
    });
    // 割引開始
    container.querySelectorAll('.disc-start').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const rate=Number(btn.dataset.rate);
        const t=prompt('割引開始時刻（例: 18:30）', nowTimeStr()); if(!t) return;
        record.discountLogs.push({time:t,rate});
        record.discountLogs.sort((a,b)=>a.time.localeCompare(b.time));
        render(container); showToast(`✅ ${rate}%割引を記録しました`);
      });
    });
    // 割引削除
    container.querySelectorAll('.del-disc').forEach(el=>{
      el.addEventListener('click',()=>{ record.discountLogs.splice(Number(el.dataset.i),1); render(container); });
    });
  }

  if(currentTab==='manufacture') {
    // 追加製造記録
    container.querySelector('#addMfgBtn')?.addEventListener('click',()=>{
      const t=container.querySelector('#mfgTime').value.trim();
      const rec=Number(container.querySelector('#mfgRecommend').value)||0;
      const act=Number(container.querySelector('#mfgActual').value)||0;
      if(!t){ showToast('時間を入力してください'); return; }
      record.manufactureLogs.push({time:t,recommendCount:rec,actualCount:act});
      record.manufactureLogs.sort((a,b)=>a.time.localeCompare(b.time));
      render(container); showToast('✅ 追加製造を記録しました');
    });
    // 追加製造削除
    container.querySelectorAll('.del-mfg').forEach(el=>{
      el.addEventListener('click',()=>{ record.manufactureLogs.splice(Number(el.dataset.i),1); render(container); });
    });
  }
}

/* ============================================================ グラフ */
function renderChart(container) {
  const canvas=container.querySelector('#stockChart');
  if(!canvas||typeof Chart==='undefined') return;
  if(chartInst){ chartInst.destroy(); chartInst=null; }

  const current  = SLOTS.map(t=>getStock(t));
  const ideal    = SLOTS.map(t=>idealStock[t]??null);
  const wdAvg    = SLOTS.map(t=>weekdayAvg[t]??null);
  const yesterday= SLOTS.map(t=>yesterdayStock[t]??null);

  // 完売予測線
  const pred=predictSoldOut(record.inventoryLogs,idealStock);
  const predLine=buildPredLine(pred);

  // 割引開始時刻のアノテーション（縦線の代わりにデータポイントに表示）
  chartInst=new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{
      labels:SLOTS,
      datasets:[
        {label:'現在在庫',  data:current,   borderColor:'#1565C0',backgroundColor:'rgba(21,101,192,.1)',borderWidth:3,tension:.3,spanGaps:true},
        {label:'理想在庫',  data:ideal,     borderColor:'#1565C0',borderDash:[6,4],borderWidth:2,tension:.3,spanGaps:true,pointRadius:0},
        {label:'曜日平均',  data:wdAvg,     borderColor:'#9E9E9E',borderDash:[2,2],borderWidth:1.5,tension:.3,spanGaps:true,pointRadius:0},
        {label:'昨日',      data:yesterday, borderColor:'#F57F17',borderWidth:1.5,tension:.3,spanGaps:true,pointRadius:0},
        {label:'完売予測',  data:predLine,  borderColor:'#C62828',borderDash:[4,4],borderWidth:2,tension:0,spanGaps:true,pointRadius:0},
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false}},
      scales:{
        y:{beginAtZero:true,title:{display:true,text:'在庫数'}},
        x:{ticks:{maxRotation:60,minRotation:60,font:{size:10}}},
      }
    }
  });
}

function buildPredLine(pred) {
  const sorted=[...record.inventoryLogs].sort((a,b)=>a.time.localeCompare(b.time));
  if(!sorted.length||!pred.predictedTime) return SLOTS.map(()=>null);
  const last=sorted[sorted.length-1];
  return SLOTS.map(t=>{
    if(t<last.time) return null;
    if(toMin(t)>=toMin(pred.predictedTime)) return 0;
    const total=toMin(pred.predictedTime)-toMin(last.time);
    const elapsed=toMin(t)-toMin(last.time);
    return total<=0?last.stock:Math.max(0,Math.round(last.stock*(1-elapsed/total)));
  });
}

/* ============================================================ 過去データ */
async function showHistory(container) {
  const all=await dbGetAll(STORES.DISCOUNT);
  const today=todayStr();
  const past=all.filter(r=>r.date!==today).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  const listEl=container.querySelector('#histList');
  listEl.innerHTML=past.length===0
    ? '<div class="empty-state"><div class="empty-text">過去データがありません</div></div>'
    : past.map(r=>{
        const pred=predictSoldOut(r.inventoryLogs||[]);
        const discTimes=(r.discountLogs||[]).map(d=>`${d.time}(${d.rate}%)`).join(' ');
        return `<div class="history-item" data-date="${r.date}">
          <div class="history-date">${fmtJP(r.date)}（${r.weekday||getWeekdayStr(r.date)}）</div>
          <div class="history-meta">
            在庫データ${(r.inventoryLogs||[]).length}点
            ${discTimes?` ／ 割引: ${discTimes}`:''}
          </div>
        </div>`;
      }).join('');
  listEl.querySelectorAll('.history-item').forEach(el=>{
    el.addEventListener('click',()=>{
      const rec=past.find(r=>r.date===el.dataset.date); if(!rec) return;
      record={...rec,date:todayStr(),weekday:getWeekdayStr(todayStr())};
      container.querySelector('#histModal').classList.add('d-none');
      render(container); showToast(`✅ ${fmtJP(rec.date)}のデータを参照しています`);
    });
  });
  container.querySelector('#histModal').classList.remove('d-none');
}

function fmtJP(d){ const[,m,dd]=d.split('-'); return `${Number(m)}月${Number(dd)}日`; }
