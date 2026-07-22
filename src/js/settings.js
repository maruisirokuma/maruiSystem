/** settings.js - 設定（文字サイズ・バックアップ・インポート） */
import { exportAllData, importAllData, dbGetAll, getAllProducts, STORES } from './db.js';
import { showToast, todayStr, applyFontSize, getSavedFontSize } from './app.js';

export async function initSettings(container) { render(container); }

function render(container){
  const cur=getSavedFontSize();
  container.innerHTML=`<div class="page">
    <div class="section-title">表示設定</div>
    <div class="card"><div class="card-body">
      <div class="form-label" style="margin-bottom:12px;">文字の大きさ</div>
      <div class="font-size-group">
        <button class="font-size-btn ${cur==='small'?'active':''}" data-size="small"><span style="font-size:13px;">小</span></button>
        <button class="font-size-btn ${cur==='medium'?'active':''}" data-size="medium"><span style="font-size:16px;">中</span></button>
        <button class="font-size-btn ${cur==='large'?'active':''}" data-size="large"><span style="font-size:20px;">大</span></button>
      </div>
    </div></div>

    <div class="section-title">データ管理</div>
    <div class="card">
      <a class="setting-item" id="expJson" href="#"><span class="setting-icon">💾</span><div class="setting-info"><div class="setting-name">JSONバックアップ出力</div><div class="setting-desc">全データをJSONで保存</div></div><span class="setting-arrow">›</span></a>
      <a class="setting-item" id="expCsv"  href="#"><span class="setting-icon">📊</span><div class="setting-info"><div class="setting-name">CSV出力</div><div class="setting-desc">日報・製造・ロスをCSVで出力</div></div><span class="setting-arrow">›</span></a>
      <a class="setting-item" id="impJson" href="#"><span class="setting-icon">📥</span><div class="setting-info"><div class="setting-name">JSONインポート</div><div class="setting-desc">バックアップから復元</div></div><span class="setting-arrow">›</span></a>
      <input type="file" id="fileInput" accept="application/json" class="d-none"/>
    </div>

    <div class="section-title">アプリ情報</div>
    <div class="card"><div class="card-body">
      <div class="text-muted" style="font-size:14px;">サンドイッチ販売支援システム v2.0</div>
    </div></div>
  </div>`;
  bind(container);
}

function bind(container){
  container.querySelectorAll('.font-size-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      applyFontSize(btn.dataset.size);
      container.querySelectorAll('.font-size-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      showToast('✅ 文字サイズを変更しました');
    });
  });
  container.querySelector('#expJson').addEventListener('click',async e=>{ e.preventDefault(); await exportJson(); });
  container.querySelector('#expCsv').addEventListener('click',async e=>{ e.preventDefault(); await exportCsv(); });
  const fi=container.querySelector('#fileInput');
  container.querySelector('#impJson').addEventListener('click',e=>{ e.preventDefault(); fi.click(); });
  fi.addEventListener('change',async e=>{
    const f=e.target.files[0]; if(!f) return;
    if(!confirm('インポートすると既存データに上書きされます。よろしいですか？')){ fi.value=''; return; }
    try{ await importAllData(JSON.parse(await f.text())); showToast('✅ インポートしました'); }
    catch{ showToast('⚠️ インポートに失敗しました'); }
    fi.value='';
  });
}

async function exportJson(){
  const data=await exportAllData();
  dl(JSON.stringify(data,null,2),`sandwich-backup-${todayStr()}.json`,'application/json');
  showToast('✅ バックアップを出力しました');
}

async function exportCsv(){
  const products=await getAllProducts();
  const pm={}; products.forEach(p=>pm[p.id]=p.name);
  const mfg=await dbGetAll(STORES.MFG), loss=await dbGetAll(STORES.LOSS), rep=await dbGetAll(STORES.REPORT);
  let csv='【日報】\n日付,売上,客数,客単価,名前,本文\n';
  rep.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{ csv+=[r.date,r.sales,r.customers,r.unitPrice,q(r.name),q(r.body)].join(',')+'\n'; });
  csv+='\n【製造記録】\n日付,商品名,個数,小計\n';
  mfg.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{ (r.items||[]).forEach(i=>{ csv+=[r.date,q(pm[i.productId]||''),i.count,i.subtotal].join(',')+'\n'; }); });
  csv+='\n【ロス記録】\n日付,商品名,20%,30%,50%,割引金額,ロス個数,ロス金額\n';
  loss.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{ (r.items||[]).forEach(i=>{ csv+=[r.date,q(pm[i.productId]||''),i.discount20,i.discount30,i.discount50,i.discountPrice,i.lossCount,i.lossPrice].join(',')+'\n'; }); });
  dl('\uFEFF'+csv,`sandwich-data-${todayStr()}.csv`,'text/csv');
  showToast('✅ CSVを出力しました');
}

function q(s){ if(s==null) return ''; const v=String(s).replace(/"/g,'""'); return (v.includes(',')||v.includes('\n')||v.includes('"'))?`"${v}"`:v; }
function dl(content,filename,mime){ const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([content],{type:mime})),download:filename}); document.body.appendChild(a); a.click(); document.body.removeChild(a); }
