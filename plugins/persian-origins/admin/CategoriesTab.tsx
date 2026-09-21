import { useEffect, useState } from 'react';
import MediaManager from '../../../src/components/MediaManager';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { currentI18nSettings, localeDefinition } from '../../../src/lib/i18n';
import {
  getTranslations, reloadDatabaseTranslations, termKey, translationsMigration, upsertTranslation,
} from '../../../src/lib/translations';
import settingsStyles from '../../../src/components/SiteSettings.module.css';
import { getPoSettings } from '../lib/settings';
import styles from './admin.module.css';

/**
 * Category names and descriptions per language, and an image for [po_categories].
 *
 * The text is saved as core translation keys (category.<slug>.name / .description), not in this
 * plugin's tables, so core's Categories widget and the archive title show it too, and Settings →
 * Translations lists it. Writing those keys needs manage_options, which is why this tab does.
 */

interface CategoryRow { id: string; name: string; slug: string; description: string | null }
interface Meta { image_url: string; sort_order: number }
type Texts = Record<string, { name: string; description: string }>;

const metaMissing = (message: string) => /po_category_meta/.test(message) && /schema cache|does not exist|PGRST205|42P01/i.test(message);

function CategoryEditor({ category, meta, texts, languages }: {
  category: CategoryRow; meta: Meta; texts: Texts; languages: string[];
}) {
  const [draftMeta, setDraftMeta] = useState(meta);
  const [draftTexts, setDraftTexts] = useState(texts);
  const [savedMeta, setSavedMeta] = useState(meta);
  const [savedTexts, setSavedTexts] = useState(texts);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const dirty = JSON.stringify(draftMeta) !== JSON.stringify(savedMeta) || JSON.stringify(draftTexts) !== JSON.stringify(savedTexts);

  const save = async () => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      if (draftMeta.image_url && !/^https?:\/\//.test(draftMeta.image_url)) throw new Error('The image must be a full address starting with https://.');
      if (JSON.stringify(draftMeta) !== JSON.stringify(savedMeta)) {
        const { data, error: metaError } = await getSupabaseClient().from('po_category_meta')
          .upsert({ category_id: category.id, image_url: draftMeta.image_url || null, sort_order: draftMeta.sort_order })
          .select('category_id');
        if (metaError) {
          const message = describeDbError(metaError);
          throw new Error(metaMissing(message)
            ? 'The po_category_meta table does not exist. Activate the plugin again under Plugins, or run plugins/persian-origins/schema.sql in the Supabase SQL Editor.'
            : `The image and order were not saved: ${message}`);
        }
        if (!data?.length) throw new Error('The image and order were not saved: editing categories needs the manage_categories capability.');
      }
      for (const language of languages) {
        for (const field of ['name', 'description'] as const) {
          const next = draftTexts[language]?.[field] ?? '';
          if (next === (savedTexts[language]?.[field] ?? '')) continue;
          // Empty marks the key untranslated, so the stored name shows again.
          await upsertTranslation({ key: termKey('category', category, field), locale: language, value: next, group: 'categories' });
        }
      }
      await reloadDatabaseTranslations();
      setSavedMeta(draftMeta);
      setSavedTexts(draftTexts);
      setFeedback('Saved.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const setText = (language: string, field: 'name' | 'description', value: string) =>
    setDraftTexts((current) => ({ ...current, [language]: { ...(current[language] || { name: '', description: '' }), [field]: value } }));

  return (
    <div className={styles.category}>
      <div className={styles.categoryMedia}>
        {draftMeta.image_url ? <img src={draftMeta.image_url} alt="" /> : <span aria-hidden="true">{category.name.charAt(0).toUpperCase()}</span>}
      </div>
      <div className={styles.categoryBody}>
        <strong>{category.name}</strong> <small>/{category.slug}</small>
        {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}
        {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}
        {languages.map((language) => {
          const definition = localeDefinition(language);
          return (
            <div key={language} className={styles.twoColumns}>
              <label>
                Name ({definition.name})
                <input value={draftTexts[language]?.name ?? ''} placeholder={category.name} lang={language} dir={definition.dir}
                  onChange={(event) => setText(language, 'name', event.target.value)} />
              </label>
              <label>
                Description ({definition.name})
                <input value={draftTexts[language]?.description ?? ''} placeholder={category.description || ''} lang={language} dir={definition.dir}
                  onChange={(event) => setText(language, 'description', event.target.value)} />
              </label>
            </div>
          );
        })}
        <div className={styles.twoColumns}>
          <label>
            Image
            <span className={styles.row}>
              <input value={draftMeta.image_url} placeholder="https://…" onChange={(event) => setDraftMeta({ ...draftMeta, image_url: event.target.value })} />
              <button type="button" className={settingsStyles.secondaryButton} onClick={() => setPicking(true)}>Choose…</button>
            </span>
          </label>
          <label>
            Order in the grid
            <input type="number" min={-10000} max={10000} value={draftMeta.sort_order}
              onChange={(event) => setDraftMeta({ ...draftMeta, sort_order: Math.round(Number(event.target.value) || 0) })} />
          </label>
        </div>
        <div className={settingsStyles.actions}>
          <button type="button" className={settingsStyles.saveButton} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {picking && (
        <MediaManager heading={`Image for ${category.name}`} onClose={() => setPicking(false)}
          onSelect={(item) => { setPicking(false); setDraftMeta((current) => ({ ...current, image_url: item.url })); }} />
      )}
    </div>
  );
}

export default function CategoriesTab() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map());
  const [texts, setTexts] = useState<Map<string, Texts>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const base = currentI18nSettings().default_site_language;
  const languages = getPoSettings().languages.filter((code) => code !== base);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const supabase = getSupabaseClient();
      const [categoryResult, metaResult] = await Promise.all([
        supabase.from('categories').select('id,name,slug,description').order('name'),
        supabase.from('po_category_meta').select('category_id,image_url,sort_order'),
      ]);
      if (categoryResult.error) throw new Error(describeDbError(categoryResult.error));
      if (metaResult.error) setNotice(`Images cannot be saved yet: ${describeDbError(metaResult.error)}`);
      let rows: Awaited<ReturnType<typeof getTranslations>> = [];
      try {
        rows = await getTranslations();
      } catch (translationError) {
        setNotice(`Names and descriptions cannot be translated until core's ${translationsMigration} has run. ${translationError instanceof Error ? translationError.message : ''}`);
      }
      if (!active) return;
      const list = (categoryResult.data || []) as CategoryRow[];
      const byKey = new Map(rows.map((row) => [`${row.translation_key}\u0000${row.locale}`, row.translation_value || '']));
      setCategories(list);
      setMeta(new Map(((metaResult.data || []) as Array<{ category_id: string; image_url: string | null; sort_order: number }>)
        .map((row) => [row.category_id, { image_url: row.image_url || '', sort_order: row.sort_order }])));
      setTexts(new Map(list.map((category) => [category.id, Object.fromEntries(languages.map((language) => [language, {
        name: byKey.get(`${termKey('category', category, 'name')}\u0000${language}`) || '',
        description: byKey.get(`${termKey('category', category, 'description')}\u0000${language}`) || '',
      }]))])));
    };
    load()
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : String(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // languages come from settings that do not change while this tab is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className={settingsStyles.loading} role="status">Loading categories…</div>;

  return (
    <div className={styles.panel}>
      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}
      {notice && <div className={settingsStyles.warning} role="status">{notice}</div>}
      <p className={settingsStyles.help}>
        The category&rsquo;s own name is its {localeDefinition(base).name} name (edit it under Pages &amp; Posts → Categories).
        Empty fields show that name. Everything here is also listed under Settings → Translations.
      </p>
      {categories.length === 0 ? <p className={settingsStyles.help}>No categories yet.</p> : categories.map((category) => (
        <CategoryEditor key={category.id} category={category} languages={languages}
          meta={meta.get(category.id) || { image_url: '', sort_order: 0 }} texts={texts.get(category.id) || {}} />
      ))}
    </div>
  );
}
