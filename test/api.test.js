import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easoug-test-'));
const app = createApp({ dbPath: path.join(tmp, 'db.json'), adminPassword: 'test-pw' });
let base = '';
let adminToken = '';

before(async () => {
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function req(method, url, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const pickup = () => new Date(Date.now() + 6 * 3600_000).toISOString();
const book = (body) => req('POST', '/api/reservations', { body: { pickup_time: pickup(), ...body } });

let freeItemA;

test('serves the public shell and admin pages over HTTP', async () => {
  for (const [p, needle] of [['/', '易搜數碼'], ['/item.html', 'id="detail"'], ['/admin/', '後台登入'], ['/admin/items.html', '批量上架'], ['/manifest.webmanifest', 'short_name'], ['/sw.js', 'easoug-v']]) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    const text = await res.text();
    assert.ok(text.includes(needle), `${p} 缺少 ${needle}`);
  }
  const missing = await fetch(base + '/server/store.js');
  assert.equal(missing.status, 404, 'server source must not be publicly served');
});

test('GET /api/items lists the seeded catalogue available-first', async () => {
  const { status, data } = await req('GET', '/api/items');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data) && data.length >= 5);
  freeItemA = data.find((i) => i.status === 'available' && i.type === 'free');
  assert.ok(freeItemA, 'expected a free available item');
  const rank = { available: 0, reserved: 1, taken: 2, sold: 3 };
  for (let i = 1; i < data.length; i++) {
    assert.ok(rank[data[i - 1].status] <= rank[data[i].status], 'items should sort available-first');
  }
});

test('customer can reserve an available item (status sync to reserved)', async () => {
  const { status, data } = await book({ item_id: freeItemA.id, customer_name: '測試員', phone: '60112233' });
  assert.equal(status, 201);
  assert.equal(data.reservation.status, 'pending');
  assert.equal(data.reservation.phone, '60112233');
  const item = (await req('GET', `/api/items/${freeItemA.id}`)).data;
  assert.equal(item.status, 'reserved', 'item must flip to reserved');
});

test('reserving the same item again is rejected (409)', async () => {
  const other = await book({ item_id: freeItemA.id, customer_name: '另一人', phone: '62224444' });
  assert.equal(other.status, 409);
  const mine = await book({ item_id: freeItemA.id, customer_name: '測試員', phone: '60112233' });
  assert.equal(mine.status, 409, 'same customer cannot double-book');
});

test('customer can see their reservations by phone', async () => {
  const { status, data } = await req('GET', '/api/reservations?phone=60112233');
  assert.equal(status, 200);
  assert.equal(data.length, 1);
  assert.equal(data[0].item_id, freeItemA.id);
});

test('cancelling a reservation releases the item again', async () => {
  const id = (await req('GET', '/api/reservations?phone=60112233')).data[0].id;
  const { status } = await req('POST', `/api/reservations/${id}/cancel`, { body: { phone: '60112233' } });
  assert.equal(status, 200);
  const item = (await req('GET', `/api/items/${freeItemA.id}`)).data;
  assert.equal(item.status, 'available', 'cancelled reservation must free the item');
  const again = await req('POST', `/api/reservations/${id}/cancel`, { body: { phone: '60112233' } });
  assert.equal(again.status, 409, 'double cancel rejected');
  const other = await req('POST', `/api/reservations/${id}/cancel`, { body: { phone: '62224444' } });
  assert.equal(other.status, 403, 'other phones cannot cancel it');
});

test('monthly quota: max 2 active reservations per phone', async () => {
  const list = (await req('GET', '/api/items')).data;
  // Use two other items so the cancelled one (freeItemA) stays free for the 429 attempt.
  const others = list.filter((i) => i.status === 'available' && i.id !== freeItemA.id).slice(0, 2);
  assert.ok(others.length === 2);
  for (const it of others) {
    const r = await book({ item_id: it.id, customer_name: '配額測試', phone: '63335555' });
    assert.equal(r.status, 201);
  }
  const third = await book({ item_id: freeItemA.id, customer_name: '配額測試', phone: '63335555' });
  assert.equal(third.status, 429, 'third active reservation in a month must hit the quota');
});

test('admin auth: 401 without token, rejects wrong password, issues tokens', async () => {
  const anon = await req('GET', '/api/admin/items');
  assert.equal(anon.status, 401);
  const bad = await req('POST', '/api/admin/login', { body: { password: 'wrong' } });
  assert.equal(bad.status, 401);
  const ok = await req('POST', '/api/admin/login', { body: { password: 'test-pw' } });
  assert.equal(ok.status, 200);
  adminToken = ok.data.token;
  assert.ok(adminToken);
  const verify = await req('GET', '/api/admin/auth', { token: adminToken });
  assert.equal(verify.status, 200);
});

test('admin can create, edit and change item status', async () => {
  const created = await req('POST', '/api/admin/items', {
    token: adminToken,
    body: { name: '測試用檯燈', type: 'donation', price: 100, description: 'test', image_url: '/images/seed/default.svg' }
  });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.status, 'available');

  const patched = await req('PATCH', `/api/admin/items/${id}`, { token: adminToken, body: { name: '測試用檯燈（已改名）' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.name, '測試用檯燈（已改名）');

  const sold = await req('PATCH', `/api/admin/items/${id}/status`, { token: adminToken, body: { status: 'sold', notes: 'counter sale' } });
  assert.equal(sold.status, 200);
  assert.equal(sold.data.status, 'sold');
});

test('admin completes a reservation → item taken, report counts it', async () => {
  const target = (await req('GET', '/api/items')).data.find((i) => i.status === 'available');
  const made = await book({ item_id: target.id, customer_name: '核銷測試', phone: '64446666' });
  const rsvId = made.data.reservation.id;
  const done = await req('PATCH', `/api/admin/reservations/${rsvId}`, { token: adminToken, body: { status: 'completed' } });
  assert.equal(done.status, 200);
  const item = (await req('GET', `/api/items/${target.id}`)).data;
  assert.equal(item.status, 'taken');

  const report = await req('GET', '/api/reports/summary', { token: adminToken });
  assert.equal(report.status, 200);
  assert.ok(report.data.items.taken >= 1);
  assert.ok(report.data.reservations.completed >= 1);
  const noAuth = await req('GET', '/api/reports/summary');
  assert.equal(noAuth.status, 401, 'reports must require admin');
});

test('reservations older than the expiry window are swept (expired + released)', async () => {
  const target = (await req('GET', '/api/items')).data.find((i) => i.status === 'available');
  const made = await book({ item_id: target.id, customer_name: '逾期測試', phone: '65557777' });
  const rsvId = made.data.reservation.id;
  assert.equal(made.data.reservation.status, 'pending');

  // Age the reservation beyond the 24h window (white-box, via the store).
  const rsv = app.store.data.reservations.find((r) => r.id === rsvId);
  rsv.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();

  await req('GET', '/api/items'); // any read triggers the sweep
  const after = (await req('GET', `/api/items/${target.id}`)).data;
  assert.equal(after.status, 'available', 'expired hold must release the item');
  const mine = await req('GET', '/api/reservations?phone=65557777');
  assert.equal(mine.data[0].status, 'expired');
});

test('admin settings PATCH flows through to the public settings', async () => {
  const patch = await req('PATCH', '/api/admin/settings', {
    token: adminToken, body: { payment_url: 'https://payme.example/easoug', shop_name: '易搜數碼（測試）' }
  });
  assert.equal(patch.status, 200);
  const pub = (await req('GET', '/api/settings')).data;
  assert.equal(pub.payment_url, 'https://payme.example/easoug');
  assert.equal(pub.shop_name, '易搜數碼（測試）');
});

test('deleting an item with an active reservation is blocked', async () => {
  const target = (await req('GET', '/api/items')).data.find((i) => i.status === 'available');
  const made = await book({ item_id: target.id, customer_name: '刪除測試', phone: '66668888' });
  assert.equal(made.status, 201);
  const del = await req('DELETE', `/api/admin/items/${target.id}`, { token: adminToken });
  assert.equal(del.status, 409, 'cannot delete while a reservation is active');
  const mine = (await req('GET', '/api/reservations?phone=66668888')).data;
  await req('POST', `/api/reservations/${mine[0].id}/cancel`, { body: { phone: '66668888' } });
  const del2 = await req('DELETE', `/api/admin/items/${target.id}`, { token: adminToken });
  assert.equal(del2.status, 200);
});

test('service worker must not intercept non-GET / cross-origin requests (login POST regression)', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'sw.js'), 'utf8');
  const marker = "self.addEventListener('fetch'";
  const start = src.indexOf(marker);
  const end = src.indexOf('});', start);
  const listener = src.slice(start, end + 3);
  const guard = listener.indexOf("req.method !== 'GET'");
  const respond = listener.indexOf('event.respondWith(');
  assert.ok(guard !== -1 && respond !== -1, 'fetch listener must guard method/origin before respondWith');
  assert.ok(guard < respond,
    'respondWith must only run after the non-GET/cross-origin guard, else POST login fails with "Failed to fetch"');
  assert.ok(listener.includes('event.respondWith(handle(event))'), 'GET requests are still handled by the SW');
});

test('bulk import: adds valid rows, reports row-level errors, requires auth', async () => {
  const anon = await req('POST', '/api/admin/items/bulk', { body: { items: [{ name: 'x' }] } });
  assert.equal(anon.status, 401);

  const res = await req('POST', '/api/admin/items/bulk', {
    token: adminToken,
    body: {
      items: [
        { name: '批量書架 A', type: 'free', description: 'ok' },
        { name: '批量花瓶 B', type: 'donation', price: 50, image_url: 'https://example.com/v.png' },
        { name: '', type: 'free' },
        { name: '壞類別 C', type: 'unknown' }
      ]
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.added, 2, 'only valid rows are added');
  assert.equal(res.data.errors.length, 2, 'invalid rows are reported');
  assert.equal(res.data.errors[0].line, 4);

  const list = (await req('GET', '/api/admin/items', { token: adminToken })).data;
  assert.ok(list.some((i) => i.name === '批量書架 A'));
  assert.ok(list.some((i) => i.name === '批量花瓶 B'));

  const empty = await req('POST', '/api/admin/items/bulk', { token: adminToken, body: { items: [] } });
  assert.equal(empty.status, 400);
});

test('export: items/reservations CSV and JSON backup download with auth', async () => {
  const headers = { Authorization: `Bearer ${adminToken}` };
  const itemsCsv = await fetch(base + '/api/admin/export/items.csv', { headers });
  assert.equal(itemsCsv.status, 200);
  assert.ok(itemsCsv.headers.get('content-type').includes('text/csv'));
  assert.ok(itemsCsv.headers.get('content-disposition').includes('attachment'));
  const itemsBuf = new Uint8Array(await itemsCsv.arrayBuffer());
  assert.deepEqual([...itemsBuf.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV bytes start with UTF-8 BOM for Excel');
  const itemsText = new TextDecoder().decode(itemsBuf);
  assert.ok(itemsText.includes('"id","name","type"'));
  assert.ok(itemsText.includes('原木三層書架'), 'seeded item is in the export');

  const rsvCsv = await fetch(base + '/api/admin/export/reservations.csv', { headers });
  assert.equal(rsvCsv.status, 200);
  const rsvText = await rsvCsv.text();
  assert.ok(rsvText.includes('"id","item_id","item_name"'));
  assert.ok(rsvText.includes('陳小姐'));

  const backup = await fetch(base + '/api/admin/export/backup.json', { headers });
  assert.equal(backup.status, 200);
  const parsed = JSON.parse(await backup.text());
  assert.ok(Array.isArray(parsed.items) && Array.isArray(parsed.reservations));
  assert.ok(parsed.settings.shop_name);

  const anon = await fetch(base + '/api/admin/export/items.csv');
  assert.equal(anon.status, 401);
});

test('social links: defaults exposed publicly and editable via admin settings', async () => {
  const pub = (await req('GET', '/api/settings')).data;
  assert.equal(pub.instagram_url, 'https://www.instagram.com/goodschance/');
  assert.equal(pub.facebook_url, 'https://www.facebook.com/GoodsChance');

  const patch = await req('PATCH', '/api/admin/settings', {
    token: adminToken, body: { instagram_url: 'https://instagram.com/updated', facebook_url: 'https://facebook.com/updated' }
  });
  assert.equal(patch.status, 200);
  const after = (await req('GET', '/api/settings')).data;
  assert.equal(after.instagram_url, 'https://instagram.com/updated');
  assert.equal(after.facebook_url, 'https://facebook.com/updated');
});

test('validation: bad phone and non-future pickup are rejected', async () => {
  const target = (await req('GET', '/api/items')).data.find((i) => i.status === 'available');
  const badPhone = await book({ item_id: target.id, customer_name: '阿強', phone: '12345' });
  assert.equal(badPhone.status, 400);
  const past = await req('POST', '/api/reservations', {
    body: { item_id: target.id, customer_name: '阿強', phone: '69998888', pickup_time: new Date(Date.now() - 3600_000).toISOString() }
  });
  assert.equal(past.status, 400);
});
