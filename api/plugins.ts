import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-expect-error -- shared .mjs helper, also used by server.mjs
import { handlePluginRequest, resolveOrigin } from '../server/plugins.mjs';

/** vercel.json rewrites /api/plugins/<path> here as ?__path=<path>. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Read the stream before touching req.body, which would consume and parse it. The raw
  // bytes are needed to verify Stripe webhook signatures.
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);

  const query = { ...req.query } as Record<string, string>;
  const path = String(query.__path || '');
  delete query.__path;

  const result = await handlePluginRequest({
    method: req.method || 'GET',
    path,
    query,
    headers: req.headers,
    rawBody: Buffer.concat(chunks),
    supabase: {
      url: process.env.VITE_SUPABASE_URL,
      publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    },
    origin: resolveOrigin(req.headers),
  });

  if (result.redirect) {
    res.status(result.status || 302).setHeader('Location', result.redirect).end();
  } else if (result.text !== undefined) {
    Object.entries(result.headers || { 'Content-Type': 'text/plain; charset=utf-8' })
      .forEach(([name, value]) => res.setHeader(name, value as string));
    res.status(result.status).send(result.text);
  } else {
    res.status(result.status).json(result.body ?? {});
  }
}
