// How things read in an Indian school office: ₹1,25,000 (lakh grouping), 14 Jan 2015,
// "Mon 12 Oct", phone numbers as 98765 43210.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

export function money(paise: number | null | undefined): string {
  const v = paise ?? 0;
  return v % 100 === 0 ? inr.format(v / 100) : inrPaise.format(v / 100);
}

/** ₹4.2L, ₹1.1Cr — for tight spaces like a tile. */
export function moneyShort(paise: number): string {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(r >= 1e8 ? 0 : 1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(r >= 1e6 ? 0 : 1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(r >= 1e4 ? 0 : 1)}k`;
  return inr.format(r);
}

/** "6,500" or "6,500.50" → paise. Returns null if it is not a number. */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function rupeesInput(paise: number | null | undefined): string {
  if (!paise) return '';
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const asDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

export function date(iso: string | null | undefined): string {
  return iso ? dateFmt.format(asDate(iso)) : '—';
}
export function dateShort(iso: string): string {
  return shortFmt.format(asDate(iso));
}
export function dateLong(iso: string): string {
  return longFmt.format(asDate(iso));
}
export function monthName(month: string): string {
  return monthFmt.format(asDate(`${month}-01`));
}

export function timeAgo(iso: string | Date): string {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return dateFmt.format(then);
}

export function phone(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length === 10 ? `${value.slice(0, 5)} ${value.slice(5)}` : value;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function age(dob: string | null | undefined, on: string): string | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = on.split('-').map(Number);
  let years = ty - y;
  if (tm < m || (tm === m && td < d)) years -= 1;
  return `${years} years`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}

/** Local IST date as YYYY-MM-DD. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = asDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A WhatsApp link that opens a chat with this number and the message already typed. */
export function whatsappLink(phone10: string, text: string): string {
  return `https://wa.me/91${phone10}?text=${encodeURIComponent(text)}`;
}

/** A stable small number from a string — gives each school its own contour terrain. */
export function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 100;
}
