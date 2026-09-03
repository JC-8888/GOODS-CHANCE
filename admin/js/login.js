import { $, toast, setToken, getToken } from './common.js';

// Already logged in? Skip straight to the dashboard.
if (getToken()) {
  try {
    const res = await fetch('/api/admin/auth', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.ok) { location.replace('/admin/items.html'); }
    else setToken(null);
  } catch { /* offline → stay on login */ }
}

const expired = new URLSearchParams(location.search).get('expired');
if (expired) {
  $('#expired-note').hidden = false;
}

const form = $('#login-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const pw = $('#password').value;
  if (!pw) return toast('請輸入密碼。', { error: true });
  btn.disabled = true;
  btn.textContent = '登入中…';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '登入失敗');
    setToken(data.token);
    location.href = '/admin/items.html';
  } catch (err) {
    toast(err.message, { error: true, ms: 4000 });
    btn.disabled = false;
    btn.textContent = '登入';
  }
});
