/**
 * Error normalisation for every database driver.
 *
 * Supabase/PostgREST returns a plain object (`PostgrestError`), `pg` and `mysql2` throw `Error`s,
 * and `better-sqlite3` throws objects with a `code`. A caller must be able to turn any of those
 * into a single, human-readable message without `instanceof Error` (which misses the plain objects).
 */

/** A structured error carrying an optional SQL state code, mirroring PostgREST's shape. */
export interface DbError extends Error {
  details?: string;
  hint?: string;
  code?: string;
}

/** Turns any driver failure into a single readable string. */
export function describeDbError(error: unknown): string {
  if (error instanceof Error) {
    const record = error as DbError;
    const parts = [record.message, record.details, record.hint].filter(Boolean);
    const message = parts.length ? parts.join(' — ') : record.message;
    return record.code ? `${message} (${record.code})` : message;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const { message, details, hint, code } = record;
    const parts = [message, details, hint].filter((part): part is string => typeof part === 'string');
    if (parts.length) return `${parts.join(' — ')}${typeof code === 'string' ? ` (${code})` : ''}`;
  }
  return 'Unknown database error.';
}

/** True when the failure looks like a missing table or column (schema not yet migrated). */
export function isMissingRelation(error: unknown): boolean {
  const message = describeDbError(error);
  return /schema cache|does not exist|PGRST205|42P01|42703|no such table|Unknown table|ER_NO_SUCH_TABLE|Could not find the/.test(message);
}

/**
 * Removes a known secret (and any embedded connection string) from a message, without rewording it.
 *
 * This is the idempotent half of `scrubConnection`: a handler can call it on a message a driver has
 * already scrubbed without stacking a second friendly prefix onto it.
 */
export function scrubSecrets(message: string, secret?: string): string {
  let result = message;
  if (secret && secret.length > 2) result = result.split(secret).join('<password>');
  return result
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '<connection string>')
    .replace(/mysql:\/\/[^\s"'`]+/gi, '<connection string>');
}

/** Strips a connection string / password out of a driver message, then rewrites it in plain English. */
export function scrubConnection(message: string, secret?: string): string {
  const result = scrubSecrets(message, secret);
  if (/password authentication failed|access denied for user|authentication failed/i.test(result)) {
    return 'The database rejected that password. Check the password belongs to this database user, not an account or API key.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(result)) {
    return `The database host could not be resolved: ${result}`;
  }
  if (/self[- ]signed certificate|certificate verify failed|unable to verify the first certificate/i.test(result)) {
    return `The database presented a TLS certificate that could not be verified: ${result}`;
  }
  if (/SSL connection is required|required SSL|does not support SSL|ssl.*required|wrong version number|tlsv1_alert|sslv3_alert/i.test(result)) {
    return `The database could not complete the SSL/TLS handshake: ${result}`;
  }
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|connection timeout|timeout expired/i.test(result)) {
    return `The database refused or timed out on the connection: ${result}`;
  }
  return result;
}
