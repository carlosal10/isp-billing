const DEFAULT_CURRENCY = process.env.SMS_DEFAULT_CURRENCY || process.env.DEFAULT_CURRENCY || 'KES';
const FALLBACK_PAYBILL =
  process.env.MPESA_SHORTCODE ||
  process.env.MPESA_TILL ||
  process.env.PAYBILL_SHORTCODE ||
  '';

function renderTemplate(template, variables) {
  let result = String(template || '');
  const entries = Object.entries(variables || {});
  for (const [key, rawValue] of entries) {
    const value = rawValue == null ? '' : String(rawValue);
    const variants = buildTokenVariants(key);
    for (const variant of variants) {
      const curly = new RegExp(`\\{\\{\\s*${escapeRegExp(variant)}\\s*\\}}`, 'gi');
      const singleCurly = new RegExp(`\\{\\s*${escapeRegExp(variant)}\\s*\\}`, 'gi');
      const square = new RegExp(`\\[\\s*${escapeRegExp(variant)}\\s*\\]`, 'gi');
      result = result.replace(curly, value);
      result = result.replace(singleCurly, value);
      result = result.replace(square, value);
    }
  }
  return result;
}

function buildTemplateVariables({
  customer,
  plan,
  expiryDate,
  paymentLink,
  currency,
  paybillShortcode,
  tillNumber,
} = {}) {
  const effectiveCurrency = currency || plan?.currency || DEFAULT_CURRENCY;
  const name = customer?.name || 'Customer';
  const phone = customer?.phone || '';
  const account = customer?.accountNumber || customer?.account || customer?.username || '';

  const planName = plan?.name || plan?.planName || '';
  const priceNumber = typeof plan?.price === 'number' ? plan.price : Number(plan?.price);
  const amount = Number.isFinite(priceNumber) ? priceNumber : null;
  const amountFormatted = formatCurrency(amount, effectiveCurrency);

  const speedNumber = typeof plan?.speed === 'number' ? plan.speed : Number(plan?.speed);
  const speed = Number.isFinite(speedNumber) ? `${trimTrailingZeros(speedNumber)} Mbps` : (plan?.rateLimit || '');

  const durationText = plan?.duration || normalizeDurationText(plan?.durationDays);
  const durationDays = determineDurationDays(plan);

  const expiryIso = expiryDate ? formatDateISO(expiryDate) : '';
  const paymentUrl = paymentLink || '';

  const resolvedPaybill =
    typeof paybillShortcode === 'string' && paybillShortcode.trim()
      ? paybillShortcode.trim()
      : typeof tillNumber === 'string' && tillNumber.trim()
      ? tillNumber.trim()
      : FALLBACK_PAYBILL;

  const summaryParts = [planName, amountFormatted, speed, durationText].filter(Boolean);
  const planSummary = summaryParts.join(' • ');

  return {
    name,
    customer_name: name,
    customer_full_name: name,
    customer_phone: phone,
    customer_account: account,
    account,
    account_number: account,
    customer_account_number: account,
    accountNumber: account,
    account_reference: account,
    account_reference_number: account,
    plan: planName,
    plan_name: planName,
    planName,
    plan_title: planName,
    plan_summary: planSummary,
    plan_price: amountFormatted,
    amount: amount != null ? String(amount) : '',
    amount_formatted: amountFormatted,
    price: amountFormatted,
    plan_price_value: amount != null ? String(amount) : '',
    plan_currency: effectiveCurrency,
    currency: effectiveCurrency,
    plan_speed: speed,
    speed,
    plan_speed_value: Number.isFinite(speedNumber) ? String(trimTrailingZeros(speedNumber)) : '',
    plan_duration: durationText,
    duration: durationText,
    plan_duration_days: durationDays != null ? String(durationDays) : '',
    duration_days: durationDays != null ? String(durationDays) : '',
    expiry: expiryIso,
    expiry_date: expiryIso,
    expiryDate: expiryIso,
    payment_link: paymentUrl,
    paylink: paymentUrl,
    link: paymentUrl,
    payment_url: paymentUrl,
    paybill: resolvedPaybill,
    paybill_number: resolvedPaybill,
    paybill_shortcode: resolvedPaybill,
    paybill_short_code: resolvedPaybill,
    paybill_shortCode: resolvedPaybill,
    mpesa_paybill: resolvedPaybill,
    paybill_short: resolvedPaybill,
    till_number: tillNumber || '',
    till: tillNumber || '',
    lipa_na_mpesa: resolvedPaybill,
  };
}

function buildTokenVariants(key) {
  const raw = String(key || '').trim();
  if (!raw) return [''];
  const spaced = raw.replace(/[_-]+/g, ' ').trim();
  const lowerSpaced = spaced.toLowerCase();
  const titleSpaced = toTitleCase(spaced);
  const compact = spaced.replace(/\s+/g, '');
  const camel = toCamelCase(spaced);
  const pascal = camel ? camel[0].toUpperCase() + camel.slice(1) : '';
  const variants = new Set([
    raw,
    spaced,
    titleSpaced,
    lowerSpaced,
    spaced.toUpperCase(),
    compact,
    compact.toLowerCase(),
    compact.toUpperCase(),
    camel,
    pascal,
  ].filter(Boolean));
  return Array.from(variants);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTitleCase(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toCamelCase(input) {
  const str = String(input || '').toLowerCase();
  return str
    .split(/\s+/)
    .map((word, idx) => (idx === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

function formatCurrency(amount, currency) {
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency || DEFAULT_CURRENCY,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    const rounded = Number.isInteger(amount) ? amount : amount.toFixed(2);
    return `${currency || DEFAULT_CURRENCY} ${rounded}`;
  }
}

function trimTrailingZeros(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  if (Number.isInteger(num)) return num;
  return parseFloat(num.toFixed(2));
}

function normalizeDurationText(durationDays) {
  if (!Number.isFinite(durationDays)) return '';
  if (durationDays === 0) return '';
  if (durationDays % 30 === 0 && durationDays >= 30) {
    const months = durationDays / 30;
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  if (durationDays % 7 === 0 && durationDays >= 7) {
    const weeks = durationDays / 7;
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  return `${durationDays} day${durationDays === 1 ? '' : 's'}`;
}

function determineDurationDays(plan) {
  if (!plan) return null;
  if (Number.isFinite(plan.durationDays)) return Number(plan.durationDays);
  if (plan.duration != null) {
    const parsed = parseDurationToDays(plan.duration);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDateISO(date) {
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return '';
  }
}

function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[3];
    if (u === 'day') return n;
    if (u === 'week') return n * 7;
    if (u === 'month') return n * 30;
    if (u === 'year') return n * 365;
  }
  if (s === 'monthly' || s === 'month') return 30;
  if (s === 'weekly' || s === 'week') return 7;
  if (s === 'yearly' || s === 'annual' || s === 'year') return 365;
  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : NaN;
}

module.exports = {
  renderTemplate,
  formatDateISO,
  buildTemplateVariables,
  parseDurationToDays,
};
