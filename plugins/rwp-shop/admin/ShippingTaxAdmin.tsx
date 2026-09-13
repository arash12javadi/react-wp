import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import { countries, countryName } from '../lib/countries';
import type { ShopSettings } from '../lib/settings';
import type { Taxonomy } from '../lib/types';
import { Feedback, Field, slugify, TagInput } from './common';
import styles from './admin.module.css';

interface TaxRate {
  id?: string;
  country: string;
  state: string;
  postcodes: string[];
  cities: string[];
  rate: number;
  name: string;
  priority: number;
  compound: boolean;
  shipping: boolean;
  tax_class: string;
  menu_order: number;
}

export function TaxRatesEditor({ settings }: { settings: ShopSettings }) {
  const classes = ['standard', ...settings.tax_classes];
  const [taxClass, setTaxClass] = useState('standard');
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient().from('shop_tax_rates').select('*').eq('tax_class', taxClass).order('menu_order');
    if (loadError) return setError(explainShopError(loadError));
    setRates((data || []) as TaxRate[]);
    setRemoved([]);
  }, [taxClass]);

  useEffect(() => { void load(); }, [load]);

  const update = (index: number, changes: Partial<TaxRate>) => setRates(rates.map((rate, i) => (i === index ? { ...rate, ...changes } : rate)));

  const save = async () => {
    setError('');
    setSuccess('');
    const supabase = getSupabaseClient();
    if (removed.length) {
      const { error: deleteError } = await supabase.from('shop_tax_rates').delete().in('id', removed);
      if (deleteError) return setError(explainShopError(deleteError));
    }
    for (const [index, rate] of rates.entries()) {
      const row = { ...rate, country: rate.country.toUpperCase(), state: rate.state.toUpperCase(), tax_class: taxClass, menu_order: index };
      const { id, ...fields } = row;
      const result = id
        ? await supabase.from('shop_tax_rates').update(fields).eq('id', id).select('id')
        : await supabase.from('shop_tax_rates').insert(fields).select('id');
      if (result.error) return setError(`Rate ${index + 1}: ${explainShopError(result.error)}`);
      if (!result.data?.length) return setError('Tax rates were not saved: the database refused the write. Your role needs the manage_shop capability.');
    }
    setSuccess('Tax rates saved.');
    void load();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <h2>Tax rates</h2>
        <div className={styles.subTabs}>
          {classes.map((item) => (
            <button key={item} type="button" className={taxClass === item ? styles.subTabActive : styles.subTab} onClick={() => setTaxClass(item)}>“{item}” rates</button>
          ))}
        </div>
      </div>
      <p className={styles.muted}>
        Leave country, state, postcodes or cities empty to match everywhere. Postcodes accept wildcards (<code>902*</code>) and ranges (<code>90210...90299</code>).
        For each priority, only the most specific matching rate applies.
      </p>
      <Feedback error={error} success={success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Country</th><th>State</th><th>Postcodes</th><th>Cities</th><th>Rate %</th><th>Name</th><th>Priority</th><th>Compound</th><th>Shipping</th><th /></tr></thead>
          <tbody>
            {rates.length === 0 && <tr><td colSpan={10} className={styles.muted}>No rates for this class.</td></tr>}
            {rates.map((rate, index) => (
              <tr key={rate.id || index}>
                <td>
                  <select className={styles.select} style={{ minWidth: 120 }} value={rate.country} onChange={(event) => update(index, { country: event.target.value })}>
                    <option value="">Any</option>
                    {countries.map((country) => <option key={country.code} value={country.code}>{country.code}</option>)}
                  </select>
                </td>
                <td><input className={styles.input} style={{ width: 70 }} value={rate.state} onChange={(event) => update(index, { state: event.target.value })} placeholder="Any" /></td>
                <td style={{ minWidth: 160 }}><TagInput value={rate.postcodes} onChange={(postcodes) => update(index, { postcodes })} placeholder="Any" /></td>
                <td style={{ minWidth: 160 }}><TagInput value={rate.cities} onChange={(cities) => update(index, { cities })} placeholder="Any" /></td>
                <td><input className={styles.input} style={{ width: 80 }} type="number" step="any" value={rate.rate} onChange={(event) => update(index, { rate: Number(event.target.value) || 0 })} /></td>
                <td><input className={styles.input} style={{ width: 110 }} value={rate.name} onChange={(event) => update(index, { name: event.target.value })} /></td>
                <td><input className={styles.input} style={{ width: 60 }} type="number" min={1} value={rate.priority} onChange={(event) => update(index, { priority: Number(event.target.value) || 1 })} /></td>
                <td><input type="checkbox" aria-label="Compound" checked={rate.compound} onChange={(event) => update(index, { compound: event.target.checked })} /></td>
                <td><input type="checkbox" aria-label="Applies to shipping" checked={rate.shipping} onChange={(event) => update(index, { shipping: event.target.checked })} /></td>
                <td><button type="button" className={styles.buttonDanger} onClick={() => {
                  if (rate.id) setRemoved([...removed, rate.id]);
                  setRates(rates.filter((_, i) => i !== index));
                }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.toolbarGroup}>
        <button type="button" className={styles.buttonSecondary} onClick={() => setRates([...rates, {
          country: '', state: '', postcodes: [], cities: [], rate: 0, name: 'Tax', priority: 1, compound: false, shipping: true, tax_class: taxClass, menu_order: rates.length,
        }])}>Insert row</button>
        <button type="button" className={styles.button} onClick={() => void save()}>Save rates</button>
      </div>
    </div>
  );
}

interface Zone {
  id?: string;
  name: string;
  regions: string[];
  postcodes: string[];
  menu_order: number;
}

interface Method {
  id?: string;
  zone_id: string | null;
  type: 'flat_rate' | 'free_shipping' | 'local_pickup';
  title: string;
  enabled: boolean;
  cost: number;
  cost_per_item: number;
  class_costs: Record<string, number>;
  calculation_type: 'class' | 'order';
  tax_status: 'taxable' | 'none';
  free_requires: '' | 'coupon' | 'min_amount' | 'either' | 'both';
  min_amount: number;
  ignore_discounts: boolean;
  menu_order: number;
}

const methodLabels: Record<Method['type'], string> = { flat_rate: 'Flat rate', free_shipping: 'Free shipping', local_pickup: 'Local pickup' };

function MethodsEditor({ zoneId, classes }: { zoneId: string | null; classes: Taxonomy[] }) {
  const [methods, setMethods] = useState<Method[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    let query = getSupabaseClient().from('shop_shipping_methods').select('*').order('menu_order');
    query = zoneId ? query.eq('zone_id', zoneId) : query.is('zone_id', null);
    const { data, error: loadError } = await query;
    if (loadError) return setError(explainShopError(loadError));
    setMethods((data || []) as Method[]);
  }, [zoneId]);

  useEffect(() => { void load(); }, [load]);

  const update = (index: number, changes: Partial<Method>) => setMethods(methods.map((method, i) => (i === index ? { ...method, ...changes } : method)));

  const saveMethod = async (method: Method, index: number) => {
    setError('');
    setSuccess('');
    const { id, ...fields } = { ...method, zone_id: zoneId, menu_order: index };
    const supabase = getSupabaseClient();
    const result = id
      ? await supabase.from('shop_shipping_methods').update(fields).eq('id', id).select('id')
      : await supabase.from('shop_shipping_methods').insert(fields).select('id');
    if (result.error) return setError(explainShopError(result.error));
    if (!result.data?.length) return setError('The shipping method was not saved: the database refused the write.');
    setSuccess(`“${method.title}” saved.`);
    void load();
  };

  const removeMethod = async (method: Method, index: number) => {
    if (method.id) {
      const { error: deleteError } = await getSupabaseClient().from('shop_shipping_methods').delete().eq('id', method.id);
      if (deleteError) return setError(explainShopError(deleteError));
    }
    setMethods(methods.filter((_, i) => i !== index));
  };

  const add = (type: Method['type']) => setMethods([...methods, {
    zone_id: zoneId, type, title: methodLabels[type], enabled: true, cost: 0, cost_per_item: 0, class_costs: {},
    calculation_type: 'class', tax_status: 'taxable', free_requires: '', min_amount: 0, ignore_discounts: false, menu_order: methods.length,
  }]);

  return (
    <div className={styles.wrap}>
      <Feedback error={error} success={success} />
      {methods.length === 0 && <p className={styles.muted}>No shipping methods in this zone — customers in it cannot check out physical products.</p>}
      {methods.map((method, index) => (
        <details key={method.id || index} className={`${styles.boxed} ${styles.details}`} open={!method.id}>
          <summary>{method.title} <span className={styles.muted}>({methodLabels[method.type]}{method.enabled ? '' : ', disabled'})</span></summary>
          <div className={styles.grid3} style={{ marginTop: 10 }}>
            <Field label="Method title"><input className={styles.input} value={method.title} onChange={(event) => update(index, { title: event.target.value })} /></Field>
            <label className={styles.check}><input type="checkbox" checked={method.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />Enabled</label>
            {method.type !== 'free_shipping' && (
              <Field label="Tax status">
                <select className={styles.select} value={method.tax_status} onChange={(event) => update(index, { tax_status: event.target.value as Method['tax_status'] })}>
                  <option value="taxable">Taxable</option>
                  <option value="none">None</option>
                </select>
              </Field>
            )}
            {method.type !== 'free_shipping' && (
              <Field label="Cost" hint="Excluding tax"><input className={styles.input} type="number" min="0" step="any" value={method.cost} onChange={(event) => update(index, { cost: Number(event.target.value) || 0 })} /></Field>
            )}
            {method.type === 'flat_rate' && (
              <>
                <Field label="Cost per item"><input className={styles.input} type="number" min="0" step="any" value={method.cost_per_item} onChange={(event) => update(index, { cost_per_item: Number(event.target.value) || 0 })} /></Field>
                <Field label="Class cost calculation">
                  <select className={styles.select} value={method.calculation_type} onChange={(event) => update(index, { calculation_type: event.target.value as Method['calculation_type'] })}>
                    <option value="class">Per class: charge each shipping class</option>
                    <option value="order">Per order: charge the most expensive class</option>
                  </select>
                </Field>
                {classes.map((shippingClass) => (
                  <Field key={shippingClass.id} label={`“${shippingClass.name}” class cost`}>
                    <input className={styles.input} type="number" min="0" step="any" value={method.class_costs[shippingClass.id] ?? ''}
                      onChange={(event) => update(index, { class_costs: { ...method.class_costs, [shippingClass.id]: Number(event.target.value) || 0 } })} />
                  </Field>
                ))}
                {classes.length > 0 && (
                  <Field label="No shipping class cost">
                    <input className={styles.input} type="number" min="0" step="any" value={method.class_costs.none ?? ''}
                      onChange={(event) => update(index, { class_costs: { ...method.class_costs, none: Number(event.target.value) || 0 } })} />
                  </Field>
                )}
              </>
            )}
            {method.type === 'free_shipping' && (
              <>
                <Field label="Free shipping requires…">
                  <select className={styles.select} value={method.free_requires} onChange={(event) => update(index, { free_requires: event.target.value as Method['free_requires'] })}>
                    <option value="">N/A</option>
                    <option value="coupon">A valid free shipping coupon</option>
                    <option value="min_amount">A minimum order amount</option>
                    <option value="either">A minimum order amount OR a coupon</option>
                    <option value="both">A minimum order amount AND a coupon</option>
                  </select>
                </Field>
                <Field label="Minimum order amount"><input className={styles.input} type="number" min="0" step="any" value={method.min_amount} onChange={(event) => update(index, { min_amount: Number(event.target.value) || 0 })} /></Field>
                <label className={styles.check}><input type="checkbox" checked={method.ignore_discounts} onChange={(event) => update(index, { ignore_discounts: event.target.checked })} />Apply minimum order rule before coupon discount</label>
              </>
            )}
          </div>
          <div className={styles.toolbarGroup}>
            <button type="button" className={styles.button} onClick={() => void saveMethod(method, index)}>Save method</button>
            <button type="button" className={styles.buttonDanger} onClick={() => void removeMethod(method, index)}>Delete</button>
          </div>
        </details>
      ))}
      <div className={styles.toolbarGroup}>
        {(Object.keys(methodLabels) as Method['type'][]).map((type) => (
          <button key={type} type="button" className={styles.buttonSecondary} onClick={() => add(type)}>Add {methodLabels[type].toLowerCase()}</button>
        ))}
      </div>
    </div>
  );
}

export function ShippingEditor() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [classes, setClasses] = useState<Taxonomy[]>([]);
  const [openZone, setOpenZone] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<Zone | null>(null);
  const [className, setClassName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    const [zoneResult, classResult] = await Promise.all([
      supabase.from('shop_shipping_zones').select('*').order('menu_order').order('name'),
      supabase.from('shop_shipping_classes').select('*').order('name'),
    ]);
    if (zoneResult.error) return setError(explainShopError(zoneResult.error));
    setZones((zoneResult.data || []) as Zone[]);
    setClasses((classResult.data || []) as Taxonomy[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveZone = async () => {
    if (!draft) return;
    setError('');
    if (!draft.name.trim()) return setError('The zone needs a name.');
    if (!draft.regions.length) return setError('Add at least one country or state to the zone.');
    const { id, ...fields } = { ...draft, regions: draft.regions.map((region) => region.toUpperCase()) };
    const supabase = getSupabaseClient();
    const result = id
      ? await supabase.from('shop_shipping_zones').update(fields).eq('id', id).select('id')
      : await supabase.from('shop_shipping_zones').insert(fields).select('id');
    if (result.error) return setError(explainShopError(result.error));
    if (!result.data?.length) return setError('The zone was not saved: the database refused the write.');
    setDraft(null);
    void load();
  };

  const deleteZone = async (zone: Zone) => {
    if (!zone.id || !window.confirm(`Delete the “${zone.name}” zone and its methods?`)) return;
    const { error: deleteError } = await getSupabaseClient().from('shop_shipping_zones').delete().eq('id', zone.id);
    if (deleteError) return setError(explainShopError(deleteError));
    void load();
  };

  const addClass = async () => {
    const slug = slugify(className);
    if (!slug) return;
    const { error: saveError } = await getSupabaseClient().from('shop_shipping_classes').insert({ name: className.trim(), slug });
    if (saveError) return setError(saveError.code === '23505' ? 'A shipping class with that name already exists.' : explainShopError(saveError));
    setClassName('');
    void load();
  };

  const deleteClass = async (shippingClass: Taxonomy) => {
    if (!window.confirm(`Delete the “${shippingClass.name}” shipping class?`)) return;
    const { error: deleteError } = await getSupabaseClient().from('shop_shipping_classes').delete().eq('id', shippingClass.id);
    if (deleteError) return setError(explainShopError(deleteError));
    void load();
  };

  if (openZone !== undefined) {
    const zone = zones.find((item) => item.id === openZone);
    return (
      <div className={styles.panel}>
        <button type="button" className={styles.buttonLink} style={{ justifyContent: 'flex-start' }} onClick={() => setOpenZone(undefined)}>← Shipping zones</button>
        <h2>{zone ? `${zone.name} — shipping methods` : 'Locations not covered by your other zones'}</h2>
        <MethodsEditor zoneId={openZone} classes={classes} />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <Feedback error={error} />
      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <h2>Shipping zones</h2>
          <button type="button" className={styles.button} onClick={() => setDraft({ name: '', regions: [], postcodes: [], menu_order: zones.length })}>Add zone</button>
        </div>
        <p className={styles.muted}>A customer is matched to the first zone (top to bottom) that covers their address, and only that zone's methods are offered.</p>
        {draft && (
          <div className={styles.boxed}>
            <div className={styles.grid2}>
              <Field label="Zone name"><input className={styles.input} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
              <Field label="Order" hint="Lower numbers are matched first."><input className={styles.input} type="number" value={draft.menu_order} onChange={(event) => setDraft({ ...draft, menu_order: Number(event.target.value) || 0 })} /></Field>
              <Field label="Zone regions" hint="Country codes (US) or country:state (US:CA).">
                <TagInput value={draft.regions} onChange={(regions) => setDraft({ ...draft, regions })} placeholder="e.g. US, CA, US:NY" />
              </Field>
              <Field label="Limit to specific postcodes (optional)" hint="Wildcards (902*) and ranges (90210...90299).">
                <TagInput value={draft.postcodes} onChange={(postcodes) => setDraft({ ...draft, postcodes })} />
              </Field>
            </div>
            <div className={styles.toolbarGroup}>
              <button type="button" className={styles.button} onClick={() => void saveZone()}>Save zone</button>
              <button type="button" className={styles.buttonSecondary} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Zone name</th><th>Region(s)</th><th /></tr></thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.id}>
                  <td><strong>{zone.name}</strong></td>
                  <td>{zone.regions.map((region) => (region.includes(':') ? region : countryName(region))).join(', ')}{zone.postcodes.length ? ` (${zone.postcodes.join(', ')})` : ''}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.buttonLink} onClick={() => setOpenZone(zone.id || null)}>Shipping methods</button>
                      <button type="button" className={styles.buttonLink} onClick={() => setDraft(zone)}>Edit zone</button>
                      <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} onClick={() => void deleteZone(zone)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr>
                <td><strong>Rest of the world</strong></td>
                <td className={styles.muted}>Locations not covered by your other zones</td>
                <td><button type="button" className={styles.buttonLink} onClick={() => setOpenZone(null)}>Shipping methods</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.panel}>
        <h2>Shipping classes</h2>
        <p className={styles.muted}>Group products with similar shipping needs, then give each class its own flat-rate cost.</p>
        <div className={styles.pillList}>
          {classes.map((shippingClass) => (
            <span key={shippingClass.id} className={styles.pill}>{shippingClass.name}
              <button type="button" aria-label={`Delete ${shippingClass.name}`} onClick={() => void deleteClass(shippingClass)}>×</button>
            </span>
          ))}
          {classes.length === 0 && <span className={styles.muted}>No shipping classes.</span>}
        </div>
        <div className={styles.toolbarGroup}>
          <input className={styles.input} style={{ width: 240 }} placeholder="New shipping class" value={className} onChange={(event) => setClassName(event.target.value)} />
          <button type="button" className={styles.buttonSecondary} onClick={() => void addClass()}>Add class</button>
        </div>
      </div>
    </div>
  );
}
