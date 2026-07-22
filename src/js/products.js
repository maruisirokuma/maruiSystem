/** products.js - 商品管理 */
import { dbPut, dbGetAll, STORES, getAllProducts } from './db.js';
import { showToast, escHtml } from './app.js';

let products=[];

export async function initProducts(container) {
  products=await getAllProducts(); render(container);
}

function render(container){
  const active=products.filter(p=>p.isActive), inactive=products.filter(p=>!p.isActive);
  container.innerHTML=`
    <div class="page">
      <div class="card">
        <div class="card-header"><span class="card-header-icon">🛒</span>商品一覧</div>
        <div class="card-body" style="padding:0;">
          ${active.length===0?'<div class="empty-state"><div class="empty-text">商品がありません</div></div>':active.map(p=>row(p,true)).join('')}
        </div>
      </div>
      <button class="btn btn-primary btn-full mb-md" id="addBtn">＋ 商品を追加</button>
      ${inactive.length?`<div class="section-title">販売終了</div><div class="card"><div class="card-body" style="padding:0;">${inactive.map(p=>row(p,false)).join('')}</div></div>`:''}
    </div>

    <div class="modal-overlay d-none" id="modalOverlay">
      <div class="modal">
        <div class="modal-title" id="modalTitle">商品を追加<button class="modal-close" id="modalClose">✕</button></div>
        <form id="productForm">
          <input type="hidden" id="pid"/>
          <div class="form-group"><label class="form-label">商品名</label><input type="text" class="form-input" id="pname" required/></div>
          <div class="form-group"><label class="form-label">カテゴリ</label><input type="text" class="form-input" id="pcat" placeholder="例：フルーツ系"/></div>
          <div class="form-group"><label class="form-label">税込価格（円）</label><input type="number" class="form-input" id="pprice" inputmode="numeric" required min="0"/></div>
          <div class="form-group"><label class="form-label">原価（円）</label><input type="number" class="form-input" id="pcost" inputmode="numeric" required min="0"/></div>
          <div class="btn-group mt-md"><button type="button" class="btn btn-ghost" id="cancelBtn">キャンセル</button><button type="submit" class="btn btn-primary">保存</button></div>
        </form>
      </div>
    </div>`;
  bind(container);
}

function row(p,isActive){
  return `<div class="product-item ${isActive?'':'product-inactive'}" data-id="${p.id}">
    <div class="product-info">
      <div class="product-name">${escHtml(p.name)}</div>
      <div class="product-meta">${p.category?escHtml(p.category)+' / ':''}${p.price}円（原価${p.cost}円）</div>
    </div>
    <div class="product-actions">
      <button class="btn btn-sm btn-outline edit-btn" data-id="${p.id}">編集</button>
      ${isActive?`<button class="btn btn-sm btn-danger end-btn" data-id="${p.id}">終了</button>`
               :`<button class="btn btn-sm btn-primary restore-btn" data-id="${p.id}">復活</button>`}
    </div>
  </div>`;
}

function bind(container){
  const overlay=container.querySelector('#modalOverlay');
  const open=(p)=>{
    container.querySelector('#modalTitle').childNodes[0].textContent=p?'商品を編集':'商品を追加';
    container.querySelector('#pid').value=p?p.id:'';
    container.querySelector('#pname').value=p?p.name:'';
    container.querySelector('#pcat').value=p?p.category||'':'';
    container.querySelector('#pprice').value=p?p.price:'';
    container.querySelector('#pcost').value=p?p.cost:'';
    overlay.classList.remove('d-none');
  };
  const close=()=>overlay.classList.add('d-none');

  container.querySelector('#addBtn').addEventListener('click',()=>open(null));
  container.querySelector('#modalClose').addEventListener('click',close);
  container.querySelector('#cancelBtn').addEventListener('click',close);
  overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });

  container.querySelectorAll('.edit-btn').forEach(btn=>{
    btn.addEventListener('click',()=>open(products.find(p=>p.id==btn.dataset.id)));
  });
  container.querySelectorAll('.end-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!confirm('販売終了にしますか？')) return;
      const p=products.find(p=>p.id==btn.dataset.id); p.isActive=false;
      await dbPut(STORES.PRODUCTS,p); showToast('✅ 販売終了にしました');
      products=await getAllProducts(); render(container);
    });
  });
  container.querySelectorAll('.restore-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const p=products.find(p=>p.id==btn.dataset.id); p.isActive=true;
      await dbPut(STORES.PRODUCTS,p); showToast('✅ 販売を再開しました');
      products=await getAllProducts(); render(container);
    });
  });

  container.querySelector('#productForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const id=container.querySelector('#pid').value;
    const name=container.querySelector('#pname').value.trim();
    const cat=container.querySelector('#pcat').value.trim();
    const price=Number(container.querySelector('#pprice').value);
    const cost=Number(container.querySelector('#pcost').value);
    if(!name){ showToast('商品名を入力してください'); return; }
    if(id){
      const p=products.find(p=>p.id==id); Object.assign(p,{name,category:cat,price,cost});
      await dbPut(STORES.PRODUCTS,p); showToast('✅ 更新しました');
    } else {
      const maxOrder=products.reduce((m,p)=>Math.max(m,p.sortOrder||0),0);
      await dbPut(STORES.PRODUCTS,{name,category:cat,price,cost,sortOrder:maxOrder+1,isActive:true});
      showToast('✅ 追加しました');
    }
    close(); products=await getAllProducts(); render(container);
  });
}
