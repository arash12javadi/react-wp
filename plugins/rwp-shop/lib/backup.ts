import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import manifest from '../manifest.json';

/**
 * A shop backup is a ZIP holding shop-backup.json (the chosen sections' tables, from
 * shop_backup_export), optional spreadsheet copies of every table and, when Reports was chosen, the
 * sales report as spreadsheets. Import reads only shop-backup.json and hands it to
 * shop_backup_import, which writes everything in one transaction (see the SQL for the modes).
 */

export type DataSection = 'orders' | 'products' | 'customers' | 'coupons' | 'reviews' | 'offers'
  | 'questions' | 'alerts' | 'bundles' | 'settings';
export type BackupSection = DataSection | 'reports';
export type ImportMode = 'update' | 'skip' | 'replace' | 'duplicate';

export interface SectionInfo {
  id: BackupSection;
  label: string;
  icon: string;
  description: string;
  /** How an item of this section already on the site is recognised on import. */
  matchedBy?: string;
  /** Kept in the order of public.shop_backup_tables(); the first one is what the section counts. */
  tables: string[];
}

export const backupSections: SectionInfo[] = [
  {
    id: 'orders', label: 'Orders', icon: '🧾',
    description: 'Orders with their items, notes and refunds.',
    matchedBy: 'order key (never the order number: #12 on another site is another order)',
    tables: ['shop_orders', 'shop_order_items', 'shop_order_notes', 'shop_refunds'],
  },
  {
    id: 'products', label: 'Products', icon: '📦',
    description: 'Products, variations, downloadable files, categories, tags, attributes and shipping classes.',
    matchedBy: 'id, then slug, then SKU; categories, tags and attributes by slug; variations by their options',
    tables: ['shop_products', 'shop_categories', 'shop_tags', 'shop_attributes', 'shop_attribute_terms', 'shop_shipping_classes',
      'shop_product_categories', 'shop_product_tags', 'shop_variations', 'shop_product_downloads'],
  },
  {
    id: 'reports', label: 'Reports', icon: '📈',
    description: 'Sales totals, sales by day, top sellers, top coupons and low stock, as spreadsheets. Reports are calculated from orders, so importing the orders brings them back.',
    tables: [],
  },
  {
    id: 'customers', label: 'Customers', icon: '🧑‍🤝‍🧑',
    description: 'Saved billing and shipping addresses and carts of customer accounts.',
    matchedBy: 'the account, found by email',
    tables: ['shop_customers'],
  },
  {
    id: 'coupons', label: 'Coupons', icon: '🎟️',
    description: 'Coupon codes with their rules and usage counts, including the coupons of accepted offers.',
    matchedBy: 'id, then code',
    tables: ['shop_coupons'],
  },
  {
    id: 'reviews', label: 'Reviews', icon: '⭐',
    description: 'Product reviews and their moderation status. Ratings are recalculated after an import.',
    matchedBy: 'product and author',
    tables: ['shop_reviews'],
  },
  {
    id: 'offers', label: 'Offers', icon: '🤝',
    description: 'Make an Offer negotiations: offers, counter-offers and answers.',
    matchedBy: 'id, then product, customer and date (one open offer per customer and product)',
    tables: ['shop_product_offers'],
  },
  {
    id: 'questions', label: 'Questions', icon: '❓',
    description: 'Product questions and their answers.',
    matchedBy: 'id, then product, asker and date',
    tables: ['shop_product_qa'],
  },
  {
    id: 'alerts', label: 'Price alerts', icon: '🔔',
    description: 'Price-drop alert subscriptions and whether they were sent.',
    matchedBy: 'product and customer',
    tables: ['shop_price_drop_alerts'],
  },
  {
    id: 'bundles', label: 'Bundles', icon: '🧺',
    description: 'Frequently bought together pairs and their discounts.',
    matchedBy: 'main and suggested product',
    tables: ['shop_product_bundles'],
  },
  {
    id: 'settings', label: 'Settings', icon: '⚙️',
    description: 'Store settings (currency, checkout, payments, emails, stock, reviews…), tax rates, shipping zones, methods and classes. Payment gateway secret keys live on the server and are never in a backup.',
    matchedBy: 'setting name; tax rates by location, class and name; zones by name; methods by zone, type and title',
    tables: ['options', 'shop_shipping_classes', 'shop_tax_rates', 'shop_shipping_zones', 'shop_shipping_methods'],
  },
];

export const dataSections = backupSections.filter((section) => section.id !== 'reports').map((section) => section.id as DataSection);

export const sectionInfo = (id: BackupSection) => backupSections.find((section) => section.id === id)!;

/** Same wording as public.shop_backup_label(). */
export const tableLabels: Record<string, string> = {
  options: 'Shop settings',
  shop_categories: 'Product categories',
  shop_tags: 'Product tags',
  shop_attributes: 'Product attributes',
  shop_attribute_terms: 'Attribute terms',
  shop_shipping_classes: 'Shipping classes',
  shop_products: 'Products',
  shop_product_categories: 'Product category links',
  shop_product_tags: 'Product tag links',
  shop_variations: 'Product variations',
  shop_product_downloads: 'Downloadable files',
  shop_customers: 'Customer addresses',
  shop_coupons: 'Coupons',
  shop_tax_rates: 'Tax rates',
  shop_shipping_zones: 'Shipping zones',
  shop_shipping_methods: 'Shipping methods',
  shop_orders: 'Orders',
  shop_order_items: 'Order items',
  shop_order_notes: 'Order notes',
  shop_refunds: 'Refunds',
  shop_reviews: 'Reviews',
  shop_product_qa: 'Questions',
  shop_product_offers: 'Offers',
  shop_price_drop_alerts: 'Price alerts',
  shop_product_bundles: 'Bundles',
};

export const importModes: Array<{ id: ImportMode; label: string; description: string }> = [
  { id: 'update', label: 'Update & add', description: 'Items that already exist are overwritten with the backup; the rest are added. Nothing is deleted.' },
  { id: 'skip', label: 'Add missing only', description: 'Items that already exist are left exactly as they are; only the ones this shop does not have are added.' },
  { id: 'replace', label: 'Replace', description: 'Makes this part of the shop match the backup: existing items are overwritten, missing ones added, and items that are not in the backup are deleted.' },
  { id: 'duplicate', label: 'Add as copies', description: 'Every item is added as a new one, even if it already exists. A slug or coupon code that is taken gets a -2 suffix and a taken SKU is left empty.' },
];

/** Modes a section offers: copies only make sense for products and coupons. */
export const modesFor = (section: DataSection) =>
  importModes.filter((mode) => mode.id !== 'duplicate' || section === 'products' || section === 'coupons');

export interface BackupUser {
  id: string;
  email: string | null;
  display_name?: string | null;
}

export interface ShopReport {
  orders: number;
  gross_sales: number;
  net_sales: number;
  refunds: number;
  tax: number;
  shipping: number;
  discounts: number;
  items_sold: number;
  average_order: number;
  by_status: Record<string, number>;
  daily: Array<{ date: string; orders: number; sales: number }>;
  top_products: Array<{ product_id: string | null; name: string; quantity: number; sales: number }>;
  top_coupons: Array<{ code: string; uses: number; discount: number }>;
  low_stock: Array<{ id: string; name: string; stock_quantity: number }>;
}

export interface ShopBackup {
  format: 'rwp-shop-backup';
  version: number;
  created_at: string;
  site?: { title?: string; origin?: string; plugin_version?: string };
  sections: DataSection[];
  options?: Record<string, unknown>;
  tables: Record<string, Array<Record<string, unknown>>>;
  /** Without the products section: each product's id, slug and SKU (and categories, variations, files), so rows that point at them find the same ones on another site. Never imported. */
  references?: Record<string, Array<Record<string, unknown>>>;
  users: BackupUser[];
  /** Informational only: reports are recalculated from orders, never imported. */
  reports?: ShopReport & { from: string; to: string };
}

export interface LoadedShopBackup {
  fileName: string;
  data: ShopBackup;
  /** 'site' when the shop part was taken out of a full site backup (Settings → Backup). */
  source: 'shop' | 'site';
}

export interface TableCounts {
  inserted: number;
  updated: number;
  skipped: number;
  dropped: number;
  deleted: number;
}

export interface ImportReport {
  dry_run: boolean;
  modes: Partial<Record<DataSection, ImportMode>>;
  counts: Record<string, TableCounts>;
  warnings: string[];
  users_matched: number;
  users_unmatched: number;
}

export interface ExportChoices {
  sections: BackupSection[];
  /** yyyy-mm-dd, inclusive; empty for no limit. Applies to orders and the report. */
  ordersFrom: string;
  ordersTo: string;
  includeTrash: boolean;
  spreadsheets: boolean;
}

type Progress = (message: string) => void;

const MIGRATION = 'supabase/migrations/20261006_shop_backup.sql';

const explainBackupError = (error: unknown, action: 'export' | 'import' | 'preview'): string => {
  const { code, message = '' } = (error || {}) as { code?: string; message?: string };
  if (code === 'PGRST202' || /could not find the function/i.test(message)) {
    return `The shop backup functions are not in the database yet. Run ${MIGRATION} in the Supabase SQL Editor (or deactivate and activate the shop on a site started with npm start), then try again.`;
  }
  if (code === '57014') {
    return `The database cancelled the ${action} because it ran longer than the time limit for signed-in users (8 seconds by default on Supabase). Nothing was changed. `
      + `In the Supabase SQL Editor run: alter role authenticated set statement_timeout = '120s'; notify pgrst, 'reload config'; — then try again. `
      + 'Exporting or importing fewer parts at a time also helps.';
  }
  return describeDbError(error);
};

// ---------------------------------------------------------------------------------------------------
// Spreadsheets

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A leading = + - @ makes spreadsheet apps evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Every column any row has, in first-seen order. The BOM makes Excel read UTF-8 (Persian, accents). */
export const toCsv = (rows: Array<Record<string, unknown>>, columns?: string[]) => {
  const header = columns || [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => header.map((column) => csvCell(row[column])).join(','))];
  return `﻿${lines.join('\r\n')}`;
};

const csvFileName = (table: string) => (table === 'options' ? 'settings' : table.replace(/^shop_/, ''));

const reportSpreadsheets = (report: ShopReport & { from: string; to: string }): Record<string, string> => ({
  'reports/summary.csv': toCsv([
    { metric: 'Period from', value: report.from },
    { metric: 'Period to', value: report.to },
    { metric: 'Orders', value: report.orders },
    { metric: 'Gross sales', value: report.gross_sales },
    { metric: 'Net sales', value: report.net_sales },
    { metric: 'Average order', value: report.average_order },
    { metric: 'Items sold', value: report.items_sold },
    { metric: 'Refunds', value: report.refunds },
    { metric: 'Discounts', value: report.discounts },
    { metric: 'Tax', value: report.tax },
    { metric: 'Shipping', value: report.shipping },
    ...Object.entries(report.by_status || {}).map(([status, count]) => ({ metric: `Orders ${status}`, value: count })),
  ]),
  'reports/sales-by-day.csv': toCsv(report.daily || [], ['date', 'orders', 'sales']),
  'reports/top-sellers.csv': toCsv(report.top_products || [], ['product_id', 'name', 'quantity', 'sales']),
  'reports/top-coupons.csv': toCsv(report.top_coupons || [], ['code', 'uses', 'discount']),
  'reports/low-stock.csv': toCsv(report.low_stock || [], ['id', 'name', 'stock_quantity']),
});

// ---------------------------------------------------------------------------------------------------
// Export

const dayStart = (date: string) => new Date(`${date}T00:00:00`).toISOString();
const dayAfter = (date: string) => new Date(new Date(`${date}T00:00:00`).getTime() + 86_400_000).toISOString();

const siteTitle = async () => {
  const { data } = await getSupabaseClient().from('options').select('option_value').eq('option_name', 'site_title').maybeSingle();
  return (data?.option_value as string | undefined) || '';
};

export async function createShopBackup(choices: ExportChoices, onProgress: Progress) {
  const sections = dataSections.filter((section) => choices.sections.includes(section));
  if (!sections.length && !choices.sections.includes('reports')) {
    throw new Error('Choose at least one part of the shop to export.');
  }
  const options = {
    orders_from: choices.ordersFrom ? dayStart(choices.ordersFrom) : '',
    orders_to: choices.ordersTo ? dayAfter(choices.ordersTo) : '',
    include_trash: choices.includeTrash,
  };

  let backup: ShopBackup = {
    format: 'rwp-shop-backup', version: 1, created_at: new Date().toISOString(), sections: [], tables: {}, users: [],
  };
  if (sections.length) {
    onProgress('Reading the shop from the database…');
    const { data, error } = await getSupabaseClient().rpc('shop_backup_export', { p_sections: sections, p_options: options });
    if (error) throw new Error(explainBackupError(error, 'export'));
    backup = data as ShopBackup;
  }
  backup.site = { title: await siteTitle().catch(() => ''), origin: window.location.origin, plugin_version: manifest.version };

  if (choices.sections.includes('reports')) {
    onProgress('Calculating the sales report…');
    const from = options.orders_from || '2000-01-01T00:00:00.000Z';
    const to = options.orders_to || new Date(Date.now() + 86_400_000).toISOString();
    const { data, error } = await getSupabaseClient().rpc('shop_report', { p_from: from, p_to: to });
    if (error) throw new Error(`The sales report could not be calculated: ${describeDbError(error)}`);
    backup.reports = { ...(data as ShopReport), from, to };
  }

  onProgress('Compressing…');
  const zip: Zippable = { 'shop-backup.json': [strToU8(JSON.stringify(backup)), { level: 6 }] };
  if (choices.spreadsheets) {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (rows.length) zip[`spreadsheets/${csvFileName(table)}.csv`] = strToU8(toCsv(rows));
    }
    if (backup.users.length) zip['spreadsheets/accounts.csv'] = strToU8(toCsv(backup.users as unknown as Array<Record<string, unknown>>));
  }
  if (backup.reports) {
    for (const [path, csv] of Object.entries(reportSpreadsheets(backup.reports))) zip[path] = strToU8(csv);
  }
  const bytes = zipSync(zip);
  const slug = (backup.site.title || 'shop').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  return {
    blob: new Blob([bytes], { type: 'application/zip' }),
    fileName: `shop-backup-${slug}-${stamp}.zip`,
    backup,
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading a file

const errorText = (error: unknown) => (error instanceof Error ? error.message : describeDbError(error));

/** The shop part of a full site backup (format react-wp-backup), in the shop backup's shape. */
const fromSiteBackup = (site: Record<string, unknown>): ShopBackup => {
  const siteTables = (site.tables || {}) as ShopBackup['tables'];
  const tables: ShopBackup['tables'] = {};
  const sections: DataSection[] = [];
  for (const section of dataSections) {
    const names = sectionInfo(section).tables;
    const rows = names.map((name) => (name === 'options'
      ? (siteTables.options || []).filter((row) => String(row.option_name || '').startsWith('shop_'))
      : siteTables[name] || []));
    if (rows.some((list) => list.length)) {
      sections.push(section);
      names.forEach((name, index) => { tables[name] = rows[index]; });
    }
  }
  const siteInfo = (site.site || {}) as ShopBackup['site'];
  return {
    format: 'rwp-shop-backup',
    version: 1,
    created_at: String(site.created_at || ''),
    site: siteInfo,
    sections,
    tables,
    users: ((site.users || []) as BackupUser[]).map(({ id, email, display_name }) => ({ id, email, display_name })),
  };
};

export async function readShopBackupFile(file: File): Promise<LoadedShopBackup> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let files: Record<string, Uint8Array>;
    try {
      // Only the JSON is needed; spreadsheets and media stay compressed.
      files = unzipSync(bytes, { filter: (entry) => entry.name === 'shop-backup.json' || entry.name === 'backup.json' });
    } catch (zipError) {
      throw new Error(`"${file.name}" is a ZIP file but could not be opened (${errorText(zipError)}). It may be incomplete — try downloading it again.`);
    }
    const json = files['shop-backup.json'] || files['backup.json'];
    if (!json) {
      throw new Error(`"${file.name}" is a ZIP file without a shop-backup.json inside, so it was not made by Shop → Backup (or Settings → Backup).`);
    }
    text = strFromU8(json);
  } else {
    text = strFromU8(bytes);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`"${file.name}" is neither a ZIP nor a JSON file. Choose the .zip file downloaded from Shop → Backup.`);
  }
  if (parsed?.format === 'react-wp-backup') {
    if (parsed.version !== 1) {
      throw new Error(`This site backup uses format version ${String(parsed.version)}, but this site only understands version 1.`);
    }
    const data = fromSiteBackup(parsed);
    if (!data.sections.length) throw new Error(`"${file.name}" is a site backup without any shop data in it.`);
    return { fileName: file.name, data, source: 'site' };
  }
  if (parsed?.format !== 'rwp-shop-backup') {
    throw new Error(`"${file.name}" is not a shop backup: its "format" field is ${parsed?.format ? `"${String(parsed.format)}"` : 'missing'}.`);
  }
  if (parsed.version !== 1) {
    throw new Error(`This shop backup uses format version ${String(parsed.version)}, but this site only understands version 1. Update the shop plugin to the version that made the backup.`);
  }
  const data = parsed as unknown as ShopBackup;
  if (!data.tables || typeof data.tables !== 'object') {
    throw new Error(`"${file.name}" has no tables, so there is nothing to import.`);
  }
  data.sections = (Array.isArray(data.sections) ? data.sections : []).filter((section) => dataSections.includes(section));
  data.users = Array.isArray(data.users) ? data.users : [];
  return { fileName: file.name, data, source: 'shop' };
}

/** How many items of a section a backup holds (its first table; settings count every row). */
export const sectionCount = (data: ShopBackup, section: BackupSection) => {
  if (section === 'reports') return data.reports ? data.reports.orders : 0;
  const tables = sectionInfo(section).tables;
  const counted = section === 'settings' ? tables : tables.slice(0, 1);
  return counted.reduce((sum, table) => sum + (data.tables[table]?.length ?? 0), 0);
};

// ---------------------------------------------------------------------------------------------------
// Import

export async function importShopBackup(loaded: LoadedShopBackup, modes: Partial<Record<DataSection, ImportMode>>, dryRun: boolean) {
  // Reports are never imported; leaving them out keeps the request smaller.
  const { reports: _reports, ...payload } = loaded.data;
  const { data, error } = await getSupabaseClient().rpc('shop_backup_import', {
    p_backup: payload,
    p_modes: modes,
    p_dry_run: dryRun,
  });
  if (error) throw new Error(explainBackupError(error, dryRun ? 'preview' : 'import'));
  return data as ImportReport;
}

export const reportTotals = (report: ImportReport) => Object.values(report.counts).reduce(
  (sum, counts) => ({
    inserted: sum.inserted + counts.inserted,
    updated: sum.updated + counts.updated,
    skipped: sum.skipped + counts.skipped,
    dropped: sum.dropped + counts.dropped,
    deleted: sum.deleted + counts.deleted,
  }),
  { inserted: 0, updated: 0, skipped: 0, dropped: 0, deleted: 0 },
);
