import {
  HttpError, uid, nowIso, normalizePhone, monthKey
} from './util.js';
import { ITEM_STATUSES, ITEM_TYPES } from './store.js';

/** Handlers receive params = { store, auth, method, parts, query, body, ip, token }. */

function adminOnly(params) {
  if (!params.token || !params.auth.verify(params.token)) {
    throw new HttpError(401, '未登入或登入已過期，請重新登入。');
  }
}

function phoneFromQuery(params) {
  const p = normalizePhone(params.query.get('phone'));
  if (!p) throw new HttpError(400, '請提供有效的香港電話號碼。');
  return p;
}

/* ---------------------------------- helpers --------------------------------- */

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    image_url: item.image_url,
    status: item.status,
    type: item.type,
    price: item.price,
    created_at: item.created_at,
    updated_at: item.updated_at
  };
}

function publicReservation(rsv, item) {
  return {
    id: rsv.id,
    item_id: rsv.item_id,
    item_name: item?.name ?? '（物品已下架）',
    item_image: item?.image_url ?? '',
    item_type: item?.type ?? null,
    customer_name: rsv.customer_name,
    phone: rsv.phone,
    status: rsv.status,
    pickup_time: rsv.pickup_time,
    created_at: rsv.created_at,
    updated_at: rsv.updated_at
  };
}

/** Escape one CSV cell: always quoted, internal quotes doubled. */
function csvCell(v) {
  const s = String(v ?? '');
  return `"${s.replaceAll('"', '""')}"`;
}

function logAction(params, { item_id, action, notes, admin_id = 'system' }) {
  const { store } = params;
  store.data.actions.unshift({
    id: uid('act'), item_id, admin_id, action, notes, created_at: nowIso()
  });
  store.data.actions = store.data.actions.slice(0, 500); // keep the log bounded
}

/** Expire pending/confirmed reservations older than the policy window and free their items. */
export function runExpirySweep(params) {
  const { store } = params;
  const expiryH = Number(store.data.settings.expiry_hours) || 24;
  const limit = Date.now() - expiryH * 3600_000;
  let changed = false;
  for (const rsv of store.data.reservations) {
    if ((rsv.status === 'pending' || rsv.status === 'confirmed') && new Date(rsv.created_at).getTime() < limit) {
      const item = store.data.items.find((i) => i.id === rsv.item_id);
      if (item && item.reservation_id === rsv.id) {
        item.status = 'available';
        item.reservation_id = null;
        item.updated_at = nowIso();
      }
      rsv.status = 'expired';
      rsv.updated_at = nowIso();
      logAction(params, { item_id: rsv.item_id, action: 'release', notes: '預約超過 24 小時未取件，自動釋放' });
      changed = true;
    }
  }
  if (changed) store.save();
  return changed;
}

function monthStats(params) {
  // last 6 local months for the reports trend chart
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, taken: 0, completed: 0, fund: 0 });
  }
  const index = new Map(out.map((m) => [m.month, m]));
  for (const it of params.store.data.items) {
    if ((it.status === 'taken' || it.status === 'sold') && it.updated_at) {
      const mk = monthKey(it.updated_at);
      if (index.has(mk)) {
        index.get(mk).taken += 1;
        if (it.type !== 'free' && typeof it.price === 'number') index.get(mk).fund += it.price;
      }
    }
  }
  for (const rsv of params.store.data.reservations) {
    if (rsv.status === 'completed' && rsv.updated_at) {
      const mk = monthKey(rsv.updated_at);
      if (index.has(mk)) index.get(mk).completed += 1;
    }
  }
  return out;
}

/* ---------------------------------- routes ---------------------------------- */

const handlers = {
  /* -------- settings (public subset) -------- */
  GET_settings(params) {
    const s = params.store.data.settings;
    return { status: 200, data: {
      shop_name: s.shop_name, tagline: s.tagline, contact_phone: s.contact_phone,
      address: s.address, hours: s.hours, notice: s.notice,
      payment_url: s.payment_url, payment_note: s.payment_note,
      instagram_url: s.instagram_url, facebook_url: s.facebook_url,
      max_reservations_per_phone_per_month: s.max_reservations_per_phone_per_month
    } };
  },

  /* -------- items -------- */
  GET_items(params) {
    runExpirySweep(params);
    const { store, query } = params;
    let items = store.data.items.slice();
    const status = query.get('status');
    const type = query.get('type');
    const q = (query.get('q') || '').trim().toLowerCase();
    if (status) items = items.filter((i) => i.status === status);
    if (type) items = items.filter((i) => i.type === type);
    if (q) items = items.filter((i) => (i.name || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q));
    const order = { available: 0, reserved: 1, taken: 2, sold: 3 };
    items.sort((a, b) =>
      (order[a.status] - order[b.status]) || (new Date(b.created_at) - new Date(a.created_at)));
    return { status: 200, data: items.map(publicItem) };
  },

  GET_item(params) {
    const item = params.store.data.items.find((i) => i.id === params.parts[2]);
    if (!item) throw new HttpError(404, '找不到這件物品。');
    return { status: 200, data: publicItem(item) };
  },

  /* -------- reservations (public) -------- */
  POST_reservations(params) {
    runExpirySweep(params);
    const { store, body } = params;
    const item = store.data.items.find((i) => i.id === body.item_id);
    if (!item) throw new HttpError(404, '找不到這件物品。');

    const name = String(body.customer_name || '').trim();
    if (name.length < 1 || name.length > 40) throw new HttpError(400, '請填寫姓名（40 字以內）。');
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, '請填寫有效的 8 位香港電話號碼。');

    const pickup = new Date(body.pickup_time);
    if (Number.isNaN(pickup.getTime())) throw new HttpError(400, '請選擇取件時間。');
    if (pickup.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, '取件時間必須在未來。');
    if (pickup.getTime() > Date.now() + 60 * 24 * 3600_000) throw new HttpError(400, '取件時間太遠，請於 60 日內到店取件。');

    if (item.status === 'available') {
      // ok
    } else if (item.status === 'reserved') {
      throw new HttpError(409, '這件物品已有人預約（保留中），暫時未能再預約。');
    } else {
      throw new HttpError(409, '這件物品已取走，無法預約。');
    }

    const activeSame = store.data.reservations.some(
      (r) => r.item_id === item.id && r.phone === phone &&
        (r.status === 'pending' || r.status === 'confirmed'));
    if (activeSame) throw new HttpError(409, '你已預約過這件物品，請到「我的預約」查看。');

    const quota = Number(store.data.settings.max_reservations_per_phone_per_month) || 2;
    const thisMonth = monthKey(nowIso());
    const used = store.data.reservations.filter(
      (r) => r.phone === phone && monthKey(r.created_at) === thisMonth &&
        ['pending', 'confirmed', 'completed'].includes(r.status)).length;
    if (used >= quota) {
      throw new HttpError(429, `這個電話號碼本月已預約 ${quota} 件物品（每月上限），請下月再試或聯絡店主。`);
    }

    const rsv = {
      id: uid('rsv'), item_id: item.id, customer_name: name, phone,
      pickup_time: pickup.toISOString(), status: 'pending',
      created_at: nowIso(), updated_at: nowIso()
    };
    store.data.reservations.unshift(rsv);
    item.status = 'reserved';
    item.reservation_id = rsv.id;
    item.updated_at = nowIso();
    logAction(params, { item_id: item.id, action: 'reserve', notes: `${name} 預約提取` });
    store.save();
    return { status: 201, data: { reservation: publicReservation(rsv, item), quota_left: Math.max(0, quota - used - 1) } };
  },

  GET_reservation(params) {
    const rsv = params.store.data.reservations.find((r) => r.id === params.parts[2]);
    if (!rsv) throw new HttpError(404, '找不到這項預約。');
    const phone = phoneFromQuery(params);
    if (rsv.phone !== phone) throw new HttpError(404, '找不到這項預約。');
    const item = params.store.data.items.find((i) => i.id === rsv.item_id);
    return { status: 200, data: publicReservation(rsv, item) };
  },

  GET_reservations_by_phone(params) {
    runExpirySweep(params);
    const phone = phoneFromQuery(params);
    const { store } = params;
    const mine = store.data.reservations
      .filter((r) => r.phone === phone)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { status: 200, data: mine.map((r) => publicReservation(r, store.data.items.find((i) => i.id === r.item_id))) };
  },

  POST_cancel_reservation(params) {
    const rsv = params.store.data.reservations.find((r) => r.id === params.parts[2]);
    if (!rsv) throw new HttpError(404, '找不到這項預約。');
    const phone = normalizePhone(params.body?.phone);
    if (rsv.phone !== phone) throw new HttpError(403, '無法取消別人的預約。');
    if (!['pending', 'confirmed'].includes(rsv.status)) {
      throw new HttpError(409, `此預約狀態為「${rsv.status}」，無法取消。`);
    }
    releaseReservation(params, rsv, 'cancelled', '顧客自行取消');
    return { status: 200, data: { ok: true } };
  },

  /* -------- admin: auth -------- */
  POST_login(params) {
    const password = String(params.body?.password ?? '');
    const res = params.auth.login(password, params.ip);
    if (!res.ok) {
      throw new HttpError(401, res.retryInSec > 0
        ? `嘗試次數過多，請 ${Math.ceil(res.retryInSec / 60)} 分鐘後再試。`
        : '密碼不正確。');
    }
    return { status: 200, data: res };
  },

  POST_logout(params) {
    if (params.token) params.auth.logout(params.token);
    return { status: 200, data: { ok: true } };
  },

  GET_auth(params) {
    adminOnly(params);
    return { status: 200, data: { ok: true } };
  },

  /* -------- admin: items -------- */
  GET_admin_items(params) {
    adminOnly(params);
    runExpirySweep(params);
    const { store } = params;
    const list = store.data.items.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return { status: 200, data: list };
  },

  POST_admin_items(params) {
    adminOnly(params);
    const item = buildItem(params, null);
    params.store.data.items.unshift(item);
    logAction(params, { item_id: item.id, action: 'create', notes: `上架：${item.name}` });
    params.store.save();
    return { status: 201, data: item };
  },

  PATCH_admin_item(params) {
    adminOnly(params);
    const { store } = params;
    const item = store.data.items.find((i) => i.id === params.itemId);
    if (!item) throw new HttpError(404, '找不到這件物品。');
    const name = String(params.body?.name ?? '').trim();
    if (name && name.length > 60) throw new HttpError(400, '名稱不可超過 60 字。');
    if (name) item.name = name;
    if (typeof params.body?.description === 'string') item.description = params.body.description.trim();
    if (typeof params.body?.image_url === 'string') item.image_url = params.body.image_url.trim();
    if (params.body?.type) {
      if (!ITEM_TYPES.includes(params.body.type)) throw new HttpError(400, '物品類別不正確。');
      item.type = params.body.type;
    }
    if ('price' in params.body) {
      item.price = priceOrNull(params.body.price, item.type);
    }
    item.updated_at = nowIso();
    logAction(params, { item_id: item.id, action: 'update', notes: `更新：${item.name}` });
    store.save();
    return { status: 200, data: item };
  },

  DELETE_admin_item(params) {
    adminOnly(params);
    const { store } = params;
    const item = store.data.items.find((i) => i.id === params.itemId);
    if (!item) throw new HttpError(404, '找不到這件物品。');
    const active = store.data.reservations.some(
      (r) => r.item_id === item.id && (r.status === 'pending' || r.status === 'confirmed'));
    if (active) throw new HttpError(409, '這件物品有進行中的預約，請先取消預約再刪除。');
    store.data.items = store.data.items.filter((i) => i.id !== item.id);
    logAction(params, { item_id: item.id, action: 'update', notes: `下架刪除：${item.name}` });
    store.save();
    return { status: 200, data: { ok: true } };
  },

  PATCH_item_status(params) {
    adminOnly(params);
    const { store, body } = params;
    const item = store.data.items.find((i) => i.id === params.itemId);
    if (!item) throw new HttpError(404, '找不到這件物品。');
    const to = body?.status;
    if (!ITEM_STATUSES.includes(to)) throw new HttpError(400, '狀態不正確。');
    setItemStatus(params, item, to, String(body?.notes || '').trim());
    return { status: 200, data: item };
  },

  /* -------- admin: reservations -------- */
  GET_admin_reservations(params) {
    adminOnly(params);
    runExpirySweep(params);
    const { store } = params;
    const status = params.query.get('status');
    let list = store.data.reservations.slice();
    if (status) list = list.filter((r) => r.status === status);
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { status: 200, data: list.map((r) => publicReservation(r, store.data.items.find((i) => i.id === r.item_id))) };
  },

  PATCH_admin_reservation(params) {
    adminOnly(params);
    const { store, body } = params;
    const rsv = store.data.reservations.find((r) => r.id === params.resId);
    if (!rsv) throw new HttpError(404, '找不到這項預約。');
    const notes = String(body?.notes || '').trim();
    if (body?.status === 'completed') {
      if (rsv.status === 'completed') throw new HttpError(409, '此預約已完成。');
      if (!['pending', 'confirmed'].includes(rsv.status)) throw new HttpError(409, '只有進行中的預約可以核銷取件。');
      completeReservation(params, rsv, notes);
    } else if (body?.status === 'cancelled') {
      if (!['pending', 'confirmed'].includes(rsv.status)) throw new HttpError(409, '只有進行中的預約可以取消。');
      releaseReservation(params, rsv, 'cancelled', notes || '店主取消');
    } else {
      throw new HttpError(400, '只支援完成或取消預約。');
    }
    return { status: 200, data: { ok: true } };
  },

  /* -------- admin: reports / settings -------- */
  GET_reports_summary(params) {
    adminOnly(params);
    runExpirySweep(params);
    const { store } = params;
    const items = store.data.items;
    const rsvs = store.data.reservations;
    const count = (fn) => items.filter(fn).length;

    const terminal = rsvs.filter((r) => ['completed', 'cancelled', 'expired'].includes(r.status));
    const completed = rsvs.filter((r) => r.status === 'completed').length;
    const pickupRate = terminal.length
      ? Math.round((completed / terminal.length) * 1000) / 10
      : 0;

    const fundTotal = items
      .filter((i) => i.type !== 'free' && (i.status === 'taken' || i.status === 'sold') && typeof i.price === 'number')
      .reduce((s, i) => s + i.price, 0);

    const today = monthKey(nowIso());
    const circulatedThisMonth = items.filter(
      (i) => (i.status === 'taken' || i.status === 'sold') && monthKey(i.updated_at) === today).length;

    return { status: 200, data: {
      items: {
        total: items.length,
        available: count((i) => i.status === 'available'),
        reserved: count((i) => i.status === 'reserved'),
        taken: count((i) => i.status === 'taken'),
        sold: count((i) => i.status === 'sold')
      },
      reservations: {
        total: rsvs.length,
        pending: rsvs.filter((r) => r.status === 'pending').length,
        confirmed: rsvs.filter((r) => r.status === 'confirmed').length,
        completed: rsvs.filter((r) => r.status === 'completed').length,
        cancelled: rsvs.filter((r) => r.status === 'cancelled').length,
        expired: rsvs.filter((r) => r.status === 'expired').length
      },
      circulation: { this_month: circulatedThisMonth, total: count((i) => i.status === 'taken' || i.status === 'sold') },
      pickup_rate: pickupRate,
      fund_raised: fundTotal,
      trend: monthStats(params)
    } };
  },

  GET_admin_actions(params) {
    adminOnly(params);
    return { status: 200, data: params.store.data.actions.slice(0, 40) };
  },

  GET_admin_settings(params) {
    adminOnly(params);
    return { status: 200, data: params.store.data.settings };
  },

  POST_admin_items_bulk(params) {
    adminOnly(params);
    const { store } = params;
    const rows = Array.isArray(params.body?.items) ? params.body.items : null;
    if (!rows) throw new HttpError(400, '請提供 items 陣列。');
    if (rows.length === 0) throw new HttpError(400, '沒有可上架的物品。');
    if (rows.length > 500) throw new HttpError(400, '每次最多上架 500 件物品。');

    const added = [];
    const errors = [];
    rows.forEach((row, idx) => {
      const line = idx + 2; // 1-based + header row
      try {
        const item = buildItem({ body: row, store });
        store.data.items.unshift(item);
        added.push(item);
      } catch (err) {
        errors.push({ line, name: String(row?.name || '').trim() || `（第 ${line} 行）`, error: err.message });
      }
    });
    if (added.length) {
      logAction(params, { item_id: '', action: 'create', notes: `批量上架 ${added.length} 件物品` });
      store.save();
    }
    return { status: 200, data: { added: added.length, errors } };
  },

  /* -------- admin: export (CSV / JSON backup) -------- */
  GET_admin_export(params) {
    adminOnly(params);
    const { store } = params;
    const kind = params.sub;
    const stamp = new Date().toISOString().slice(0, 10);
    const csv = (rows) => '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const itemRow = (i) => [
      i.id, i.name, i.type, i.type === 'free' ? '' : i.price, i.status,
      i.description, i.image_url, i.created_at, i.updated_at, i.reservation_id ?? ''
    ];
    const rsvRow = (r, item) => [
      r.id, r.item_id, item?.name ?? '', r.customer_name, r.phone,
      r.pickup_time, r.status, r.created_at, r.updated_at
    ];

    if (kind === 'items.csv') {
      return {
        status: 200,
        raw: csv([
          ['id', 'name', 'type', 'price', 'status', 'description', 'image_url', 'created_at', 'updated_at', 'reservation_id'],
          ...store.data.items.map(itemRow)
        ]),
        contentType: 'text/csv; charset=utf-8',
        downloadName: `easoug-items-${stamp}.csv`
      };
    }
    if (kind === 'reservations.csv') {
      return {
        status: 200,
        raw: csv([
          ['id', 'item_id', 'item_name', 'customer_name', 'phone', 'pickup_time', 'status', 'created_at', 'updated_at'],
          ...store.data.reservations.map((r) => rsvRow(r, store.data.items.find((i) => i.id === r.item_id)))
        ]),
        contentType: 'text/csv; charset=utf-8',
        downloadName: `easoug-reservations-${stamp}.csv`
      };
    }
    if (kind === 'backup.json') {
      return {
        status: 200,
        raw: JSON.stringify(store.data, null, 2),
        contentType: 'application/json; charset=utf-8',
        downloadName: `easoug-backup-${stamp}.json`
      };
    }
    throw new HttpError(404, '不支援的匯出格式。');
  },

  PATCH_admin_settings(params) {
    adminOnly(params);
    const s = params.store.data.settings;
    const b = params.body || {};
    const str = (v) => (typeof v === 'string' ? v.trim() : undefined);
    const keys = ['shop_name', 'tagline', 'contact_phone', 'address', 'hours', 'notice', 'payment_url', 'payment_note', 'instagram_url', 'facebook_url'];
    for (const k of keys) {
      const v = str(b[k]);
      if (v !== undefined && v.length <= 500) s[k] = v;
    }
    if (b.max_reservations_per_phone_per_month !== undefined) {
      const n = Math.floor(Number(b.max_reservations_per_phone_per_month));
      if (Number.isFinite(n) && n >= 1 && n <= 20) s.max_reservations_per_phone_per_month = n;
    }
    if (b.expiry_hours !== undefined) {
      const h = Math.floor(Number(b.expiry_hours));
      if (Number.isFinite(h) && h >= 1 && h <= 168) s.expiry_hours = h;
    }
    params.store.save();
    return { status: 200, data: s };
  }
};

/* --------------------------- item status transitions --------------------------- */

/** Release a reservation (cancel / expire) and free its item when it is the holder. */
function releaseReservation(params, rsv, status, note) {
  const { store } = params;
  const item = store.data.items.find((i) => i.id === rsv.item_id);
  if (item && item.reservation_id === rsv.id) {
    item.status = 'available';
    item.reservation_id = null;
    item.updated_at = nowIso();
  }
  rsv.status = status;
  rsv.updated_at = nowIso();
  logAction(params, { item_id: rsv.item_id, action: 'release', notes: note });
  store.save();
}

/** Complete pickup: reservation done, item leaves the shop. */
function completeReservation(params, rsv, note) {
  const { store } = params;
  const item = store.data.items.find((i) => i.id === rsv.item_id);
  if (item && item.reservation_id === rsv.id) {
    item.reservation_id = null;
    item.status = item.type === 'special' ? 'sold' : 'taken';
    item.updated_at = nowIso();
  }
  rsv.status = 'completed';
  rsv.updated_at = nowIso();
  logAction(params, { item_id: rsv.item_id, action: 'take', notes: note || `完成取件：${rsv.customer_name}` });
  store.save();
}

/** Admin force-set of an item status, keeping reservations consistent. */
function setItemStatus(params, item, to, notes) {
  const { store } = params;
  const from = item.status;
  if (from === to) return;

  const activeRsv = store.data.reservations.find(
    (r) => r.item_id === item.id && ['pending', 'confirmed'].includes(r.status));

  if (from === 'reserved') {
    // Leaving reserved: end the holding reservation first.
    if (to === 'available') {
      if (activeRsv) releaseReservation(params, activeRsv, 'cancelled', notes || '店主釋放物品');
      else { item.status = 'available'; item.updated_at = nowIso(); store.save(); }
      return;
    }
    if (to === 'taken' || to === 'sold') {
      if (activeRsv) completeReservation(params, activeRsv, notes);
      else { item.status = to; item.updated_at = nowIso(); store.save(); }
      return;
    }
    throw new HttpError(400, '保留中的物品只能釋放（可取）或核銷（已取走）。');
  }

  if (to === 'reserved') {
    throw new HttpError(400, '請透過「預約」將物品設為保留中，或取消現有預約後再操作。');
  }
  if (to === 'taken' && item.type === 'special') to = 'sold';

  const label = { available: '重新上架（可取）', taken: '標記為已取走', sold: '標記為已售出' }[to] || to;
  item.status = to;
  item.updated_at = nowIso();
  const act = to === 'available' ? 'release' : to === 'sold' ? 'sell' : 'take';
  logAction(params, { item_id: item.id, action: act, notes: notes || label });
  store.save();
}

function buildItem(params, existing) {
  const b = params.body || {};
  const name = String(b.name || '').trim();
  if (!name || name.length > 60) throw new HttpError(400, '請填寫物品名稱（60 字以內）。');
  const type = b.type;
  if (!ITEM_TYPES.includes(type)) throw new HttpError(400, '物品類別不正確（free/donation/special）。');
  const price = priceOrNull(b.price, type);
  const image_url = typeof b.image_url === 'string' && b.image_url.trim()
    ? b.image_url.trim()
    : '/images/seed/default.svg';
  const now = nowIso();
  return {
    id: existing?.id || uid('itm'),
    name,
    description: typeof b.description === 'string' ? b.description.trim() : '',
    image_url,
    status: existing?.status || 'available',
    type,
    price,
    created_at: existing?.created_at || now,
    updated_at: now,
    reservation_id: existing?.reservation_id ?? null
  };
}

function priceOrNull(raw, type) {
  if (type === 'free') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    throw new HttpError(400, '捐款／特賣物品必須填寫有效價格（HKD）。');
  }
  return Math.round(n * 100) / 100;
}

/* ---------------------------------- router ---------------------------------- */

/** Route a request. Returns { status, data } and never throws for the caller. */
export function routeApi(params) {
  const { method, parts } = params;
  if (parts.length < 2 || parts[0] !== 'api') return null;

  const [ , resource, id1, sub, id2 ] = parts;

  // /api/settings
  if (resource === 'settings' && method === 'GET') return handlers.GET_settings(params);

  // /api/items, /api/items/:id, /api/items/:id/status
  if (resource === 'items') {
    if (method === 'GET' && !id1) return handlers.GET_items(params);
    if (method === 'GET' && id1 && !sub) return handlers.GET_item(params);
    if (method === 'PATCH' && id1 && sub === 'status') {
      params.itemId = id1;
      return handlers.PATCH_item_status(params);
    }
  }

  // /api/reservations, /api/reservations/:id, /api/reservations/:id/cancel
  if (resource === 'reservations') {
    if (method === 'POST' && !id1) return handlers.POST_reservations(params);
    if (method === 'GET' && !id1) return handlers.GET_reservations_by_phone(params);
    if (method === 'GET' && id1) return handlers.GET_reservation(params);
    if (method === 'POST' && id1 && sub === 'cancel') return handlers.POST_cancel_reservation(params);
  }

  // /api/reports/summary
  if (resource === 'reports' && id1 === 'summary' && method === 'GET') {
    return handlers.GET_reports_summary(params);
  }

  // /api/admin/...
  if (resource === 'admin' && id1) {
    if (id1 === 'items' && sub === 'bulk' && !id2 && method === 'POST') {
      return handlers.POST_admin_items_bulk(params);
    }
    if (id1 === 'export' && sub && !id2 && method === 'GET') {
      params.sub = sub;
      return handlers.GET_admin_export(params);
    }
    if (id1 === 'login' && method === 'POST') return handlers.POST_login(params);
    if (id1 === 'logout' && method === 'POST') return handlers.POST_logout(params);
    if (id1 === 'auth' && method === 'GET') return handlers.GET_auth(params);
    if (id1 === 'items' && !sub && method === 'GET') return handlers.GET_admin_items(params);
    if (id1 === 'items' && !sub && method === 'POST') return handlers.POST_admin_items(params);
    if (id1 === 'items' && sub && !id2 && method === 'PATCH') {
      params.itemId = sub;
      return handlers.PATCH_admin_item(params);
    }
    if (id1 === 'items' && sub && !id2 && method === 'DELETE') {
      params.itemId = sub;
      return handlers.DELETE_admin_item(params);
    }
    if (id1 === 'items' && sub && id2 === 'status' && method === 'PATCH') {
      params.itemId = sub;
      return handlers.PATCH_item_status(params);
    }
    if (id1 === 'reservations' && !sub && method === 'GET') return handlers.GET_admin_reservations(params);
    if (id1 === 'reservations' && sub && !id2 && method === 'PATCH') {
      params.resId = sub;
      return handlers.PATCH_admin_reservation(params);
    }
    if (id1 === 'actions' && !sub && method === 'GET') return handlers.GET_admin_actions(params);
    if (id1 === 'settings' && !sub && method === 'GET') return handlers.GET_admin_settings(params);
    if (id1 === 'settings' && !sub && method === 'PATCH') return handlers.PATCH_admin_settings(params);
  }

  return { status: 404, data: { error: '找不到此 API 路徑。' } };
}
