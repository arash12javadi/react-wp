import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const getSupabaseClient = (): SupabaseClient => {
  const serverConfig = (window as Window & { __REACT_WP_CONFIG__?: { supabaseUrl?: string; supabasePublishableKey?: string } }).__REACT_WP_CONFIG__;
  const url = serverConfig?.supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL || localStorage.getItem('supabase_url');
  const key =
    serverConfig?.supabasePublishableKey ||
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
    localStorage.getItem('supabase_key');

  if (!url || !key) {
    throw new Error('CMS is not configured.');
  }

  return createClient(url, key);
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