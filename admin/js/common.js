import {
  $, escapeHtml, toast, fmtDateTime, statusBadge, notifyChanged
} from '../../js/common.js';

export { $, escapeHtml, toast, fmtDateTime, statusBadge, notifyChanged };

export const TOKEN_KEY = 'easoug_admin_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

const AUTH_LOCK = 'easoug_admin_lock';
function lockOut() {
  try {
    const until = Date.now() + 1500;
    const cur = Number(sessionStorage.getItem(AUTH_LOCK) || 0);
    sessionStorage.setItem(AUTH_LOCK, String(Math.max(cur, until)));
  } catch { /* ignore */ }
}

export async function adminApi(path, { method = 'GET', body } = {}) {
  const token = getToken();
  if (!token) throw new AuthError();
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('無法連線伺服器。');
  }
  if (res.status === 401) {
    setToken(null);
    throw new AuthError();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `要求失敗（${res.status}）`);
  return data;
}

class AuthError extends Error {
  constructor() { super('auth'); this.name = 'AuthError'; }
}

/** Fetch an export (CSV/JSON) with the admin token and trigger a download. */
export async function downloadExport(path, filename) {
  const token = getToken();
  let res;
  try {
    res = await fetch('/api' + path, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('無法連線伺服器。');
  }
  if (res.status === 401) {
    setToken(null);
    throw new AuthError();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || `下載失敗（${res.status}）`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Gate every admin page (except login): verify the token, else redirect. */
export async function requireAuth() {
  try {
    await adminApi('/admin/auth');
  } catch (err) {
    if (err instanceof AuthError) {
      const params = new URLSearchParams(location.search);
      if (!params.get('expired')) location.href = '/admin/index.html?expired=1';
    } else {
      location.href = '/admin/index.html';
    }
  }
}

export async function logout() {
  try { await adminApi('/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
  setToken(null);
  location.href = '/admin/index.html';
}

export function openModal(html) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', escClose);
  return backdrop;
}

export function closeModal() {
  $$('.modal-backdrop').forEach((b) => b.remove());
  document.removeEventListener('keydown', escClose);
}

function escClose(e) { if (e.key === 'Escape') closeModal(); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function confirmDialog({ title, message, okText = '確定', danger = false }) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${escapeHtml(title)}</h3>
      <p style="white-space:pre-line;margin:0">${escapeHtml(message)}</p>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="dlg-no" type="button">返回</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="dlg-yes" type="button">${escapeHtml(okText)}</button>
      </div>`);
    $('#dlg-no').onclick = () => { closeModal(); resolve(false); };
    $('#dlg-yes').onclick = () => { closeModal(); resolve(true); };
  });
}

export { fmtPhone } from '../../js/common.js';

export const TYPE_TEXT = { free: '免費', donation: '捐款', special: '特賣' };
export const ITEM_STATUS_TEXT = { available: '可取', reserved: '保留中', taken: '已取走', sold: '已售出' };
export const RSV_STATUS_TEXT = {
  pending: '待取件', confirmed: '已確認', completed: '已完成', cancelled: '已取消', expired: '已逾時'
};

export function rsvBadge(status) {
  const map = { pending: 'status-reserved', confirmed: 'status-available', completed: 'status-taken', cancelled: 'status-taken', expired: 'status-expired' };
  return `<span class="status-badge ${map[status] || 'status-taken'}">${escapeHtml(RSV_STATUS_TEXT[status] || status)}</span>`;
}
