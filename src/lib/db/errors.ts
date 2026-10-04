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

/** Strips a connection string / password out of a driver message before it reaches a log or browser. */
export function scrubConnection(message: string, secret?: string): string {
  let result = message;
  if (secret && secret.length > 2) result = result.split(secret).join('<password>');
  result = result
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '<connection string>')
    .replace(/mysql:\/\/[^\s"'`]+/gi, '<connection string>');
  if (/password authentication failed/i.test(result)) {
    return 'The database rejected that password. Check the password belongs to this database user, not an account or API key.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(result)) {
    return `The database host could not be resolved: ${result}`;
  }
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(result)) {
    return `The database refused the connection: ${result}`;
  }
  return result;
}
