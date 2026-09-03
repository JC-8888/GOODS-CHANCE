import {
  $, adminApi, requireAuth, toast, logout, escapeHtml, fmtDateTime, notifyChanged, downloadExport
} from './common.js';

const ACTION_TEXT = {
  reserve: '預約', release: '釋放／重新開放', take: '取走', sell: '售出',
  create: '上架', update: '更新／刪除'
};

async function load() {
  const [summary, actions, settings] = await Promise.all([
    adminApi('/reports/summary'),
    adminApi('/admin/actions'),
    adminApi('/admin/settings')
  ]);
  renderStats(summary);
  renderChart(summary.trend);
  renderActions(actions);
  fillSettings(settings);
  document.title = `數據報表 — ${settings.shop_name || '易搜數碼'} 後台`;
}

function renderStats(s) {
  const it = s.items, rv = s.reservations;
  const monthLabel = s.trend.length ? s.trend[s.trend.length - 1].month : '';
  $('#stat-cards').innerHTML = `
    <div class="stat dark"><div class="v">${it.available}</div><div class="k">可取（可預約）</div></div>
    <div class="stat blue"><div class="v">${it.reserved}</div><div class="k">保留中</div></div>
    <div class="stat plain"><div class="v">${it.total}</div><div class="k">物品總數</div></div>
    <div class="stat"><div class="v">${s.circulation.this_month}</div><div class="k">本月流通（${monthLabel}）</div></div>
    <div class="stat"><div class="v">${s.circulation.total}</div><div class="k">累計流通件數</div></div>
    <div class="stat plain"><div class="v">${s.pickup_rate}%</div><div class="k">提取率（完成／終結預約）</div></div>
    <div class="stat amber"><div class="v">HK$${Number(s.fund_raised).toLocaleString()}</div><div class="k">籌款總額（捐款／特賣）</div></div>
    <div class="stat"><div class="v">${rv.pending + rv.confirmed}</div><div class="k">進行中預約</div></div>`;
}

function renderChart(trend) {
  const max = Math.max(1, ...trend.map((m) => Math.max(m.taken, m.completed)));
  $('#chart').innerHTML = `
    <div class="bar-chart">
      ${trend.map((m) => `
        <div class="bar-col">
          <div class="bars">
            <div class="bar" style="height:${Math.round((m.taken / max) * 100)}%" title="流通 ${m.taken}"></div>
            <div class="bar alt" style="height:${Math.round((m.completed / max) * 100)}%" title="完成取件 ${m.completed}"></div>
          </div>
          <div class="lbl">${escapeHtml(m.month)}</div>
        </div>`).join('')}
    </div>`;
}

function renderActions(actions) {
  const body = $('#act-body');
  if (!actions.length) {
    body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--gray-600)">未有活動紀錄。</td></tr>';
    return;
  }
  body.innerHTML = actions.map((a) => `
    <tr>
      <td style="white-space:nowrap;font-size:13px;color:var(--gray-600)">${escapeHtml(fmtDateTime(a.created_at))}</td>
      <td><span class="chip" style="cursor:default">${escapeHtml(ACTION_TEXT[a.action] || a.action)}</span></td>
      <td>${escapeHtml(a.notes || '')}</td>
    </tr>`).join('');
}

function fillSettings(s) {
  const map = {
    's-shop_name': s.shop_name, 's-tagline': s.tagline, 's-contact_phone': s.contact_phone,
    's-address': s.address, 's-hours': s.hours, 's-payment_url': s.payment_url,
    's-instagram_url': s.instagram_url, 's-facebook_url': s.facebook_url,
    's-notice': s.notice, 's-quota': s.max_reservations_per_phone_per_month
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  }
}

function wire() {
  $('#logout').addEventListener('click', logout);
  const exports = [
    ['#exp-items', '/admin/export/items.csv', 'easoug-items'],
    ['#exp-reservations', '/admin/export/reservations.csv', 'easoug-reservations'],
    ['#exp-backup', '/admin/export/backup.json', 'easoug-backup']
  ];
  for (const [sel, path, prefix] of exports) {
    $(sel).addEventListener('click', async () => {
      try {
        await downloadExport(path, `${prefix}-${new Date().toISOString().slice(0, 10)}.${path.endsWith('.csv') ? 'csv' : 'json'}`);
        toast('已開始下載。');
      } catch (err) {
        if (err.name === 'AuthError') { location.href = '/admin/index.html?expired=1'; return; }
        toast(err.message, { error: true });
      }
    });
  }
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await adminApi('/admin/settings', {
        method: 'PATCH',
        body: {
          shop_name: $('#s-shop_name').value,
          tagline: $('#s-tagline').value,
          contact_phone: $('#s-contact_phone').value,
          address: $('#s-address').value,
          hours: $('#s-hours').value,
          payment_url: $('#s-payment_url').value,
          instagram_url: $('#s-instagram_url').value,
          facebook_url: $('#s-facebook_url').value,
          notice: $('#s-notice').value,
          max_reservations_per_phone_per_month: Number($('#s-quota').value)
        }
      });
      notifyChanged();
      toast('設定已儲存，公眾網站即時更新。');
    } catch (err) { toast(err.message, { error: true }); }
  });
}

await requireAuth();
wire();
load().catch((err) => toast(err.message, { error: true }));
