import { getPublicSettings } from './api.js';
import { $, $$, toast, registerSW, socialLinksHtml, escapeHtml } from './common.js';

registerSW();

let settings = {};

async function init() {
  settings = await getPublicSettings().catch(() => ({}));
  const metaEls = $$('[data-meta]');
  const parts = [settings.address, settings.hours, settings.contact_phone ? `☎ ${settings.contact_phone}` : ''].filter(Boolean);
  if (parts.length) metaEls.forEach((el) => { el.textContent = parts.join(' · '); });

  const note = $('#pay-note');
  if (settings.payment_note) note.textContent = settings.payment_note;

  if (!settings.payment_url) {
    $('#go').hidden = true;
    $('#no-link').hidden = false;
  } else {
    wireAmounts();
    $('#go').addEventListener('click', go);
  }

  const socialSheet = $('#social-sheet');
  const links = [settings.instagram_url, settings.facebook_url].filter(Boolean);
  if (links.length) {
    socialSheet.hidden = false;
    $('#social-btns').innerHTML = socialLinksHtml(settings, { cls: 'social-btns' });
    $('#foot-social').innerHTML = socialLinksHtml(settings);
  }
}

function amount() {
  const custom = $('#custom');
  if (custom.checked) {
    const v = Number($('#custom-amt').value);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : NaN;
  }
  const sel = $('.amount.fixed.active');
  return sel ? Number(sel.dataset.amount) : NaN;
}

function wireAmounts() {
  $$('.amount.fixed').forEach((a) => {
    a.addEventListener('click', () => {
      $('#custom').checked = false;
      $$('.amount.fixed').forEach((x) => x.classList.toggle('active', x === a));
      renderGo();
    });
  });
  const custom = $('#custom');
  custom.addEventListener('change', () => {
    if (custom.checked) $$('.amount.fixed').forEach((x) => x.classList.remove('active'));
    renderGo();
  });
  $('#custom-amt').addEventListener('input', () => {
    custom.checked = true;
    $$('.amount.fixed').forEach((x) => x.classList.remove('active'));
    renderGo();
  });
}

function renderGo() {
  const a = amount();
  const btn = $('#go');
  if (!Number.isFinite(a) || a <= 0) {
    btn.textContent = '選擇捐款金額';
    btn.classList.add('disabled-link');
    return;
  }
  btn.textContent = `捐款 HK$${a.toLocaleString()}`;
  btn.classList.remove('disabled-link');
}

function go() {
  const a = amount();
  if (!Number.isFinite(a) || a <= 0) return toast('請先選擇捐款金額。', { error: true });
  const url = new URL(settings.payment_url);
  const sep = url.search ? '&' : '?';
  location.href = `${url.href}${sep}amount=${encodeURIComponent(String(a))}&source=easoug-web`;
}

init();
