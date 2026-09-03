import {
  $, adminApi, requireAuth, confirmDialog, toast, rsvBadge, logout,
  fmtDateTime, fmtPhone, escapeHtml, notifyChanged, downloadExport
} from './common.js';
import { startPolling } from '../../js/common.js';

let all = [];
let filter = '';
let searchText = '';

async function load() {
  all = await adminApi('/admin/reservations');
  renderChips();
  render();
}

function counts() {
  const c = { total: all.length };
  for (const r of all) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

function renderChips() {
  const c = counts();
  const order = [['', `全部 ${c.total}`], ['pending', `待取件 ${c.pending || 0}`], ['completed', `已完成 ${c.completed || 0}`], ['cancelled', `已取消 ${c.cancelled || 0}`], ['expired', `已逾時 ${c.expired || 0}`]];
  $('#chip-row').innerHTML = order.map(([v, label]) =>
    `<button class="chip ${v === filter ? 'active' : ''}" data-status="${v}">${escapeHtml(label)}</button>`).join('');
}

function render() {
  let list = all;
  if (filter) list = list.filter((r) => r.status === filter);
  const q = searchText.trim().toLowerCase();
  if (q) {
    list = list.filter((r) =>
      [r.customer_name, r.phone, r.item_name, r.id].some((f) => String(f || '').toLowerCase().includes(q)));
  }
  const body = $('#rsv-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gray-600)">沒有符合條件的預約。</td></tr>`;
    return;
  }
  body.innerHTML = list.map((r) => {
    const active = r.status === 'pending' || r.status === 'confirmed';
    return `
      <tr>
        <td style="white-space:nowrap;font-size:13px">
          ${escapeHtml(fmtDateTime(r.created_at))}
          <div style="color:var(--gray-600);font-size:12px">${escapeHtml(r.id)}</div>
        </td>
        <td style="min-width:140px"><span style="font-weight:600">${escapeHtml(r.item_name || '物品已下架')}</span></td>
        <td style="white-space:nowrap">
          ${escapeHtml(r.customer_name)}<br>
          <a href="tel:${escapeHtml(r.phone)}" style="font-size:13px;color:var(--gray-600)">${escapeHtml(fmtPhone(r.phone))}</a>
        </td>
        <td style="white-space:nowrap;font-size:13px">${escapeHtml(fmtDateTime(r.pickup_time))}</td>
        <td>${rsvBadge(r.status)}</td>
        <td>
          <div class="row-actions">
            ${active ? `
              <button class="btn btn-primary btn-sm act-complete" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.item_name || '')}">✓ 完成取件</button>
              <button class="btn btn-danger btn-sm act-cancel" data-id="${escapeHtml(r.id)}">取消</button>` : '—'}
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function refresh() {
  try { await load(); } catch (err) {
    if (err.name === 'AuthError') { location.href = '/admin/index.html?expired=1'; return; }
    toast(err.message, { error: true });
  }
}

function wire() {
  $('#logout').addEventListener('click', logout);
  $('#btn-export').addEventListener('click', async () => {
    try {
      await downloadExport('/admin/export/reservations.csv', `easoug-reservations-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      if (err.name === 'AuthError') { location.href = '/admin/index.html?expired=1'; return; }
      toast(err.message, { error: true });
    }
  });
  $('#chip-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.status;
    renderChips();
    render();
  });
  let timer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchText = e.target.value; render(); }, 180);
  });
  $('#rsv-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    const rsv = all.find((r) => r.id === id);
    if (!rsv) return;
    if (btn.classList.contains('act-complete')) {
      const ok = await confirmDialog({
        title: '核銷取件',
        message: `確認「${rsv.customer_name}」已取走「${rsv.item_name || ''}」？\n物品會即時標記為已取走。`,
        okText: '確認取件'
      });
      if (!ok) return;
      try {
        await adminApi(`/admin/reservations/${id}`, { method: 'PATCH', body: { status: 'completed' } });
        notifyChanged();
        toast('已完成取件 ♻️');
        await load();
      } catch (err) { toast(err.message, { error: true }); }
    } else if (btn.classList.contains('act-cancel')) {
      const ok = await confirmDialog({
        title: '取消預約？',
        message: `確定取消「${rsv.customer_name}」對「${rsv.item_name || ''}」的預約？\n物品會即時重新開放給其他街坊。`,
        okText: '取消預約', danger: true
      });
      if (!ok) return;
      try {
        await adminApi(`/admin/reservations/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
        notifyChanged();
        toast('預約已取消。');
        await load();
      } catch (err) { toast(err.message, { error: true }); }
    }
  });
}

await requireAuth();
wire();
startPolling(refresh, { intervalMs: 20000 });
