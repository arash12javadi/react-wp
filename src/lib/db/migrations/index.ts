/**
 * Schema migration runner.
 *
 * Runs the idempotent, dialect-appropriate core schema against a connected adapter. The Supabase
 * backend is skipped here: it keeps provisioning through `supabase/schema.sql` (which carries the
 * RLS policies, triggers and RPCs PostgREST depends on) via the Setup Wizard's direct connection.
 */
import type { DBAdapter } from '../DBAdapter';
import { schemaFor } from './schemas';

/** Applies the core schema to the adapter's backend. Safe to call on an already-provisioned DB. */
export async function runCoreMigrations(adapter: DBAdapter): Promise<void> {
  const schema = schemaFor(adapter.type);
  if (!schema) return;
  await adapter.migrate(schema);
}
