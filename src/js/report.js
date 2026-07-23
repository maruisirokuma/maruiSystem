/** report.js - 日報（自動保存・コピーのみ） */
import { dbGet, dbPut, STORES } from './db.js';
import { showToast, todayStr, getWeekdayStr, escHtml } from './app.js';

let data={sales:0,customers:0,body:'',name:''}, timer=null;

export async function initReport(container) {
  const existing=await dbGet(STORES.REPORT,todayStr());
  data=existing?{sales:existing.sales,customers:existing.customers,body:existing.body,name:existing.name}:{sales:0,customers:0,body:'',name:''};
  render(container);
}

function unitPrice(){ return data.customers?Math.round(data.sales/data.customers):0; }

function buildText(){
  const d=todayStr(),[,m,dd]=d.split('-'),wd=getWeekdayStr(d);
  return `お疲れ様です。\n丸井店舗売上報告をいたします。\n${Number(m)}月${Number(dd)}日 ${wd}曜日\n総売上 ${data.sales.toLocaleString()}円\n客数 ${data.customers}人\n客単価 ${unitPrice().toLocaleString()}円\n総括\n${data.body}\n${data.name}`;
}

function render(container){
  const d=todayStr(),[,m,dd]=d.split('-'),wd=getWeekdayStr(d);
  container.innerHTML=`
    <div class="page">
      <div class="card">
        <div class="card-header"><span class="card-header-icon">📅</span>${Number(m)}月${Number(dd)}日（${wd}）
          <span id="autoChip" class="chip" style="margin-left:auto;font-size:11px;"></span>
        </div>
        <div class="card-body">
          <div class="form-group"><label class="form-label">売上（円）</label>
            <input type="number" class="form-input" id="sales" inputmode="numeric" value="${data.sales||''}" placeholder="例：85000"/></div>
          <div class="form-group"><label class="form-label">客数（人）</label>
            <input type="number" class="form-input" id="customers" inputmode="numeric" value="${data.customers||''}" placeholder="例：120"/></div>
          <div class="form-group mb-sm"><label class="form-label">客単価（自動）</label>
            <div class="chip" id="unitChip">${unitPrice().toLocaleString()}円</div></div>
          <div class="form-group"><label class="form-label">総括（本文）</label>
            <textarea class="form-textarea" id="body" placeholder="申し送り等">${data.body}</textarea></div>
          <div class="form-group"><label class="form-label">名前</label>
            <input type="text" class="form-input" id="name" value="${data.name}" placeholder="例：山田"/></div>
        </div>
      </div>
      <div class="section-title">プレビュー</div>
      <div class="report-preview" id="preview">${escHtml(buildText())}</div>
      <button class="btn btn-accent btn-full mt-md" id="copyBtn">📋 LINEにコピー</button>
    </div>`;
  bind(container);
}

function bind(container){
  const upd=()=>{
    data.sales=Number(container.querySelector('#sales').value)||0;
    data.customers=Number(container.querySelector('#customers').value)||0;
    data.body=container.querySelector('#body').value;
    data.name=container.querySelector('#name').value;
    container.querySelector('#unitChip').textContent=unitPrice().toLocaleString()+'円';
    container.querySelector('#preview').textContent=buildText();
    const chip=container.querySelector('#autoChip');
    chip.textContent='保存中…';
    clearTimeout(timer);
    timer=setTimeout(async()=>{
      await autoSave();
      chip.textContent='✅ 自動保存済み';
      setTimeout(()=>chip.textContent='',2000);
    },2000);
  };
  ['#sales','#customers','#body','#name'].forEach(sel=>container.querySelector(sel).addEventListener('input',upd));
  container.querySelector('#copyBtn').addEventListener('click',async()=>{
    try{ await navigator.clipboard.writeText(buildText()); }
    catch{ const ta=document.createElement('textarea'); ta.value=buildText(); ta.style.cssText='position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    showToast('✅ コピーしました');
  });
}
async function autoSave(){
  await dbPut(STORES.REPORT,{date:todayStr(),sales:data.sales,customers:data.customers,unitPrice:unitPrice(),body:data.body,name:data.name});
}
