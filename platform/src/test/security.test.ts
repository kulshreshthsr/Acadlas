// The API's outer defences, tested the way someone trying to get past them would.
// Run with: npm test
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { CLIENT_IP_HEADER, PROXY_IP_HEADER, PROXY_KEY_HEADER, addressBucket, resolveClientIp } from '../lib/client-ip';
import { RateLimiter } from '../lib/rate-limit';
import { Client, ORIGIN, PROXY_SECRET, ownerWithSchool, startTestApp } from './harness';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let A: Awaited<ReturnType<typeof ownerWithSchool>>;

before(async () => {
  ctx = await startTestApp();
  A = await ownerWithSchool(ctx.app, 'sec');
});

/** A request with exactly the headers given — nothing added by the test client. */
function raw(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return ctx.app.request(`http://localhost:8787${path}`, init);
}

const viaProxy = (ip: string) => ({ [PROXY_KEY_HEADER]: PROXY_SECRET, [PROXY_IP_HEADER]: ip });

describe('only the app’s own proxy can reach the API', () => {
  test('a request without the proxy secret is refused', async () => {
    const res = await raw('/api/invitations/anything', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.equal(res.status, 403);
  });

  test('a request with a wrong secret is refused, even one that differs only at the end', async () => {
    const wrong = PROXY_SECRET.slice(0, -1) + 'x';
    const res = await raw('/api/invitations/anything', { headers: { [PROXY_KEY_HEADER]: wrong, [PROXY_IP_HEADER]: '1.2.3.4' } });
    assert.equal(res.status, 403);
  });

  test('sign-in is refused too, so the proxy cannot be skipped to dodge its limits', async () => {
    const res = await raw('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner-sec@example.com', password: 'password-12345' }),
    });
    assert.equal(res.status, 403);
  });

  test('the health check stays open for the host', async () => {
    assert.equal((await raw('/health')).status, 200);
  });
});

describe('the caller’s address cannot be chosen by the caller', () => {
  test('without a proxy, only the right-most forwarded address counts', () => {
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    assert.deepEqual(resolveClientIp(headers, undefined), { ok: true, ip: '203.0.113.9' });
  });

  test('garbage in the address header is not used as an address', () => {
    const headers = new Headers({ [PROXY_KEY_HEADER]: PROXY_SECRET, [PROXY_IP_HEADER]: 'not-an-ip' });
    assert.deepEqual(resolveClientIp(headers, PROXY_SECRET), { ok: true, ip: null });
  });

  test('sending our internal address header does not escape the sign-in limit', async () => {
    const statuses: number[] = [];
    // The per-address sign-in limit is 20 a minute.
    for (let i = 0; i < 22; i++) {
      const res = await raw('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          ...viaProxy('198.51.100.7'),
          // An attacker rotating the header Better Auth reads, hoping for a fresh bucket each time.
          [CLIENT_IP_HEADER]: `192.0.2.${i + 1}`,
        },
        // A different account each time, so only the per-address limit can stop it.
        body: JSON.stringify({ email: `nobody-${i}@example.com`, password: 'wrong-password-1' }),
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(401));
    assert.deepEqual(statuses.slice(20), [429, 429]);
  });

  test('one IPv6 connection rotating through its own /64 counts as one caller', () => {
    assert.equal(addressBucket('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64');
    assert.equal(addressBucket('2001:0db8:00aa:00bb:ffff:ffff:ffff:ffff'), '2001:db8:aa:bb::/64');
    assert.equal(addressBucket('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(addressBucket('::ffff:203.0.113.9'), '203.0.113.9');
    assert.equal(addressBucket('203.0.113.9'), '203.0.113.9');
    assert.notEqual(addressBucket('2001:db8:aa:bb::1'), addressBucket('2001:db8:aa:bc::1'));
  });

  test('a different real address gets its own allowance', async () => {
    const res = await raw('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...viaProxy('198.51.100.8') },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-1' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('guessing one account’s password', () => {
  test('is paused after 50 wrong passwords, even spread over many addresses', async () => {
    const victim = new Client(ctx.app);
    await victim.signUp('Victim', 'victim@example.com');

    const attacker = new Client(ctx.app);
    for (let i = 0; i < 50; i++) {
      attacker.ip = `172.16.${Math.floor(i / 200)}.${(i % 200) + 1}`;
      const res = await attacker.post('/api/auth/sign-in/email', { email: 'victim@example.com', password: `guess-${i}-xxxx` });
      assert.equal(res.status, 401, `attempt ${i + 1}`);
    }

    // Even the right password, from yet another address, now waits.
    attacker.ip = '172.16.9.9';
    const blocked = await attacker.post('/api/auth/sign-in/email', { email: 'VICTIM@example.com ', password: 'password-12345' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });

  test('the pause looks the same for an account that does not exist', async () => {
    const attacker = new Client(ctx.app);
    for (let i = 0; i < 50; i++) {
      attacker.ip = `172.17.${Math.floor(i / 200)}.${(i % 200) + 1}`;
      await attacker.post('/api/auth/sign-in/email', { email: 'ghost@example.com', password: `guess-${i}-xxxx` });
    }
    attacker.ip = '172.17.9.9';
    const res = await attacker.post('/api/auth/sign-in/email', { email: 'ghost@example.com', password: 'anything-at-all' });
    assert.equal(res.status, 429);
  });

  test('an absurdly long "email" is not remembered, so it cannot be used to fill the server’s memory', async () => {
    const attacker = new Client(ctx.app);
    const huge = `${'a'.repeat(200 * 1024)}@example.com`;
    const res = await attacker.post('/api/auth/sign-in/email', { email: huge, password: 'whatever-123' });
    assert.notEqual(res.status, 500);
    assert.notEqual(res.status, 200);
  });

  test('a refusal is readable by the app: JSON, with a Retry-After header', async () => {
    // victim@example.com is paused by the test above.
    const res = await ctx.app.request('http://localhost:8787/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...viaProxy('172.16.9.10') },
      body: JSON.stringify({ email: 'victim@example.com', password: 'password-12345' }),
    });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'RATE_LIMITED');
  });

  test('other accounts are not affected', async () => {
    const someone = new Client(ctx.app);
    await someone.signUp('Someone', 'someone@example.com');
    const fresh = new Client(ctx.app);
    const res = await fresh.post('/api/auth/sign-in/email', { email: 'someone@example.com', password: 'password-12345' });
    assert.equal(res.status, 200);
  });
});

describe('writes must come from the app', () => {
  // Each uses the owner's real, signed-in session: what a hostile page would ride on.
  const holidays = (date: string) => ({ holidays: [{ date, name: 'Independence Day' }] });

  test('a signed-in change sent from another website is refused', async () => {
    const res = await A.owner.request('POST', '/api/school/holidays', holidays('2026-08-15'), { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });

  test('a look-alike address is not mistaken for ours', async () => {
    const res = await A.owner.request('POST', '/api/school/holidays', holidays('2026-08-15'), { Origin: `${ORIGIN}.evil.example` });
    assert.equal(res.status, 403);
  });

  test('a signed-in change with no Origin at all is refused', async () => {
    const res = await A.owner.request('POST', '/api/school/holidays', holidays('2026-08-15'), { Origin: undefined });
    assert.equal(res.status, 403);
  });

  test('reading still works without an Origin, as a plain page load would', async () => {
    const res = await A.owner.request('GET', '/api/school/holidays', undefined, { Origin: undefined });
    assert.equal(res.status, 200);
  });

  test('the same change from the app goes through', async () => {
    const res = await A.owner.post('/api/school/holidays', holidays('2026-08-15'));
    assert.ok(res.status === 200 || res.status === 201, `status ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

describe('oversized requests', () => {
  test('a huge body is refused before it is read', async () => {
    const res = await A.owner.post('/api/school/holidays', { holidays: [{ date: '2026-08-16', name: 'x'.repeat(300 * 1024) }] });
    assert.equal(res.status, 413);
  });
});

describe('creating schools and looking up invitations', () => {
  test('one address cannot create schools without end', async () => {
    const spammer = new Client(ctx.app);
    await spammer.signUp('Spammer', 'spammer@example.com');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await spammer.post('/api/auth/organization/create', { name: `Spam ${i}`, slug: `spam-school-${i}` });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.ok(statuses.slice(5).every((s) => s === 429), statuses.join(', '));
  });

  test('invitation lookups are limited per address', async () => {
    const prober = new Client(ctx.app);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await prober.get(`/api/invitations/guess-${i}`)).status;
    assert.equal(last, 429);
  });
});

describe('the rate limiter itself', () => {
  test('a window resets after it ends', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    assert.equal(limiter.hit('k', 2, 1000).ok, true);
    assert.equal(limiter.hit('k', 2, 1000).ok, true);
    assert.equal(limiter.hit('k', 2, 1000).ok, false);
    now = 1000;
    assert.equal(limiter.hit('k', 2, 1000).ok, true);
  });

  test('checking whether a key is blocked does not count against it', () => {
    const limiter = new RateLimiter(() => 0);
    for (let i = 0; i < 10; i++) assert.equal(limiter.blocked('k', 1).blocked, false);
    limiter.record('k', 1000);
    assert.equal(limiter.blocked('k', 1).blocked, true);
  });
});
