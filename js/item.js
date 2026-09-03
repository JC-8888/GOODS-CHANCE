import { getItem, createReservation, getPublicSettings } from './api.js';
import {
  $, escapeHtml, statusBadge, typeTag, readQuery, toast, notifyChanged, registerSW, socialLinksHtml
} from './common.js';

registerSW();

const FORM_STATE_KEY = 'easoug_form_state';

function reserveSlot(iso) {
  const d = new Date(iso);
  const opts = { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  return new Intl.DateTimeFormat('zh-Hant-HK', opts).format(d);
}

function restoreFormState() {
  try {
    const s = JSON.parse(localStorage.getItem(FORM_STATE_KEY) || 'null');
    if (!s) return;
    if (s.itemId === currentId) {
      if (s.name) $('#customer_name').value = s.name;
      if (s.phone) $('#phone').value = s.phone;
    }
  } catch { /* ignore */ }
}
function saveFormState() {
  try {
    localStorage.setItem(FORM_STATE_KEY, JSON.stringify({
      itemId: currentId,
      name: $('#customer_name').value.trim(),
      phone: $('#phone').value.trim()
    }));
  } catch { /* ignore */ }
}

let currentId = '';

async function load() {
  const q = readQuery();
  currentId = q.get('id') || '';
  if (!currentId) {
    $('#detail').innerHTML = '<div class="empty"><div class="big">🧭</div>缺少物品編號，請從首頁選擇物品。</div>';
    return;
  }

  let item;
  let settings = {};
  try {
    [item, settings] = await Promise.all([getItem(currentId), getPublicSettings()]);
  } catch (err) {
    $('#detail').innerHTML = `<div class="empty"><div class="big">🔍</div>${escapeHtml(err.message)}<br><a href="/">返回首頁</a></div>`;
    return;
  }
  $('#foot-social').innerHTML = socialLinksHtml(settings);

  const img = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}">`
    : '';
  const metaBits = [
    item.type === 'free' ? '免費提取' : null,
    item.type === 'donation' ? `捐款物品 · HK$${item.price}` : null,
    item.type === 'special' ? `特賣 · HK$${item.price}` : null,
    `更新於 ${reserveSlot(item.updated_at)}`
  ].filter(Boolean).join(' · ');

  document.title = `${item.name} — 易搜數碼 Easoug`;
  $('#detail').innerHTML = `
    <div class="detail-hero">${img}</div>
    <div class="wrap">
      <div class="detail-head">
        <div class="badges">${statusBadge(item.status)} ${typeTag(item)}</div>
        <h2>${escapeHtml(item.name)}</h2>
        <div class="detail-meta">${escapeHtml(metaBits)}</div>
      </div>
      <div class="detail-desc">${escapeHtml(item.description || '（暫無描述）')}</div>
      ${renderAction(item, settings)}
      <p style="text-align:center"><a href="/">← 返回物品列表</a></p>
    </div>`;

  if (item.status === 'available') {
    restoreFormState();
    $('#customer_name').addEventListener('input', saveFormState);
    $('#phone').addEventListener('input', saveFormState);
    const min = new Date(Date.now() + 60 * 60_000);
    const picker = $('#pickup_time');
    picker.min = toLocalInput(min);
    const def = new Date(min.getTime() + 20 * 3600_000);
    def.setMinutes(0, 0, 0);
    picker.value = picker.value || toLocalInput(def);
    $('#reserve-form').addEventListener('submit', onSubmit);
  }
}

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderAction(item, settings) {
  const quota = settings.max_reservations_per_phone_per_month;
  if (item.status === 'available') {
    const notice = settings.notice || '';
    const quotaLine = quota ? `每個電話號碼每月最多可預約 ${quota} 件物品。` : '';
    return `
      <form id="reserve-form" class="sheet" novalidate>
        <h3>📅 預約提取</h3>
        <p class="muted" style="margin-top:-6px">填寫資料後，物品會即時標記為「保留中」。</p>
        <div class="notice-box">${escapeHtml(notice)}${quotaLine ? `<br>${escapeHtml(quotaLine)}` : ''}</div>
        <div class="field">
          <label for="customer_name">姓名</label>
          <input type="text" id="customer_name" name="customer_name" maxlength="40" autocomplete="name" required placeholder="取件時會核對姓名">
        </div>
        <div class="field">
          <label for="phone">電話 <span class="hint">只用作取件核對，不會對外公開</span></label>
          <input type="tel" id="phone" name="phone" maxlength="13" inputmode="tel" autocomplete="tel" required placeholder="8 位香港電話，如 5123 4567">
        </div>
        <div class="field">
          <label for="pickup_time">取件時間</label>
          <input type="datetime-local" id="pickup_time" name="pickup_time" required>
          <p class="muted" style="margin:6px 0 0">請於預約後 <strong>24 小時內</strong>到店取件，逾期會自動釋放給其他人。</p>
        </div>
        <button class="btn btn-primary" type="submit" id="submit-btn">確認預約</button>
      </form>`;
  }
  if (item.status === 'reserved') {
    return `<div class="notice-box amber">🕐 這件物品正被保留中。如果預約者逾時未取，物品會自動重新開放。<br>你也可以在 <a href="/my-reservations.html">我的預約</a> 查看自己的預約。</div>`;
  }
  return `<div class="notice-box amber">這件物品已離開易搜，去<a href="/">首頁</a>看看其他好物吧。</div>`;
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = $('#submit-btn');
  const name = $('#customer_name').value.trim();
  const phone = $('#phone').value.trim().replace(/\s+/g, '');
  const pickup = $('#pickup_time').value;

  if (!name) return toast('請填寫姓名。', { error: true });
  if (!/^(\+?852)?[2-9]\d{7}$/.test(phone)) {
    return toast('請輸入有效的 8 位香港電話號碼。', { error: true });
  }
  if (!pickup) return toast('請選擇取件時間。', { error: true });

  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const { reservation, quota_left } = await createReservation({
      item_id: currentId, customer_name: name, phone, pickup_time: new Date(pickup).toISOString()
    });
    try {
      localStorage.setItem('easoug_last_reservation', JSON.stringify({ ...reservation, phone }));
      localStorage.removeItem(FORM_STATE_KEY);
    } catch { /* ignore */ }
    notifyChanged();
    location.href = `/reserve.html?id=${encodeURIComponent(reservation.id)}&fresh=1`;
  } catch (err) {
    toast(err.message, { error: true });
    btn.disabled = false;
    btn.textContent = '確認預約';
    if (err.message.includes('已預約') || err.message.includes('上限')) {
      // 友善提示重新載入狀態
      setTimeout(() => location.reload(), 2200);
    }
  }
}

load();
