import { getReservation, getPublicSettings } from './api.js';
import { $, escapeHtml, statusBadge, fmtPhone, fmtDateTime, readQuery, spinner, registerSW, socialLinksHtml } from './common.js';

registerSW();

async function load() {
  const id = readQuery().get('id');
  const cached = getCached();
  const settings = await getPublicSettings().catch(() => ({}));

  $('#foot-social').innerHTML = socialLinksHtml(settings);

  const area = $('#receipt');
  if (!id) {
    area.innerHTML = `
      <div class="sheet">
        <h3>查看預約</h3>
        <p class="muted">請從<a href="/my-reservations.html">「我的預約」</a>輸入電話查詢，或直接返回<a href="/">首頁</a>瀏覽其他好物。</p>
      </div>`;
    return;
  }

  area.innerHTML = spinner();
  let phone = cached && cached.id === id ? cached.phone : '';
  if (!phone) {
    const cachedPhone = readQuery().get('phone');
    if (cachedPhone) phone = cachedPhone;
  }

  // 先顯示剛預約的暫存資料，再向伺服器核對最新狀態
  let rsv = cached && cached.id === id ? cached : null;
  if (rsv) render(rsv, settings);

  if (phone) {
    try {
      const fresh = await getReservation(id, phone);
      render(fresh, settings);
    } catch (err) {
      if (!rsv) {
        area.innerHTML = `<div class="empty"><div class="big">🔎</div>${escapeHtml(err.message)}</div>`;
      }
    }
  } else if (!rsv) {
    area.innerHTML = `
      <div class="empty"><div class="big">🧾</div>
      找不到這項預約的暫存資料。<br>請到<a href="/my-reservations.html">我的預約</a>用電話號碼查詢。</div>`;
  }
}

function getCached() {
  try {
    return JSON.parse(localStorage.getItem('easoug_last_reservation') || 'null');
  } catch { return null; }
}

function render(rsv, settings) {
  const area = $('#receipt');
  const shopName = settings.shop_name || '易搜數碼 Easoug';
  const pickup = new Date(rsv.pickup_time);
  const okToPickup = pickup.getTime() < Date.now() + 24 * 3600_000;

  area.innerHTML = `
    <div class="empty" style="padding:18px 0 4px">
      <div class="big">🎉</div>
    </div>
    <div class="sheet">
      <div class="badges" style="justify-content:center">${statusBadge(rsv.status)}</div>
      <h2 style="text-align:center;margin:10px 0 2px">預約已成功登記！</h2>
      <p class="muted" style="text-align:center;margin:0 0 8px">請於取件時向店員出示預約編號，並核對姓名及電話。</p>
      <dl class="receipt">
        <div class="row"><dt>預約編號</dt><dd class="big-id">${escapeHtml(rsv.id)}</dd></div>
        <div class="row"><dt>物品</dt><dd>${escapeHtml(rsv.item_name || '')}</dd></div>
        <div class="row"><dt>姓名</dt><dd>${escapeHtml(rsv.customer_name || '')}</dd></div>
        <div class="row"><dt>電話</dt><dd>${escapeHtml(fmtPhone(rsv.phone))}</dd></div>
        <div class="row"><dt>取件時間</dt><dd>${escapeHtml(fmtDateTime(rsv.pickup_time))}</dd></div>
        <div class="row"><dt>預約時間</dt><dd>${escapeHtml(fmtDateTime(rsv.created_at))}</dd></div>
      </dl>
      <div class="notice-box ${rsv.status === 'cancelled' ? 'amber' : ''}">
        ${rsv.status === 'pending' || rsv.status === 'confirmed'
          ? `<strong>${escapeHtml(shopName)}</strong> 會為你保留此物品。<br>
             請於 ${escapeHtml(fmtDateTime(new Date(new Date(rsv.created_at).getTime() + 24 * 3600_000)))} 前到店取件，逾期自動釋放。
             ${okToPickup ? '' : ' 若無法準時到達，請先到「我的預約」取消，方便其他街坊。'}`
          : rsv.status === 'completed'
            ? '此預約已完成取件，感謝你讓好物繼續流動！♻️'
            : rsv.status === 'cancelled'
              ? '此預約已取消。'
              : '此預約已逾時釋放，物品或已開放給其他街坊。'}
      </div>
      <div class="stack-actions">
        <a class="btn btn-primary" href="/my-reservations.html">查看我的預約</a>
        <a class="btn btn-ghost" href="/">繼續瀏覽好物</a>
      </div>
    </div>`;
}

load();
