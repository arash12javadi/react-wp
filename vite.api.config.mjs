import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Builds the universal Hono API (`src/server/**` + `src/lib/**`) into one self-contained ES module.
 *
 * The Supabase schema is inlined too (`__RWP_SCHEMA_SQL__`): a serverless function has a read-only
 * filesystem, so the install route reads the DDL from the bundle rather than from `supabase/schema.sql`
 * on disk. Reading it at runtime is what answered the Setup Wizard with
 * `Database setup failed: __dirname is not defined`.
 *
 * Why this exists instead of deploying the TypeScript entry directly: Vercel's Node builder
 * transpiles the API's TypeScript one file at a time and leaves every relative specifier exactly as
 * it was written. With `"type": "module"` the function then runs under Node's native ESM resolver,
 * which has no extension guessing, so `../src/server/adapters/vercel` — and every specifier inside
 * the transpiled `src/**` graph (`import { x } from '../runtime'`) — failed with
 * `ERR_MODULE_NOT_FOUND` and surfaced as `FUNCTION_INVOCATION_FAILED`. The file-system functions in
 * `api/` avoid this because they import hand-written `.mjs` helpers (`../server/plugins.mjs`).
 *
 * Bundling here keeps that same guarantee for the Hono app: one file, no relative imports at all,
 * so `@vercel/nft` only has to trace this file plus the bare `node_modules` imports it keeps
 * external. `npm run build` runs it as its last step (`npm run build:api`), so the file is always
 * there before Vercel's Node builder traces `api/index.ts`. Output is git-ignored and rebuilt on
 * every deploy.
 */
/**
 * True for specifiers that are not this app's own code: `node:*` built-ins and installed packages.
 *
 * Vite resolves relative imports to absolute paths (on Windows, `C:/...`) before asking whether a
 * module is external, so `!id.startsWith('.')` alone would externalise the whole Hono app and emit a
 * few-hundred-byte stub instead of a bundle.
 */
const isBareSpecifier = (id) =>
  !id.startsWith('.') &&
  !id.startsWith('/') &&
  !id.startsWith('\\') &&
  !id.startsWith('\0') &&
  !/^[a-zA-Z]:[\\/]/.test(id)

/**
 * `supabase/schema.sql` as text, read once so no deployed function ever has to find it.
 *
 * Read from the project root (this config's own URL), not `process.cwd()`, so the build works the
 * same however Vercel invokes it.
 */
const supabaseSchema = readFileSync(fileURLToPath(new URL('supabase/schema.sql', import.meta.url)), 'utf8')

export default defineConfig({
  /**
   * The Setup Wizard's Step 5 DDL, inlined into the bundle (`__RWP_SCHEMA_SQL__` in
   * `src/server/index.ts`). `supabase/schema.sql` stays the single source of truth — this only
   * removes the runtime file read.
   */
  define: {
    __RWP_SCHEMA_SQL__: JSON.stringify(supabaseSchema),
  },
  // Pure module build: no index.html, no client-side transforms.
  appType: 'custom',
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: true,
    outDir: 'src/server-dist',
    emptyOutDir: true,
    // The function runs on Node 24 (@vercel/node), so nothing has to be down-levelled.
    target: 'esnext',
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    rolldownOptions: {
      input: 'src/server/adapters/vercel.ts',
      // Node built-ins (`node:fs/promises`) and every package — including the optional native
      // drivers the app imports lazily (`pg`, `mysql2`, `better-sqlite3`, `@libsql/client`) — stay
      // external: they are loaded from `node_modules` at runtime and traced by `@vercel/nft`. That
      // also keeps an uninstalled optional dependency from failing the build.
      external: isBareSpecifier,
      output: {
        entryFileNames: 'vercel.mjs',
        format: 'es',
        // One file, so no relative import ever has to be resolved at runtime.
        codeSplitting: false,
      },
    },
  },
})
