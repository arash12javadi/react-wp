import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Resolution order: server-injected config, Vite env vars, then localStorage (dev only). */
export const resolveSupabaseConfig = (): { url: string; key: string } | null => {
  const configWindow = window as Window & { __REACT_WP_CONFIG__?: { supabaseUrl?: string; supabasePublishableKey?: string } | null };
  const serverConfig = configWindow.__REACT_WP_CONFIG__;
  const serverMode = Object.prototype.hasOwnProperty.call(configWindow, '__REACT_WP_CONFIG__');
  const url = serverConfig?.supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL || (serverMode ? null : localStorage.getItem('supabase_url'));
  const key =
    serverConfig?.supabasePublishableKey ||
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
    (serverMode ? null : localStorage.getItem('supabase_key'));
  return url && key ? { url, key } : null;
};

export const getSupabaseClient = (): SupabaseClient => {
  if (client) return client;
  const config = resolveSupabaseConfig();
  if (!config) {
    throw new Error('CMS is not configured.');
  }
  client = createClient(config.url, config.key);
  return client;
};

export const tryGetSupabaseClient = (): SupabaseClient | null => {
  try {
    return getSupabaseClient();
  } catch {
    return null;
  }
};

/**
 * Supabase returns PostgrestError, a plain object rather than an Error, so `instanceof Error`
 * checks miss it and the real reason gets replaced by a generic fallback.
 */
export const describeDbError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const { message, details, hint, code } = error as Record<string, string | undefined>;
    const parts = [message, details, hint].filter(Boolean);
    if (parts.length) return `${parts.join(' — ')}${code ? ` (${code})` : ''}`;
  }
  return 'Unknown database error.';
};

// WordPress-style Options API
export const getOption = async <T = string>(optionName: string, defaultValue: T | null = null): Promise<T | null> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('options')
    .select('option_value')
    .eq('option_name', optionName)
    .single();

  if (error || !data) return defaultValue;
  try {
    return JSON.parse(data.option_value) as T;
  } catch {
    return data.option_value as unknown as T;
  }
};

export const updateOption = async (optionName: string, optionValue: any): Promise<boolean> => {
  const supabase = getSupabaseClient();
  const valueString = typeof optionValue === 'object' ? JSON.stringify(optionValue) : String(optionValue);

  const { error } = await supabase
    .from('options')
    .upsert({ option_name: optionName, option_value: valueString });

  return !error;
};

// Generic DB Abstraction for plugins ($wpdb equivalent)
export const db = {
  select: async (table: string, query: Record<string, any> = {}) => {
    const supabase = getSupabaseClient();
    let builder = supabase.from(table).select('*');
    Object.entries(query).forEach(([k, v]) => { builder = builder.eq(k, v); });
    const { data, error } = await builder;
    if (error) throw error;
    return data;
  },

  insert: async (table: string, payload: Record<string, any>) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from(table).insert(payload).select();
    if (error) throw error;
    return data;
  },

  update: async (table: string, id: string | number, payload: Record<string, any>) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from(table).update(payload).eq('id', id).select();
    if (error) throw error;
    return data;
  },

  delete: async (table: string, id: string | number) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return true;
  }
};