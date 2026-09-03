import crypto from 'node:crypto';

export const HK_TZ = 'Asia/Hong_Kong';

/** Short unique id like `itm_3f9c1a2b4c5d` */
export function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export const nowIso = () => new Date().toISOString();

/**
 * Normalize a HK phone number: strips spaces/dashes/brackets and a leading
 * +852 / 852 / 00852. Returns the bare 8-digit number, or null when invalid.
 */
export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[\s\-()（）._]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('852')) s = s.slice(3);
  else if (s.startsWith('00852')) s = s.slice(5);
  if (!/^[2-9]\d{7}$/.test(s)) return null;
  return s;
}

/** Format an ISO date for display in the HK timezone. */
export function formatDateTime(iso, { withTime = true } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = withTime
    ? { timeZone: HK_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { timeZone: HK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-Hant-HK', opts).format(d);
}

/** Local (HK) month key like `2026-09`. */
export function monthKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: HK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return ymd.slice(0, 7);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const ok = (data, extra) => ({ status: 200, data, ...extra });
export const created = (data) => ({ status: 201, data });
