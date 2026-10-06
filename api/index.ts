// Vercel serverless entry point for the universal Hono API.
//
// `vercel.json` rewrites unmatched `/api/*` requests here. The dedicated file-system functions
// (`api/install-schema.ts`, `api/plugins.ts`, `api/media-delete.ts`, `api/imagekit-auth.ts`) still
// take precedence, so this only catches the universal routes: `/api/install/*`, `/api/auth/*`,
// `/api/db/query`, `/api/media/*` and `/api/admin/plugins/upload-zip`.
export { default } from '../src/server/adapters/vercel';
