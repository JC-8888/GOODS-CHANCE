/* 共用小工具：DOM、格式化、toast、即時同步 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export const STATUS_TEXT = {
  available: '可取', reserved: '保留中', taken: '已取走', sold: '已售出',
  pending: '待取件', confirmed: '已確認', completed: '已完成',
  cancelled: '已取消', expired: '已逾時'
};

export function statusBadge(status) {
  const cls = status in { available: 1, reserved: 1, taken: 1, sold: 1 }
    ? `status-${status}` : 'status-taken';
  return `<span class="status-badge ${cls}">${escapeHtml(STATUS_TEXT[status] || status)}</span>`;
}

export function typeTag(item) {
  const map = { free: '免費', donation: '捐款', special: '特賣' };
  const t = map[item.type] || item.type;
  if (item.type === 'free') return `<span class="type-tag">${t}</span>`;
  const price = item.price != null ? ` · HK$${Number(item.price).toLocaleString()}` : '';
  return `<span class="type-tag type-${item.type}">${t}${price}</span>`;
}

export function itemCard(item) {
  const img = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : '';
  return `
    <a class="card" href="/item.html?id=${encodeURIComponent(item.id)}">
      <div class="thumb">${img}</div>
      <div class="body">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="badges">${statusBadge(item.status)} ${typeTag(item)}</div>
      </div>
    </a>`;
}

export function fmtDateTime(iso, { withTime = true } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = withTime
    ? { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-Hant-HK', opts).format(d);
}

export function fmtPhone(p) {
  return p ? `${p.slice(0, 4)} ${p.slice(4)}` : '';
}

let toastTimer = null;
export function toast(msg, { error = false, ms = 2600 } = {}) {
  let el = $('#fb-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fb-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', error);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function readQuery() {
  return new URLSearchParams(location.search);
}

/* 同瀏覽器跨分頁即時同步：後台改動時通知前台頁面刷新 */
const bus = ('BroadcastChannel' in window) ? new BroadcastChannel('easoug-sync') : null;
export function notifyChanged() { bus?.postMessage('changed'); }
export function onExternalChange(cb) {
  bus?.addEventListener('message', () => cb());
}

/** 定期 + 重新可見時輪詢，保持狀態最新（後台／其他裝置改動）。 */
export function startPolling(fn, { intervalMs = 15000 } = {}) {
  fn();
  const t = setInterval(fn, intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fn();
  });
  onExternalChange(fn);
  return t;
}

export function spinner(text = '載入中…') {
  return `<div class="spinner">${escapeHtml(text)}</div>`;
}

/** Social links (Instagram / Facebook), from shop settings. */
export function socialLinksHtml(settings = {}, { labels = true, cls = 'social-row' } = {}) {
  const items = [];
  if (settings.instagram_url) {
    items.push(`<a class="social-link" href="${escapeHtml(settings.instagram_url)}" target="_blank" rel="noopener noreferrer" aria-label="Instagram">📷${labels ? ' Instagram' : ''}</a>`);
  }
  if (settings.facebook_url) {
    items.push(`<a class="social-link" href="${escapeHtml(settings.facebook_url)}" target="_blank" rel="noopener noreferrer" aria-label="Facebook">👍${labels ? ' Facebook' : ''}</a>`);
  }
  if (!items.length) return '';
  return `<div class="${cls}">${items.join('')}</div>`;
}

export function registerSW() {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });
  }
}
