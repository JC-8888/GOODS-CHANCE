import { getItems, getPublicSettings } from './api.js';
import { $, $$, escapeHtml, itemCard, startPolling, registerSW, socialLinksHtml } from './common.js';

registerSW();

let all = [];
let statusFilter = '';
let searchText = '';

async function loadSettings() {
  try {
    const s = await getPublicSettings();
    const name = $('#shop-name');
    const tag = $('#shop-tagline');
    if (s.shop_name) name.textContent = s.shop_name;
    if (s.tagline) tag.textContent = s.tagline;
    document.title = `${s.shop_name || '易搜數碼'} — 免費好物 · 繼續流動`;
    const notice = $('#notice');
    notice.hidden = !s.notice;
    notice.textContent = s.notice || '';
    const foot = $('#foot-info');
    const parts = [s.address, s.hours, s.contact_phone ? `☎ ${s.contact_phone}` : ''].filter(Boolean);
    foot.textContent = parts.join(' · ');
    $('#foot-social').innerHTML = socialLinksHtml(s);
  } catch { /* 後台缺資料時沿用 HTML 預設 */ }
}

function counts() {
  return {
    all: all.length,
    available: all.filter((i) => i.status === 'available').length,
    reserved: all.filter((i) => i.status === 'reserved').length
  };
}

function render() {
  const n = counts();
  $('#n-all').textContent = n.all;
  $('#n-available').textContent = n.available;
  $('#n-reserved').textContent = n.reserved;

  let list = all;
  if (statusFilter) list = list.filter((i) => i.status === statusFilter);
  const q = searchText.trim().toLowerCase();
  if (q) {
    list = list.filter((i) =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q));
  }
  const grid = $('#grid');
  const empty = $('#empty');
  if (!list.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = list.map(itemCard).join('');
}

async function refresh() {
  const prev = all.length;
  try {
    all = await getItems();
  } catch (err) {
    if (prev === 0) {
      $('#grid').innerHTML = `<div class="empty"><div class="big">📡</div>${escapeHtml(err.message)}</div>`;
    }
    return;
  }
  render();
}

function wire() {
  $$('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      statusFilter = chip.dataset.status;
      render();
    });
  });
  let timer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchText = e.target.value; render(); }, 180);
  });
}

wire();
startPolling(refresh);
loadSettings();
