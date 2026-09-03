import crypto from 'node:crypto';

/**
 * Minimal admin auth: one password (env ADMIN_PASSWORD, default easoug1234),
 * bearer tokens held in memory with a TTL, and per-IP login throttling.
 * Good enough for the MVP pilot — swap for a real auth layer before public use.
 */
export class AdminAuth {
  constructor(password, { ttlMs = 12 * 3600_000 } = {}) {
    this.password = password;
    this.ttlMs = ttlMs;
    this.tokens = new Map(); // token -> expiry (ms)
    this.failures = new Map(); // ip -> { count, until }
  }

  #hash(s) {
    return crypto.createHash('sha256').update(String(s)).digest();
  }

  #lockWindow(ip) {
    const rec = this.failures.get(ip);
    if (rec && rec.until > Date.now()) {
      return Math.ceil((rec.until - Date.now()) / 1000);
    }
    if (rec && rec.count >= 10) {
      this.failures.set(ip, { count: 0, until: Date.now() + 5 * 60_000 });
      return 300;
    }
    return 0;
  }

  login(password, ip = '') {
    const lock = this.#lockWindow(ip);
    if (lock > 0) {
      return { ok: false, retryInSec: lock };
    }
    const a = this.#hash(password);
    const b = this.#hash(this.password);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      this.failures.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      this.tokens.set(token, Date.now() + this.ttlMs);
      return { ok: true, token, expires_at: new Date(Date.now() + this.ttlMs).toISOString() };
    }
    const rec = this.failures.get(ip) || { count: 0, until: 0 };
    rec.count += 1;
    this.failures.set(ip, rec);
    return { ok: false, retryInSec: 0 };
  }

  verify(token) {
    if (!token) return false;
    const exp = this.tokens.get(token);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  logout(token) {
    this.tokens.delete(token);
  }
}
