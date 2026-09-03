import {
  $, adminApi, requireAuth, openModal, closeModal, confirmDialog, toast, logout,
  fmtDateTime, escapeHtml, TYPE_TEXT, ITEM_STATUS_TEXT, notifyChanged, downloadExport
} from './common.js';
import { startPolling } from '../../js/common.js';

let items = [];
let statusFilter = '';
let searchText = '';

async function load() {
  items = await adminApi('/admin/items');
  renderChips();
  render();
}

function counts() {
  const c = {};
  for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}

function renderChips() {
  const c = counts();
  const defs = [
    ['', `全部 ${items.length}`],
    ['available', `可取 ${c.available || 0}`],
    ['reserved', `保留中 ${c.reserved || 0}`],
    ['taken', `已取走 ${c.taken || 0}`],
    ['sold', `已售出 ${c.sold || 0}`]
  ];
  $('#chip-row').innerHTML = defs.map(([v, label]) =>
    `<button class="chip ${v === statusFilter ? 'active' : ''}" data-status="${v}">${escapeHtml(label)}</button>`).join('');
}

function render() {
  let list = items;
  if (statusFilter) list = list.filter((i) => i.status === statusFilter);
  const q = searchText.trim().toLowerCase();
  if (q) list = list.filter((i) => (i.name || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q));
  const body = $('#items-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gray-600)">沒有符合條件的物品。</td></tr>`;
    return;
  }
  body.innerHTML = list.map((i) => {
    const price = i.type === 'free' ? '免費' : `HK$${Number(i.price).toLocaleString()}`;
    return `
      <tr>
        <td>
          <div style="display:flex;gap:10px;align-items:center;min-width:200px">
            <img class="thumb" src="${escapeHtml(i.image_url || '')}" alt="" onerror="this.style.visibility='hidden'">
            <div>
              <div class="name">${escapeHtml(i.name)}</div>
              <div style="font-size:12px;color:var(--gray-600)">${escapeHtml(i.id)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(TYPE_TEXT[i.type] || i.type)}<br><span style="font-size:12px;color:var(--gray-600)">${escapeHtml(price)}</span></td>
        <td>${statusBadge(i.status)}</td>
        <td style="white-space:nowrap;font-size:13px;color:var(--gray-600)">${escapeHtml(fmtDateTime(i.updated_at))}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm act-status" data-id="${escapeHtml(i.id)}">狀態</button>
            <button class="btn btn-ghost btn-sm act-edit" data-id="${escapeHtml(i.id)}">編輯</button>
            <button class="btn btn-danger btn-sm act-del" data-id="${escapeHtml(i.id)}">刪除</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function statusBadge(s) {
  const map = { available: 'status-available', reserved: 'status-reserved', taken: 'status-taken', sold: 'status-taken' };
  return `<span class="status-badge ${map[s] || 'status-taken'}">${escapeHtml(ITEM_STATUS_TEXT[s] || s)}</span>`;
}

async function refresh() {
  try { await load(); } catch (err) {
    if (err.name === 'AuthError') { location.href = '/admin/index.html?expired=1'; return; }
    toast(err.message, { error: true });
  }
}

/* ---------- create / edit ---------- */
function itemFormModal(item) {
  const isNew = !item;
  const i = item || { name: '', type: 'free', price: '', description: '', image_url: '' };
  openModal(`
    <h3>${isNew ? '＋ 新增物品' : '✏️ 編輯物品'}</h3>
    <form id="item-form">
      <div class="form-grid">
        <div class="field full">
          <label>物品名稱 *</label>
          <input type="text" id="f-name" maxlength="60" required value="${escapeHtml(i.name)}" placeholder="例如：九成新書枱燈">
        </div>
        <div class="field">
          <label>類別</label>
          <select id="f-type">
            <option value="free" ${i.type === 'free' ? 'selected' : ''}>免費提取</option>
            <option value="donation" ${i.type === 'donation' ? 'selected' : ''}>捐款（自由定價）</option>
            <option value="special" ${i.type === 'special' ? 'selected' : ''}>特賣</option>
          </select>
        </div>
        <div class="field" id="f-price-wrap" ${i.type === 'free' ? 'hidden' : ''}>
          <label>價格（HKD）*</label>
          <input type="number" id="f-price" min="0" step="0.5" value="${i.type === 'free' ? '' : escapeHtml(i.price ?? '')}" placeholder="如 50">
        </div>
        <div class="field full">
          <label>圖片</label>
          <div style="display:flex;gap:8px">
            <input type="text" id="f-image" value="${escapeHtml(i.image_url || '')}" placeholder="貼上圖片網址，或按右邊上傳">
            <button type="button" class="btn btn-ghost btn-sm" id="f-upload" style="flex:none">上傳照片</button>
          </div>
          <img id="f-preview" class="img-preview" alt="預覽" ${i.image_url ? `src="${escapeHtml(i.image_url)}"` : 'hidden'}>
        </div>
        <div class="field full">
          <label>描述</label>
          <textarea id="f-desc" rows="3" placeholder="尺寸、新舊程度、注意事項…（每行一項）">${escapeHtml(i.description || '')}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" id="f-cancel">取消</button>
        <button type="submit" class="btn btn-primary" id="f-save">${isNew ? '上架物品' : '儲存更改'}</button>
      </div>
    </form>`);

  const priceWrap = $('#f-price-wrap');
  $('#f-type').addEventListener('change', () => {
    const free = $('#f-type').value === 'free';
    priceWrap.hidden = free;
    if (free) $('#f-price').value = '';
  });
  $('#f-cancel').onclick = closeModal;

  const fileInput = $('#file-input');
  $('#f-upload').addEventListener('click', () => fileInput.click());
  const onFile = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const dataUrl = await downscale(f);
      $('#f-image').value = dataUrl;
      $('#f-preview').src = dataUrl;
      $('#f-preview').hidden = false;
      toast('照片已加入（會壓縮後儲存）');
    } catch {
      toast('無法讀取這張圖片。', { error: true });
    }
    fileInput.value = '';
  };
  fileInput.removeEventListener('change', onFile);
  fileInput.addEventListener('change', onFile);

  $('#f-image').addEventListener('input', () => {
    const v = $('#f-image').value.trim();
    if (v) { $('#f-preview').src = v; $('#f-preview').hidden = false; }
    else $('#f-preview').hidden = true;
  });

  $('#item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const type = $('#f-type').value;
    const price = type === 'free' ? null : Number($('#f-price').value);
    const body = {
      name,
      type,
      price,
      image_url: $('#f-image').value.trim() || '/images/seed/default.svg',
      description: $('#f-desc').value.trim()
    };
    if (!name) return toast('請填寫物品名稱。', { error: true });
    if (type !== 'free' && (!Number.isFinite(price) || price <= 0)) {
      return toast('捐款／特賣物品請填寫價格。', { error: true });
    }
    try {
      if (isNew) await adminApi('/admin/items', { method: 'POST', body });
      else await adminApi(`/admin/items/${item.id}`, { method: 'PATCH', body });
      closeModal();
      notifyChanged();
      toast(isNew ? '物品已上架。' : '已儲存。');
      await load();
    } catch (err) { toast(err.message, { error: true }); }
  });
}

/** Read + downscale an image file to a data URL (keeps db.json small). */
function downscale(file, max = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (err) { reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/* ---------- bulk import (CSV) ---------- */
/** Minimal CSV parser: handles quoted fields, commas and "" inside quotes. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip CR */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function downloadTextFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const TYPE_ALIAS = { '': 'free', '免費': 'free', 'free': 'free', '捐款': 'donation', 'donation': 'donation', '特賣': 'special', 'special': 'special' };

function normalizeRows(rows) {
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iName = idx('name'), iType = idx('type'), iPrice = idx('price'), iDesc = idx('description'), iImg = idx('image_url');
  if (iName === -1) throw new Error('CSV 缺少「name」欄位（第一行必須是欄位名稱）。');
  return rows.slice(1).map((cells) => {
    const type = TYPE_ALIAS[(cells[iType] || '').trim().toLowerCase()] || (cells[iType] || '').trim();
    const priceRaw = (cells[iPrice] || '').trim();
    return {
      name: (cells[iName] || '').trim(),
      type,
      price: priceRaw === '' ? null : Number(priceRaw),
      description: iDesc !== -1 ? (cells[iDesc] || '').trim() : '',
      image_url: iImg !== -1 ? (cells[iImg] || '').trim() : ''
    };
  });
}

async function bulkPreview() {
  const fileInput = $('#bulk-file');
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  let rows;
  try {
    rows = parseCSV(await f.text());
  } catch { return toast('無法讀取這個 CSV 檔。', { error: true }); }
  let parsed;
  try {
    parsed = normalizeRows(rows);
  } catch (err) { return toast(err.message, { error: true }); }
  if (!parsed.length) return toast('CSV 沒有資料行。', { error: true });

  const previewRows = parsed.slice(0, 30);
  const more = parsed.length - previewRows.length;
  openModal(`
    <h3>⬆ 批量上架（${parsed.length} 件）</h3>
    <p class="muted" style="margin-top:-6px">預覽首 ${previewRows.length} 行，確認後會全部上架為「可取」。</p>
    <div class="tbl-wrap" style="max-height:320px;overflow:auto">
      <table class="tbl">
        <thead><tr><th>名稱</th><th>類別</th><th>價格</th></tr></thead>
        <tbody>
          ${previewRows.map((r) => `
            <tr>
              <td style="min-width:140px">${escapeHtml(r.name) || '<span class="muted">（缺名稱）</span>'}</td>
              <td>${escapeHtml(TYPE_TEXT[r.type] || r.type || '—')}</td>
              <td>${r.type === 'free' ? '免費' : r.price == null ? '⚠ 缺' : `HK$${Number(r.price).toLocaleString()}`}</td>
            </tr>`).join('')}
          ${more ? `<tr><td colspan="3" class="muted" style="text-align:center">… 其餘 ${more} 行略</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="bulk-cancel" type="button">取消</button>
      <button class="btn btn-primary" id="bulk-confirm" type="button">確認上架 ${parsed.length} 件</button>
    </div>`);
  $('#bulk-cancel').onclick = closeModal;
  $('#bulk-confirm').onclick = async () => {
    $('#bulk-confirm').disabled = true;
    $('#bulk-confirm').textContent = '上架中…';
    try {
      const res = await adminApi('/admin/items/bulk', { method: 'POST', body: { items: parsed } });
      closeModal();
      notifyChanged();
      if (res.errors.length) {
        openModal(`
          <h3>批量上架結果</h3>
          <p>成功上架 <strong>${res.added}</strong> 件；<strong style="color:var(--red-600)">${res.errors.length}</strong> 行未能上架：</p>
          <div class="tbl-wrap" style="max-height:260px;overflow:auto">
            <table class="tbl">
              <thead><tr><th>行</th><th>物品</th><th>原因</th></tr></thead>
              <tbody>${res.errors.map((e) => `
                <tr><td>${e.line}</td><td>${escapeHtml(e.name)}</td><td class="muted">${escapeHtml(e.error)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="modal-foot"><button class="btn btn-primary" id="res-ok">完成</button></div>`);
        $('#res-ok').onclick = closeModal;
      } else {
        toast(`成功上架 ${res.added} 件物品。`);
      }
      await load();
    } catch (err) { toast(err.message, { error: true }); }
  };
  fileInput.value = '';
}

/* ---------- status change modal ---------- */
function statusModal(item) {
  const opts = [
    ['available', '可取', '開放給街坊預約'],
    ['reserved', '保留中', '（一般由預約自動產生）'],
    ['taken', '已取走', '免費物品已交到街坊手上'],
    ['sold', '已售出', '特賣／捐款物品已售出']
  ];
  openModal(`
    <h3>更改狀態：${escapeHtml(item.name)}</h3>
    <form id="status-form">
      <div class="radio-row" id="status-opts">
        ${opts.map(([v, label, hint], idx) => `
          <label class="radio-card ${item.status === v ? 'active' : ''}">
            <input type="radio" name="status" value="${v}" ${item.status === v ? 'checked' : ''}>
            <span>${label}<br><small style="color:var(--gray-600)">${hint}</small></span>
          </label>`).join('')}
      </div>
      <div class="field" style="margin-top:14px">
        <label>備註（可選，會記入活動紀錄）</label>
        <input type="text" id="st-notes" placeholder="例如：已核對取件人身份">
      </div>
      <div class="notice-box amber" style="margin-top:4px">
        更改為「可取」會釋放現有預約；更改為「已取走／已售出」會同時核銷進行中的預約。
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" id="st-cancel">取消</button>
        <button type="submit" class="btn btn-primary">儲存狀態</button>
      </div>
    </form>`);
  $('#st-cancel').onclick = closeModal;
  const cards = [...document.querySelectorAll('.radio-card')];
  cards.forEach((card) => card.addEventListener('click', () => {
    cards.forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    card.querySelector('input').checked = true;
  }));
  $('#status-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.querySelector('input[name=status]:checked')?.value;
    if (!status) return toast('請選擇狀態。', { error: true });
    try {
      await adminApi(`/admin/items/${item.id}/status`, { method: 'PATCH', body: { status, notes: $('#st-notes').value.trim() } });
      closeModal();
      notifyChanged();
      toast('狀態已更新，公眾網站會即時同步。');
      await load();
    } catch (err) { toast(err.message, { error: true }); }
  });
}

/* ---------- events ---------- */
function wire() {
  $('#btn-new').addEventListener('click', () => itemFormModal(null));
  $('#btn-bulk').addEventListener('click', () => $('#bulk-file').click());
  $('#bulk-file').addEventListener('change', bulkPreview);
  $('#btn-template').addEventListener('click', () => {
    downloadTextFile('easoug-items-template.csv',
      '\uFEFFname,type,price,description,image_url\r\n' +
      '原木書架,free,,實木三層書架，約 9 成新，需自備運輸,https://example.com/bookshelf.jpg\r\n' +
      '復古陶瓷花瓶,donation,80,手繪復古花紋，約 25cm 高,\r\n' +
      '白色書枱燈,special,60,LED 護眼燈，觸控調光，功能正常,\r\n',
      'text/csv;charset=utf-8');
  });
  $('#btn-export').addEventListener('click', async () => {
    try { await downloadExport('/admin/export/items.csv', `easoug-items-${new Date().toISOString().slice(0, 10)}.csv`); }
    catch (err) {
      if (err.name === 'AuthError') { location.href = '/admin/index.html?expired=1'; return; }
      toast(err.message, { error: true });
    }
  });
  $('#items-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const item = items.find((i) => i.id === btn.dataset.id);
    if (!item) return;
    if (btn.classList.contains('act-status')) statusModal(item);
    else if (btn.classList.contains('act-edit')) itemFormModal(item);
    else if (btn.classList.contains('act-del')) {
      const ok = await confirmDialog({
        title: '刪除物品？',
        message: `確定刪除「${item.name}」嗎？\n如有進行中的預約，需要先取消預約才能刪除。`,
        okText: '刪除', danger: true
      });
      if (!ok) return;
      try {
        await adminApi(`/admin/items/${item.id}`, { method: 'DELETE' });
        notifyChanged();
        toast('已刪除。');
        await load();
      } catch (err) { toast(err.message, { error: true }); }
    }
  });
  $('#chip-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    statusFilter = chip.dataset.status;
    renderChips();
    render();
  });
  let timer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchText = e.target.value; render(); }, 180);
  });
  $('#logout').addEventListener('click', logout);
}

await requireAuth();
wire();
startPolling(refresh, { intervalMs: 20000 });
