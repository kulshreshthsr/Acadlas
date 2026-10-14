// Cloudflare Pages Function: forwards every /api/* request to the platform API, so the
// browser only ever talks to this app's own address and the sign-in cookie stays first-party
// (no custom domain needed). Set API_ORIGIN, e.g. https://acadlas-api.onrender.com.
interface Env {
  API_ORIGIN: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.API_ORIGIN) {
    return new Response(JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'API_ORIGIN is not set.' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);
  return fetch(new Request(target, request), { redirect: 'manual' });
};
