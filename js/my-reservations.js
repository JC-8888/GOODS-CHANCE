import { getMyReservations, cancelReservation, getPublicSettings } from './api.js';
import {
  $, escapeHtml, statusBadge, fmtPhone, fmtDateTime, toast, notifyChanged, spinner, registerSW, socialLinksHtml
} from './common.js';

registerSW();

const PHONE_KEY = 'easoug_phone';
let myPhone = '';

function storePhone() {
  try { localStorage.setItem(PHONE_KEY, $('#phone').value.trim()); } catch { /* ignore */ }
}

async function loadSettings() {
  const s = await getPublicSettings().catch(() => ({}));
  const el = $('#quota-note');
  if (s.max_reservations_per_phone_per_month) {
    el.textContent = `每個電話號碼每月最多可預約 ${s.max_reservations_per_phone_per_month} 件物品。`;
  }
  $('#foot-social').innerHTML = socialLinksHtml(s);
}

async function search(e) {
  e?.preventDefault();
  const phone = $('#phone').value.trim().replace(/\s+/g, '');
  if (!/^(\+?852)?[2-9]\d{7}$/.test(phone)) {
    return toast('請輸入有效的 8 位香港電話號碼。', { error: true });
  }
  storePhone();
  myPhone = phone;
  history.replaceState(null, '', '?phone=' + encodeURIComponent(phone));
  await loadList();
}

async function loadList() {
  const listEl = $('#list');
  listEl.innerHTML = spinner('查詢中…');
  try {
    const list = await getMyReservations(myPhone);
    render(list);
  } catch (err) {
    listEl.innerHTML = `<div class="empty"><div class="big">📡</div>${escapeHtml(err.message)}</div>`;
  }
}

function render(list) {
  const listEl = $('#list');
  if (!list.length) {
    listEl.innerHTML = `
      <div class="empty">
        <div class="big">🗓️</div>
        這個電話暫時未有預約紀錄。<br>
        <a href="/">去首頁看看有什麼好物</a>
      </div>`;
    return;
  }
  listEl.innerHTML = list.map((r) => {
    const canCancel = r.status === 'pending' || r.status === 'confirmed';
    const img = r.item_image ? `<img class="mini-img" src="${escapeHtml(r.item_image)}" alt="">` : '<div class="mini-img"></div>';
    const typeText = r.item_type === 'free' ? '免費' : r.item_type === 'donation' ? '捐款' : '特賣';
    return `
      <div class="rsv-item">
        ${img}
        <div class="info">
          <h3>${escapeHtml(r.item_name || '物品已下架')}</h3>
          <div class="sub">${escapeHtml(typeText)} · 編號 ${escapeHtml(r.id)}</div>
          <div class="sub">取件：${escapeHtml(fmtDateTime(r.pickup_time))}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${statusBadge(r.status)}
          ${canCancel
            ? `<button class="btn btn-danger btn-sm" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.item_name || '')}">取消預約</button>`
            : ''}
        </div>
      </div>`;
  }).join('');
}

function wireCancel() {
  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    if (!confirm(`確定取消「${name}」的預約嗎？\n取消後物品會即時開放給其他街坊。`)) return;
    btn.disabled = true;
    try {
      await cancelReservation(id, myPhone);
      notifyChanged();
      toast('預約已取消。');
      await loadList();
    } catch (err) {
      toast(err.message, { error: true });
      btn.disabled = false;
    }
  });
}

function init() {
  loadSettings();
  wireCancel();
  $('#form').addEventListener('submit', search);

  const fromUrl = new URLSearchParams(location.search).get('phone');
  const saved = fromUrl || (() => { try { return localStorage.getItem(PHONE_KEY); } catch { return ''; } })();
  if (saved && /^(\+?852)?[2-9]\d{7}$/.test(saved.replace(/\s+/g, ''))) {
    $('#phone').value = saved;
    myPhone = saved.replace(/\s+/g, '');
    loadList();
  }
}

init();
