import { useMemo, useState } from 'react';
import { analyzeSeo, metaDescriptionLimit, seoScore, seoTitleLimit } from '../lib/seo';
import { makeExcerpt } from '../lib/excerpt';
import MediaManager from './MediaManager';
import styles from './SeoPanel.module.css';

export interface SeoFields {
  seo_title: string;
  meta_description: string;
  focus_keyword: string;
  canonical_url: string;
  noindex: boolean;
  og_title: string;
  og_description: string;
  og_image: string;
  twitter_card: string;
}

interface SeoPanelProps {
  fields: SeoFields;
  onChange: <K extends keyof SeoFields>(key: K, value: SeoFields[K]) => void;
  title: string;
  slug: string;
  content: string;
  siteTitle: string;
}

type Tab = 'search' | 'social' | 'advanced';

const scoreLabel = (score: number) => (score >= 80 ? 'Good' : score >= 50 ? 'Needs work' : 'Poor');
const scoreClass = (score: number) => (score >= 80 ? styles.scoreGood : score >= 50 ? styles.scoreWarn : styles.scoreBad);

export default function SeoPanel({ fields, onChange, title, slug, content, siteTitle }: SeoPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('search');
  const [pickingImage, setPickingImage] = useState(false);

  const checks = useMemo(
    () => analyzeSeo({ title, slug, content, ...fields }),
    [content, fields, slug, title],
  );
  const score = seoScore(checks);

  const previewTitle = fields.seo_title.trim() || (title ? `${title} — ${siteTitle}` : siteTitle);
  const previewDescription = fields.meta_description.trim()
    || makeExcerpt(content, 30)
    || 'No meta description yet. Search engines will generate one from the page text.';

  return (
    <section className={styles.panel} aria-labelledby="seo-heading">
      <button type="button" className={styles.summary} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span id="seo-heading">Search engine optimisation</span>
        <span className={`${styles.score} ${scoreClass(score)}`}>{score}/100 · {scoreLabel(score)}</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={styles.body}>
          <div className={styles.tabs} role="tablist" aria-label="SEO sections">
            {([['search', 'Search'], ['social', 'Social'], ['advanced', 'Advanced']] as Array<[Tab, string]>).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={tab === id ? styles.tabActive : styles.tab} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {tab === 'search' && (
            <>
              <div className={styles.preview} aria-label="Google result preview">
                <span className={styles.previewUrl}>{`/${slug || 'your-slug'}`}</span>
                <span className={styles.previewTitle}>{previewTitle}</span>
                <span className={styles.previewDescription}>{previewDescription}</span>
              </div>

              <label>
                Focus keyword
                <input value={fields.focus_keyword} onChange={(event) => onChange('focus_keyword', event.target.value)}
                  placeholder="The phrase you want this page to rank for" />
              </label>

              <label>
                SEO title
                <input value={fields.seo_title} onChange={(event) => onChange('seo_title', event.target.value)}
                  placeholder={previewTitle} />
                <span className={fields.seo_title.length > seoTitleLimit ? styles.counterOver : styles.counter}>
                  {fields.seo_title.length} / {seoTitleLimit}
                </span>
              </label>

              <label>
                Meta description
                <textarea rows={3} value={fields.meta_description}
                  onChange={(event) => onChange('meta_description', event.target.value)}
                  placeholder="A short summary shown under the title in search results" />
                <span className={fields.meta_description.length > metaDescriptionLimit ? styles.counterOver : styles.counter}>
                  {fields.meta_description.length} / {metaDescriptionLimit}
                </span>
              </label>

              <ul className={styles.checks}>
                {checks.map((check) => (
                  <li key={check.id}>
                    <span className={`${styles.dot} ${check.status === 'good' ? styles.dotGood : check.status === 'warn' ? styles.dotWarn : styles.dotBad}`} aria-hidden="true" />
                    <span>{check.label}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.note}>These checks are heuristics, not guarantees. Treat them as a checklist, not a score to chase.</p>
            </>
          )}

          {tab === 'social' && (
            <>
              <label>
                Social title
                <input value={fields.og_title} onChange={(event) => onChange('og_title', event.target.value)}
                  placeholder={previewTitle} />
              </label>
              <label>
                Social description
                <textarea rows={3} value={fields.og_description}
                  onChange={(event) => onChange('og_description', event.target.value)} placeholder={previewDescription} />
              </label>
              <label>
                Social image
                <span className={styles.imageRow}>
                  {fields.og_image && <img className={styles.imagePreview} src={fields.og_image} alt="" />}
                  <input value={fields.og_image} onChange={(event) => onChange('og_image', event.target.value)}
                    placeholder="https://example.com/share-image.jpg" />
                  <button type="button" className={styles.secondary} onClick={() => setPickingImage(true)}>Choose</button>
                </span>
                <span className={styles.counter}>1200 × 630 is the usual size for link previews.</span>
              </label>
              <label>
                Twitter card
                <select value={fields.twitter_card} onChange={(event) => onChange('twitter_card', event.target.value)}>
                  <option value="summary_large_image">Large image</option>
                  <option value="summary">Summary</option>
                </select>
              </label>
            </>
          )}

          {tab === 'advanced' && (
            <>
              <label>
                Canonical URL
                <input value={fields.canonical_url} onChange={(event) => onChange('canonical_url', event.target.value)}
                  placeholder="Leave empty to use this page's own URL" />
                <span className={styles.counter}>Set this only when this content also lives at another address.</span>
              </label>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={fields.noindex}
                  onChange={(event) => onChange('noindex', event.target.checked)} />
                Ask search engines not to index this page
              </label>
            </>
          )}
        </div>
      )}

      {pickingImage && (
        <MediaManager
          heading="Choose a social image"
          onClose={() => setPickingImage(false)}
          onSelect={(item) => {
            onChange('og_image', item.url);
            setPickingImage(false);
          }}
        />
      )}
    </section>
  );
}
