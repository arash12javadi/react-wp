import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

/**
 * Runs the real API server next to the Vite dev server — the fix for
 * "Connection test failed (HTTP 502)" on `npm run dev`.
 *
 * `npm run dev` serves the SPA but nothing owns `/api`, so every one of those requests fell to the
 * dev proxy's target: `server.mjs` on port 3000. With nothing listening there the proxy fails before
 * a request is ever sent, and Vite answers its own target with a bare `502` and an **empty body**
 * (`proxy.on('error')` in Vite's proxyMiddleware). The browser therefore had no reason to report,
 * only a status code, and Step 3 of the Setup Wizard printed `Connection test failed (HTTP 502)` for
 * a Supabase project `npm start` connected to happily. A missing process is not a bad database, so
 * the honest fix is to start the missing process: this plugin boots `server.mjs` when Vite does and
 * stops it when Vite stops.
 *
 * It is deliberately the *same* server `npm start` runs, not a second implementation: the dev server
 * has to exercise the code that ships. `PORT` is shared with the proxy in `vite.config.js`, so a site
 * moved off 3000 moves both. When something already listens on that port — usually `npm start` in
 * another terminal — nothing is spawned and that server is used, so the two commands never fight
 * over the port. `RWP_DEV_API=off` restores the old behaviour for anyone who wants to run the API by
 * hand. Edits to `server.mjs` and `server/*.mjs` are not watched (Vite only reloads the browser
 * bundle), so restart `npm run dev` after changing them — the same as with `npm start`.
 */

/** The port the API server listens on and Vite's `/api` proxy points at. `server.mjs` reads it too. */
export const apiPort = () => Number(process.env.PORT || 3000);

/** True when something already accepts TCP connections on `port`. */
const portIsTaken = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const answer = (taken) => {
    socket.destroy();
    resolve(taken);
  };
  socket.setTimeout(500);
  socket.once('connect', () => answer(true));
  socket.once('timeout', () => answer(false));
  socket.once('error', () => answer(false));
});

/**
 * Line-buffers a child stream so the API server's own output arrives as `[api] …` lines.
 * Without this its startup banner and stack traces are indistinguishable from Vite's, which is how
 * a crashed API server gets read as an unrelated Vite warning.
 */
const relay = (stream, logger, level) => {
  if (!stream) return;
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) logger[level](`[api] ${line.trim()}`, { timestamp: true });
  });
  stream.on('end', () => {
    const rest = buffered.trim();
    buffered = '';
    if (rest) logger[level](`[api] ${rest}`, { timestamp: true });
  });
};

export function devApiServer({ entry = 'server.mjs' } = {}) {
  let child = null;
  // Set before every kill we cause, so a shutdown is not reported as a crash.
  let stopping = false;

  const stop = () => {
    stopping = true;
    const running = child;
    child = null;
    if (running) running.kill();
  };

  return {
    name: 'react-wp-dev-api',
    // Only `vite dev`: a production build must not start a server, and `vite preview` serves the
    // built SPA, where the API belongs to whatever host the site is deployed to.
    apply: 'serve',
    async configureServer(server) {
      // `server` itself has no logger; Vite hangs it off the resolved config.
      const { config } = server;
      const logger = config.logger;
      const port = apiPort();
      const origin = `http://localhost:${port}`;

      if ((process.env.RWP_DEV_API || '').trim().toLowerCase() === 'off') {
        logger.info(`[api] RWP_DEV_API=off: not starting ${entry}, so ${origin} must be running on its own.`);
        return;
      }
      // Whatever is already there is the server someone is using — `npm start` in a second terminal,
      // most of the time. Starting another would only fail to bind and print a stack trace over it.
      if (await portIsTaken(port)) {
        logger.info(`[api] Port ${port} is already answering, so /api is proxied to that server.`);
        return;
      }

      child = spawn(process.execPath, [path.resolve(config.root, entry)], {
        cwd: config.root,
        // Passed rather than defaulted, so the child and the proxy can never disagree about the port.
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      relay(child.stdout, logger, 'info');
      relay(child.stderr, logger, 'error');
      logger.info(`[api] Started ${entry} on ${origin}. Restart to pick up changes to it; RWP_DEV_API=off leaves it to you.`);

      child.once('error', (error) => {
        // Nothing was started, so a following exit is not a second thing to report.
        stopping = true;
        logger.error(`[api] Could not start ${entry}: ${error.message}. Every /api request, the Setup Wizard's connection test included, will fail until the API server runs.`);
      });
      child.once('exit', (code, signal) => {
        child = null;
        if (stopping) return;
        logger.warn(
          `[api] ${entry} stopped (${signal || `exit code ${code}`}), so /api requests now fail with an empty HTTP 502 from the dev proxy.`
          + ' Fix what it printed above — a port already in use, a bad .env.local — and restart, or run "npm start".',
        );
      });

      // Ctrl+C, a fatal Vite error and a closed terminal all land here, so the API server never
      // outlives the dev server that started it (an orphan would hold the port for the next run).
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
    },
  };
}
