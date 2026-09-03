/** API client for the public pages. All calls hit the same-origin JSON API. */
const API_BASE = '/api';

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('無法連線伺服器，請檢查網絡後再試。');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `要求失敗（${res.status}）`);
  return data;
}

export const getItems = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return api(`/items${qs ? `?${qs}` : ''}`);
};
export const getItem = (id) => api(`/items/${id}`);
export const createReservation = (body) => api('/reservations', { method: 'POST', body });
export const getReservation = (id, phone) => api(`/reservations/${id}?phone=${encodeURIComponent(phone)}`);
export const getMyReservations = (phone) => api(`/reservations?phone=${encodeURIComponent(phone)}`);
export const cancelReservation = (id, phone) => api(`/reservations/${id}/cancel`, { method: 'POST', body: { phone } });
export const getPublicSettings = () => api('/settings');
