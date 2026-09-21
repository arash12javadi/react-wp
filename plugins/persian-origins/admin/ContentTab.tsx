import { useEffect, useMemo, useState, type FormEvent } from 'react';
import ClassicEditor from '../../../src/components/ClassicEditor';
import ContentRenderer from '../../../src/components/ContentRenderer';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { currentI18nSettings, localeDefinition } from '../../../src/lib/i18n';
import settingsStyles from '../../../src/components/SiteSettings.module.css';
import {
  deletePageTranslation, fetchPageTranslations, fetchTranslationIndex, savePageTranslation, type TranslationFields,
} from '../lib/content';
import { getPoSettings } from '../lib/settings';
import styles from './admin.module.css';

interface PageRow {
  id: number;
  title: string;
  slug: string;
  status: string;
  is_post: boolean;
  excerpt: string | null;
  content: string | null;
  is_builder_enabled?: boolean | null;
  locale?: string | null;
}

const listColumns = 'id,title,slug,status,is_post,is_builder_enabled';

/** Pages and posts, without site templates and trash. Works before core's i18n migration (no locale column). */
async function fetchPages(): Promise<PageRow[]> {
  const supabase = getSupabaseClient();
  const query = (columns: string) => supabase.from('pages').select(columns)
    .neq('status', 'trash').eq('is_site_template', false).order('updated_at', { ascending: false }).limit(1000);
  let result = await query(`${listColumns},locale`);
  if (result.error && /locale/.test(describeDbError(result.error))) result = await query(listColumns);
  if (result.error) throw new Error(describeDbError(result.error));
  return (result.data || []) as unknown as PageRow[];
}

const emptyFields: TranslationFields = { title: '', excerpt: '', content: '' };

const requestedPageId = () => Number(new URLSearchParams(window.location.search).get('page')) || null;

function Editor({ page, onSaved }: { page: PageRow; onSaved: (locale: string, exists: boolean) => void }) {
  const base = page.locale || currentI18nSettings().default_site_language;
  const targets = getPoSettings().languages.filter((code) => code !== base);
  const [locale, setLocale] = useState(targets[0] || '');
  const [full, setFull] = useState<PageRow | null>(null);
  const [saved, setSaved] = useState<Record<string, TranslationFields>>({});
  const [draft, setDraft] = useState<TranslationFields>(emptyFields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([
      getSupabaseClient().from('pages').select('id,title,slug,status,is_post,excerpt,content,is_builder_enabled').eq('id', page.id).maybeSingle(),
      fetchPageTranslations(page.id),
    ]).then(([pageResult, rows]) => {
      if (!active) return;
      if (pageResult.error) throw new Error(describeDbError(pageResult.error));
      setFull({ ...page, ...(pageResult.data as PageRow) });
      const byLocale = Object.fromEntries(rows.map((row) => [row.locale, { title: row.title, excerpt: row.excerpt, content: row.content }]));
      setSaved(byLocale);
      setDraft(byLocale[targets[0]] || emptyFields);
    }).catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : String(loadError)); });
    return () => { active = false; };
    // targets is derived from the page and the settings, both fixed while this editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const current = saved[locale] || emptyFields;
  const dirty = draft.title !== current.title || draft.excerpt !== current.excerpt || draft.content !== current.content;
  const definition = localeDefinition(locale || base);

  const chooseLocale = (next: string) => {
    if (dirty && !window.confirm('Discard the unsaved changes to this translation?')) return;
    setLocale(next);
    setDraft(saved[next] || emptyFields);
    setFeedback('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      if (!draft.title.trim() && !draft.content.trim() && !draft.excerpt.trim()) {
        throw new Error('Everything is empty, so there is nothing to save. Use "Delete translation" to go back to the original.');
      }
      const row = await savePageTranslation(page.id, locale, draft);
      const fields = { title: row.title, excerpt: row.excerpt, content: row.content };
      setSaved((existing) => ({ ...existing, [locale]: fields }));
      setDraft(fields);
      onSaved(locale, true);
      setFeedback(`Saved the ${definition.name} version. Visitors see it the next time they load the page.`);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the ${definition.name} version of “${page.title}”? Visitors reading in ${definition.name} then see the original.`)) return;
    setBusy(true);
    setError('');
    try {
      await deletePageTranslation(page.id, locale);
      setSaved((existing) => {
        const next = { ...existing };
        delete next[locale];
        return next;
      });
      setDraft(emptyFields);
      onSaved(locale, false);
      setFeedback(`Deleted the ${definition.name} version.`);
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusy(false);
    }
  };

  if (!targets.length) {
    return (
      <div className={settingsStyles.warning} role="status">
        This page is written in {localeDefinition(base).name}, and both languages of the switch are {getPoSettings().languages.join(' and ')}.
        Choose a pair that includes another language under Appearance.
      </div>
    );
  }

  return (
    <form className={settingsStyles.form} onSubmit={(event) => void submit(event)}>
      <div className={styles.editorHead}>
        <div>
          <h3 className={styles.heading}>{page.title}</h3>
          <span className={settingsStyles.help}>
            Written in {localeDefinition(base).name}. <a href={`/${page.slug}?preview=1`} target="_blank" rel="noreferrer">View page ↗</a>
          </span>
        </div>
        {targets.length > 1 && (
          <label className={styles.inlineLabel}>
            Language
            <select value={locale} onChange={(event) => chooseLocale(event.target.value)}>
              {targets.map((code) => <option key={code} value={code}>{localeDefinition(code).name}{saved[code] ? ' ✓' : ''}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}
      {full?.is_builder_enabled && (
        <div className={settingsStyles.warning} role="status">
          This page is built with the Page Builder, so its body comes from the builder layout, not from the content below.
          Give it a {definition.name} layout in the Page Builder (its language button). The title and excerpt here still
          apply wherever the theme shows them, such as the blog feed.
        </div>
      )}

      <label>
        Title ({definition.name})
        <input value={draft.title} lang={locale} dir={definition.dir} maxLength={500} placeholder={full?.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        Excerpt ({definition.name})
        <textarea rows={3} value={draft.excerpt} lang={locale} dir={definition.dir} maxLength={5000} placeholder={full?.excerpt || ''}
          onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Content ({definition.name})</span>
        {/* Not inside a <label>: labels forward clicks to the editor's toolbar select. */}
        <div lang={locale} dir={definition.dir}>
          <ClassicEditor value={draft.content} onChange={(content) => setDraft((existing) => ({ ...existing, content }))} disabled={busy} />
        </div>
        <span className={settingsStyles.help}>Anything left empty shows the original. Shortcodes work as in the original.</span>
      </div>

      {full?.content && (
        <details className={styles.original}>
          <summary>Original ({localeDefinition(base).name})</summary>
          <div lang={base} dir={localeDefinition(base).dir}>
            <ContentRenderer html={full.content} applyContentFilters={false} />
          </div>
        </details>
      )}

      <div className={settingsStyles.actions}>
        <button type="submit" className={settingsStyles.saveButton} disabled={busy || !dirty}>{busy ? 'Saving…' : `Save ${definition.name} version`}</button>
        {saved[locale] && (
          <button type="button" className={settingsStyles.secondaryButton} disabled={busy} onClick={() => void remove()}>Delete translation</button>
        )}
      </div>
    </form>
  );
}

export default function ContentTab() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [index, setIndex] = useState<Map<number, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'posts' | 'pages' | 'missing'>('all');
  const [selected, setSelected] = useState<number | null>(requestedPageId);

  useEffect(() => {
    let active = true;
    Promise.all([fetchPages(), fetchTranslationIndex()])
      .then(([loadedPages, loadedIndex]) => {
        if (!active) return;
        setPages(loadedPages);
        setIndex(loadedIndex);
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : String(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const [, second] = getPoSettings().languages;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pages.filter((page) => {
      if (kind === 'posts' && !page.is_post) return false;
      if (kind === 'pages' && page.is_post) return false;
      if (kind === 'missing' && (index.get(page.id) || []).length) return false;
      return !term || `${page.title} ${page.slug}`.toLowerCase().includes(term);
    });
  }, [pages, index, search, kind]);

  const open = (id: number | null) => {
    setSelected(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set('page', String(id)); else params.delete('page');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const page = pages.find((item) => item.id === selected);

  if (loading) return <div className={settingsStyles.loading} role="status">Loading pages…</div>;

  return (
    <div className={styles.panel}>
      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}
      {page ? (
        <>
          <button type="button" className={styles.back} onClick={() => open(null)}>← All pages and posts</button>
          <Editor key={page.id} page={page} onSaved={(locale, exists) => setIndex((current) => {
            const next = new Map(current);
            const languages = (next.get(page.id) || []).filter((code) => code !== locale);
            next.set(page.id, exists ? [...languages, locale] : languages);
            return next;
          })} />
        </>
      ) : (
        <section className={settingsStyles.form} aria-label="Pages and posts">
          <div className={styles.filters}>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles…" aria-label="Search" />
            <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Show">
              <option value="all">Pages and posts</option>
              <option value="posts">Posts</option>
              <option value="pages">Pages</option>
              <option value="missing">Not translated yet</option>
            </select>
          </div>
          {visible.length === 0 ? <p className={settingsStyles.help}>Nothing matches.</p> : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Translations</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
                <tbody>
                  {visible.map((row) => {
                    const languages = index.get(row.id) || [];
                    return (
                      <tr key={row.id}>
                        <td><strong>{row.title}</strong><small> /{row.slug}</small></td>
                        <td>{row.is_post ? 'Post' : 'Page'}{row.is_builder_enabled ? ' · builder' : ''}</td>
                        <td>{row.status}</td>
                        <td>{languages.length ? languages.map((code) => localeDefinition(code).name).join(', ') : <span className={styles.missing}>{localeDefinition(second).name} missing</span>}</td>
                        <td><button type="button" className={styles.linkButton} onClick={() => open(row.id)}>Translate</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
