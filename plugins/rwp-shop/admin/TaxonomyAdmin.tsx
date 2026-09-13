import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import type { Taxonomy } from '../lib/types';
import { Feedback, Field, ImagePicker, slugify } from './common';
import styles from './admin.module.css';

interface TaxonomyDraft {
  id?: string;
  name: string;
  slug: string;
  description: string;
  parent_id: string | null;
  image_url: string | null;
  menu_order: number;
}

const emptyDraft: TaxonomyDraft = { name: '', slug: '', description: '', parent_id: null, image_url: null, menu_order: 0 };

export default function TaxonomyAdmin({ kind }: { kind: 'categories' | 'tags' }) {
  const table = kind === 'categories' ? 'shop_categories' : 'shop_tags';
  const linkTable = kind === 'categories' ? 'shop_product_categories' : 'shop_product_tags';
  const singular = kind === 'categories' ? 'category' : 'tag';
  const [items, setItems] = useState<Array<Taxonomy & { count: number }>>([]);
  const [draft, setDraft] = useState<TaxonomyDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient().from(table).select(`*, ${linkTable}(count)`).order('name');
    if (loadError) return setError(explainShopError(loadError));
    setItems((data || []).map((row) => ({ ...(row as Taxonomy), count: (row as Record<string, Array<{ count: number }>>)[linkTable]?.[0]?.count || 0 })));
  }, [table, linkTable]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const slug = slugify(draft.slug || draft.name);
    if (!draft.name.trim() || !slug) return setError(`The ${singular} needs a name.`);
    const row: { name: string; slug: string; description: string; parent_id?: string | null; image_url?: string | null; menu_order?: number } = kind === 'categories'
      ? { name: draft.name.trim(), slug, description: draft.description, parent_id: draft.parent_id, image_url: draft.image_url, menu_order: draft.menu_order }
      : { name: draft.name.trim(), slug, description: draft.description };
    const supabase = getSupabaseClient();
    const { data, error: saveError } = draft.id
      ? await supabase.from(table).update(row).eq('id', draft.id).select('id')
      : await supabase.from(table).insert(row).select('id');
    if (saveError) return setError(saveError.code === '23505' ? `Another ${singular} already uses the slug "${slug}".` : explainShopError(saveError));
    if (!data?.length) return setError(`The ${singular} was not saved: the database refused the write. Your role needs the manage_shop capability.`);
    setSuccess(`${draft.id ? 'Updated' : 'Added'} “${row.name}”.`);
    setDraft(emptyDraft);
    void load();
  };

  const remove = async (item: Taxonomy) => {
    if (!window.confirm(`Delete “${item.name}”? Products keep existing but lose this ${singular}.`)) return;
    const { data, error: deleteError } = await getSupabaseClient().from(table).delete().eq('id', item.id).select('id');
    if (deleteError) return setError(explainShopError(deleteError));
    if (!data?.length) return setError('Nothing was deleted: the database refused the delete.');
    void load();
  };

  return (
    <div className={styles.editorLayout} style={{ gridTemplateColumns: '340px minmax(0, 1fr)' }}>
      <form className={styles.panel} onSubmit={submit}>
        <h2>{draft.id ? `Edit ${singular}` : `Add new ${singular}`}</h2>
        <Feedback error={error} success={success} />
        <Field label="Name"><input className={styles.input} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Slug" hint="Leave empty to generate it from the name."><input className={styles.input} value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></Field>
        {kind === 'categories' && (
          <Field label="Parent category">
            <select className={styles.select} value={draft.parent_id || ''} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value || null })}>
              <option value="">None</option>
              {items.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Description"><textarea className={styles.textarea} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
        {kind === 'categories' && (
          <>
            <Field label="Menu order"><input className={styles.input} type="number" value={draft.menu_order} onChange={(event) => setDraft({ ...draft, menu_order: Number(event.target.value) || 0 })} /></Field>
            <ImagePicker value={draft.image_url} onChange={(url) => setDraft({ ...draft, image_url: url })} label="Set thumbnail" />
          </>
        )}
        <div className={styles.toolbarGroup}>
          <button type="submit" className={styles.button}>{draft.id ? 'Update' : `Add new ${singular}`}</button>
          {draft.id && <button type="button" className={styles.buttonSecondary} onClick={() => setDraft(emptyDraft)}>Cancel</button>}
        </div>
      </form>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Name</th><th>Slug</th>{kind === 'categories' && <th>Parent</th>}<th>Count</th><th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className={styles.muted}>No {kind} yet.</td></tr>}
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.slug}</td>
                {kind === 'categories' && <td>{items.find((parent) => parent.id === item.parent_id)?.name || '—'}</td>}
                <td>{item.count}</td>
                <td>
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.buttonLink} onClick={() => setDraft({
                      id: item.id, name: item.name, slug: item.slug, description: item.description || '',
                      parent_id: item.parent_id || null, image_url: item.image_url || null, menu_order: item.menu_order || 0,
                    })}>Edit</button>
                    <a className={styles.buttonLink} href={`/product-${kind === 'categories' ? 'category' : 'tag'}/${item.slug}`} target="_blank" rel="noreferrer">View</a>
                    <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} onClick={() => void remove(item)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AttributeRow {
  id: string;
  name: string;
  slug: string;
  order_by: 'menu_order' | 'name';
  shop_attribute_terms: Array<{ id: string; name: string; slug: string; menu_order: number }>;
}

export function AttributesAdmin() {
  const [attributes, setAttributes] = useState<AttributeRow[]>([]);
  const [name, setName] = useState('');
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient().from('shop_attributes').select('*, shop_attribute_terms(*)').order('name');
    if (loadError) return setError(explainShopError(loadError));
    setAttributes((data || []) as AttributeRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addAttribute = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const slug = slugify(name);
    if (!slug) return setError('The attribute needs a name.');
    const { data, error: saveError } = await getSupabaseClient().from('shop_attributes').insert({ name: name.trim(), slug }).select('id');
    if (saveError) return setError(saveError.code === '23505' ? `An attribute with the slug "${slug}" already exists.` : explainShopError(saveError));
    if (!data?.length) return setError('The attribute was not saved: the database refused the write.');
    setName('');
    setSuccess('Attribute added. Add its terms below.');
    void load();
  };

  const addTerm = async (attribute: AttributeRow) => {
    const value = (terms[attribute.id] || '').trim();
    if (!value) return;
    const { error: saveError } = await getSupabaseClient().from('shop_attribute_terms')
      .insert({ attribute_id: attribute.id, name: value, slug: slugify(value), menu_order: attribute.shop_attribute_terms.length });
    if (saveError) return setError(saveError.code === '23505' ? `“${value}” already exists in ${attribute.name}.` : explainShopError(saveError));
    setTerms({ ...terms, [attribute.id]: '' });
    void load();
  };

  const removeTerm = async (termId: string) => {
    const { error: deleteError } = await getSupabaseClient().from('shop_attribute_terms').delete().eq('id', termId);
    if (deleteError) return setError(explainShopError(deleteError));
    void load();
  };

  const removeAttribute = async (attribute: AttributeRow) => {
    if (!window.confirm(`Delete the “${attribute.name}” attribute and its terms? Products keep their current values.`)) return;
    const { error: deleteError } = await getSupabaseClient().from('shop_attributes').delete().eq('id', attribute.id);
    if (deleteError) return setError(explainShopError(deleteError));
    void load();
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.panel} onSubmit={addAttribute}>
        <h2>Add new attribute</h2>
        <p className={styles.muted}>Global attributes (e.g. Color, Size) can be shared by products and used for layered filtering in the shop.</p>
        <Feedback error={error} success={success} />
        <div className={styles.toolbarGroup}>
          <input className={styles.input} style={{ width: 260 }} placeholder="Attribute name, e.g. Color" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className={styles.button}>Add attribute</button>
        </div>
      </form>
      {attributes.map((attribute) => (
        <div key={attribute.id} className={styles.panel}>
          <div className={styles.toolbar}>
            <h3>{attribute.name} <span className={styles.muted}>({attribute.slug})</span></h3>
            <button type="button" className={styles.buttonDanger} onClick={() => void removeAttribute(attribute)}>Delete</button>
          </div>
          <div className={styles.pillList}>
            {[...attribute.shop_attribute_terms].sort((a, b) => a.menu_order - b.menu_order).map((term) => (
              <span key={term.id} className={styles.pill}>{term.name}
                <button type="button" aria-label={`Remove ${term.name}`} onClick={() => void removeTerm(term.id)}>×</button>
              </span>
            ))}
            {attribute.shop_attribute_terms.length === 0 && <span className={styles.muted}>No terms yet.</span>}
          </div>
          <div className={styles.toolbarGroup}>
            <input className={styles.input} style={{ width: 220 }} placeholder={`New ${attribute.name.toLowerCase()} term`} value={terms[attribute.id] || ''}
              onChange={(event) => setTerms({ ...terms, [attribute.id]: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addTerm(attribute); } }} />
            <button type="button" className={styles.buttonSecondary} onClick={() => void addTerm(attribute)}>Add term</button>
          </div>
        </div>
      ))}
    </div>
  );
}
