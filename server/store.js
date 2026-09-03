import fs from 'node:fs';
import path from 'node:path';

export const ITEM_STATUSES = ['available', 'reserved', 'taken', 'sold'];
export const ITEM_TYPES = ['free', 'donation', 'special'];
export const RESERVATION_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'expired'];

const DEFAULT_SETTINGS = {
  shop_name: '易搜數碼 Easoug',
  tagline: '好好用 · 唔好嘥',
  contact_phone: '',
  address: '',
  hours: '',
  notice: '預約成功後物品會為你保留 24 小時，請於時限內到店取件。每個電話號碼每月最多可預約 2 件物品。',
  payment_url: '',
  payment_note: '你的捐款直接支持「易搜」繼續營運，讓更多好物繼續流動。',
  instagram_url: 'https://www.instagram.com/goodschance/',
  facebook_url: 'https://www.facebook.com/GoodsChance',
  max_reservations_per_phone_per_month: 2,
  expiry_hours: 24
};

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const hoursAhead = (h) => new Date(Date.now() + h * 3600_000).toISOString();

/** Demo content, inserted the first time the DB file is created. */
function seedData() {
  const t = Date.now();
  const iso = (offsetMs) => new Date(t + offsetMs).toISOString();

  const bikeRsv = {
    id: 'rsv_seed_bike',
    item_id: 'itm_seed_bike',
    customer_name: '陳小姐',
    phone: '51234567',
    pickup_time: iso(20 * 3600_000),
    status: 'pending',
    created_at: iso(-2 * 3600_000),
    updated_at: iso(-2 * 3600_000)
  };

  const items = [
    {
      id: 'itm_seed_bookshelf', name: '原木三層書架', type: 'free', price: null,
      description: '實木層板書架，結構穩固，層板有輕微使用痕跡。約 60cm 闊 × 90cm 高。\n適合放書、雜誌或盆栽。\n需要自行搬運，請自備手推車。',
      image_url: '/images/seed/bookshelf.svg', status: 'available',
      created_at: iso(-26 * 3600_000), updated_at: iso(-26 * 3600_000), reservation_id: null
    },
    {
      id: 'itm_seed_lamp', name: '白色書枱燈', type: 'free', price: null,
      description: 'LED 護眼書枱燈，觸控調光，功能正常。\n附原裝火牛。',
      image_url: '/images/seed/lamp.svg', status: 'available',
      created_at: iso(-30 * 3600_000), updated_at: iso(-30 * 3600_000), reservation_id: null
    },
    {
      id: 'itm_seed_vase', name: '復古陶瓷花瓶', type: 'donation', price: 80,
      description: '手繪復古花紋陶瓷花瓶，約 25cm 高。\n捐贈品，所得款項全數支持易搜營運。',
      image_url: '/images/seed/vase.svg', status: 'available',
      created_at: iso(-3 * 3600_000), updated_at: iso(-3 * 3600_000), reservation_id: null
    },
    {
      id: 'itm_seed_bike', name: '兒童單車 16 吋', type: 'free', price: null,
      description: '16 吋兒童單車，約 9 成新，輔助輪齊全。\n適合 4–6 歲小朋友。\n請於取件時自備貨車或的士運載。',
      image_url: '/images/seed/bike.svg', status: 'reserved',
      created_at: iso(-10 * 3600_000), updated_at: iso(-2 * 3600_000), reservation_id: bikeRsv.id
    },
    {
      id: 'itm_seed_backpack', name: '九成新 城市背包', type: 'free', price: null,
      description: '防潑水城市背包，約 22L，內有 15 吋筆電夾層。\n拉鏈暢順，狀況良好。',
      image_url: '/images/seed/backpack.svg', status: 'available',
      created_at: iso(-50 * 3600_000), updated_at: iso(-50 * 3600_000), reservation_id: null
    },
    {
      id: 'itm_seed_jacket', name: '淺藍色牛仔外套', type: 'special', price: 60,
      description: '男裝 M 碼牛仔外套，洗淨熨好。\n特賣品，尺寸為約略估計，建議到店試穿。',
      image_url: '/images/seed/jacket.svg', status: 'sold',
      created_at: iso(-200 * 3600_000), updated_at: iso(-120 * 3600_000), reservation_id: null
    },
    {
      id: 'itm_seed_microwave', name: '微波爐（已測試）', type: 'donation', price: 150,
      description: '20L 微波爐，功能正常，店內已實測。\n捐贈品，所得款項全數支持易搜營運。\n體積較大，請自備運輸。',
      image_url: '/images/seed/microwave.svg', status: 'available',
      created_at: iso(-80 * 3600_000), updated_at: iso(-80 * 3600_000), reservation_id: null
    },
    {
      id: 'itm_seed_books', name: '英文童書套裝（10 本）', type: 'free', price: null,
      description: '適合 3–8 歲的英文繪本及讀本，共 10 本，狀況良好。\n部分書頁有小朋友畫過的痕跡，介意者請考慮。',
      image_url: '/images/seed/books.svg', status: 'taken',
      created_at: iso(-140 * 3600_000), updated_at: iso(-120 * 3600_000), reservation_id: null
    }
  ];

  const reservations = [
    bikeRsv,
    {
      id: 'rsv_seed_books', item_id: 'itm_seed_books', customer_name: '張生', phone: '98765432',
      pickup_time: iso(-121 * 3600_000), status: 'completed',
      created_at: iso(-145 * 3600_000), updated_at: iso(-120 * 3600_000)
    },
    {
      id: 'rsv_seed_microwave', item_id: 'itm_seed_microwave', customer_name: '李太', phone: '63332211',
      pickup_time: iso(-30 * 3600_000), status: 'cancelled',
      created_at: iso(-80 * 3600_000), updated_at: iso(-75 * 3600_000)
    }
  ];

  const actions = [
    { id: 'act_seed_1', item_id: 'itm_seed_bike', admin_id: 'system', action: 'reserve', notes: '陳小姐 預約', created_at: iso(-2 * 3600_000) },
    { id: 'act_seed_2', item_id: 'itm_seed_books', admin_id: 'system', action: 'take', notes: '完成取件（預約核銷）', created_at: iso(-120 * 3600_000) },
    { id: 'act_seed_3', item_id: 'itm_seed_microwave', admin_id: 'system', action: 'release', notes: '預約取消，物品重新開放', created_at: iso(-75 * 3600_000) }
  ];

  return { settings: { ...DEFAULT_SETTINGS }, items, reservations, actions };
}

function emptyData() {
  return { settings: { ...DEFAULT_SETTINGS }, items: [], reservations: [], actions: [] };
}

/**
 * Tiny JSON-file store. Loads `db.json` (creating + seeding it on first run)
 * and persists atomically (temp file + rename) after each mutation.
 */
export class JsonStore {
  constructor(filePath) {
    this.file = filePath;
    this.data = this.#load();
    this._pendingSave = null;
  }

  #load() {
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const base = emptyData();
        return {
          settings: { ...base.settings, ...(raw.settings || {}) },
          items: Array.isArray(raw.items) ? raw.items : [],
          reservations: Array.isArray(raw.reservations) ? raw.reservations : [],
          actions: Array.isArray(raw.actions) ? raw.actions : []
        };
      } catch (err) {
        console.error(`[store] 無法讀取 ${this.file}，將以空資料啟動：`, err.message);
        return emptyData();
      }
    }
    const seeded = seedData();
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.#writeSync(seeded);
    } catch (err) {
      console.error(`[store] 無法寫入種子資料 ${this.file}：`, err.message);
    }
    return seeded;
  }

  #writeSync(data) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** Debounced save — call after any mutation. Safe to call many times. */
  save() {
    if (this._pendingSave) return;
    this._pendingSave = setTimeout(() => {
      this._pendingSave = null;
      try {
        this.#writeSync(this.data);
      } catch (err) {
        console.error('[store] 儲存失敗：', err.message);
      }
    }, 50);
  }

  /** Flush pending writes (used before tests read the file / graceful exit). */
  flushSync() {
    if (this._pendingSave) {
      clearTimeout(this._pendingSave);
      this._pendingSave = null;
    }
    this.#writeSync(this.data);
  }
}
