// Cloudflare Pages Function: forwards every /api/* request to the platform API, so the
// browser only ever talks to this app's own address and the sign-in cookie stays first-party
// (no custom domain needed).
//
// It is also the only thing the API believes about who is calling. It passes on the
// visitor's address as Cloudflare saw it (`cf-connecting-ip`, which a visitor cannot set),
// with a secret shared with the API, and drops any x-acadlas-* header the visitor sent.
// The API refuses requests without the secret. See platform/src/lib/client-ip.ts.
//
// Set both in the Pages project's environment variables:
//   API_ORIGIN           e.g. https://acadlas-api.onrender.com
//   PROXY_SHARED_SECRET  the same value as the API's PROXY_SHARED_SECRET
interface Env {
  API_ORIGIN: string;
  PROXY_SHARED_SECRET: string;
}

function notConfigured(what: string): Response {
  return new Response(JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: `${what} is not set.` } }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.API_ORIGIN) return notConfigured('API_ORIGIN');
  if (!env.PROXY_SHARED_SECRET) return notConfigured('PROXY_SHARED_SECRET');

  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);

  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith('x-acadlas-')) headers.delete(name);
  headers.set('x-acadlas-proxy-key', env.PROXY_SHARED_SECRET);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-acadlas-forwarded-ip', ip);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });
};
