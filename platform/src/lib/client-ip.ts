// Who is on the other end of a request — decided once, here, and nowhere else.
//
// Every rate limit (Better Auth's and our own) keys on this address, so it must be one a
// caller cannot choose. A header like X-Forwarded-For is written by whoever sends the
// request, so on its own it proves nothing.
//
// In production the browser never talks to the API directly: it calls the app's own
// address, and a Cloudflare Pages Function (apps/functions/api/[[path]].ts) forwards the
// request. Cloudflare sets `cf-connecting-ip` itself, and the function passes it on as
// `x-acadlas-forwarded-ip` together with a secret only it and the API know. When that
// secret is configured, a request without it is refused outright, so nobody can skip the
// proxy and hand the API an address of their own.
//
// Without the secret (local development, tests that don't set it) the address comes from
// the right-most X-Forwarded-For entry — the one the last proxy appended — or the socket.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/** The one header Better Auth and the rate limiter read the client address from. */
export const CLIENT_IP_HEADER = 'x-acadlas-client-ip';
export const PROXY_KEY_HEADER = 'x-acadlas-proxy-key';
export const PROXY_IP_HEADER = 'x-acadlas-forwarded-ip';

export type ClientIpResult = { ok: true; ip: string | null } | { ok: false };

function sameSecret(given: string, expected: string): boolean {
  // Hashing first gives equal-length inputs, so the comparison takes the same time whatever was sent.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function validIp(value: string | null | undefined): string | null {
  const ip = value?.trim();
  return ip && isIP(ip) ? ip : null;
}

export function resolveClientIp(headers: Headers, proxySecret: string | undefined, socketIp?: string | null): ClientIpResult {
  if (proxySecret) {
    const key = headers.get(PROXY_KEY_HEADER);
    if (!key || !sameSecret(key, proxySecret)) return { ok: false };
    return { ok: true, ip: validIp(headers.get(PROXY_IP_HEADER)) };
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').pop();
    const ip = validIp(last);
    if (ip) return { ok: true, ip };
  }
  return { ok: true, ip: validIp(socketIp) };
}

/**
 * What a rate limit counts against. An IPv4 address is one caller. One IPv6 connection is
 * normally handed a whole /64 — billions of addresses — so counting each one separately
 * would let a single caller step around any limit; the /64 is counted as one.
 */
export function addressBucket(ip: string | null): string {
  if (!ip) return 'unknown';
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // An IPv4-mapped tail ("::ffff:1.2.3.4") is one IPv4 caller.
  const last = right[right.length - 1] ?? left[left.length - 1] ?? '';
  if (last.includes('.')) return last;
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * A copy of `request` carrying only the address we decided on: any x-acadlas-* header the
 * caller sent is dropped, so nothing downstream can be fooled by one.
 */
export function withClientIp(request: Request, ip: string | null): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith('x-acadlas-')) headers.delete(name);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(request, { headers });
}
