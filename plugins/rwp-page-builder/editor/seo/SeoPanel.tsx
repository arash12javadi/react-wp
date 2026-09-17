import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, CircleCheck, CircleMinus, CircleX, ClipboardList, RefreshCw, TriangleAlert } from 'lucide-react';
import MediaManager from '../../../../src/components/MediaManager';
import { fetchProfile } from '../../../../src/lib/profiles';
import { useEditor, useStore } from '../store';
import {
  DESCRIPTION_RANGE, TITLE_RANGE, categoryLabels, type FindingStatus, type SeoCategory, type SeoCheck, type SeoReport, type SeoStatus,
} from './seoAnalysis';
import { CHECKLIST_SETTING, keywordResearchTasks, outreachTasks, progress, readChecklist, type ChecklistTask } from './seoChecklists';
import { useSeoAnalyzer } from './useSeoAnalyzer';
import styles from './seo.module.css';

const statusLabels: Record<SeoStatus, string> = { pass: 'Passed', warning: 'Warning', fail: 'Failed', manual: 'To do', na: 'N/A' };
const ratingLabels: Record<SeoReport['rating'], string> = { good: 'Good', 'needs-work': 'Needs Work', poor: 'Poor' };

function StatusIcon({ status, size = 15 }: { status: SeoStatus | FindingStatus; size?: number }) {
  if (status === 'pass') return <CircleCheck size={size} className={styles.iconPass} aria-hidden="true" />;
  if (status === 'warning') return <TriangleAlert size={size} className={styles.iconWarning} aria-hidden="true" />;
  if (status === 'fail') return <CircleX size={size} className={styles.iconFail} aria-hidden="true" />;
  if (status === 'manual') return <ClipboardList size={size} className={styles.iconManual} aria-hidden="true" />;
  return <CircleMinus size={size} className={styles.iconMuted} aria-hidden="true" />;
}

function ScoreRing({ report }: { report: SeoReport }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`${styles.scoreCard} ${styles[`rating_${report.rating}`]}`}>
      <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`SEO score ${report.score} out of 100`}>
        <circle cx="42" cy="42" r={radius} className={styles.ringTrack} />
        <circle cx="42" cy="42" r={radius} className={styles.ringValue}
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - report.score / 100)} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" className={styles.ringText}>{report.score}</text>
      </svg>
      <div className={styles.scoreMeta}>
        <span className={styles.ratingBadge}>{ratingLabels[report.rating]}</span>
        <span className={styles.counts}>
          <span><StatusIcon status="pass" size={12} /> {report.counts.pass}</span>
          <span><StatusIcon status="warning" size={12} /> {report.counts.warning}</span>
          <span><StatusIcon status="fail" size={12} /> {report.counts.fail}</span>
        </span>
        <span className={styles.statLine}>
          {report.stats.words} words · {report.stats.readingMinutes} min read · {report.stats.density}% density
        </span>
      </div>
    </div>
  );
}

function Counter({ length, range }: { length: number; range: readonly [number, number] }) {
  const tone = length === 0 ? styles.counterBad : length < range[0] || length > range[1] ? styles.counterWarn : styles.counterGood;
  return <span className={`${styles.counter} ${tone}`}>{length} / {range[0]}–{range[1]}</span>;
}

/** Title, description and the search result preview. */
function SearchAppearance() {
  const { actions } = useStore();
  const seo = useEditor((state) => state.seo);
  const title = useEditor((state) => state.title);
  const slug = useEditor((state) => state.page.slug);
  const shownTitle = seo.seo_title.trim() || title;
  return (
    <div className={styles.fieldGroup}>
      <div className={styles.snippet} aria-label="Search result preview">
        <span className={styles.snippetUrl}>{window.location.host}/{slug}</span>
        <span className={styles.snippetTitle}>{shownTitle.length > TITLE_RANGE[1] ? `${shownTitle.slice(0, TITLE_RANGE[1] - 3)}…` : shownTitle || 'Untitled'}</span>
        <span className={styles.snippetDescription}>
          {seo.meta_description.trim()
            ? (seo.meta_description.length > DESCRIPTION_RANGE[1] ? `${seo.meta_description.slice(0, DESCRIPTION_RANGE[1] - 3)}…` : seo.meta_description)
            : 'No meta description. Search engines will pick text from the page.'}
        </span>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>SEO title <Counter length={shownTitle.length} range={TITLE_RANGE} /></span>
        <input className={styles.input} value={seo.seo_title} placeholder={title} onChange={(event) => actions.setSeoField('seo_title', event.target.value)} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Meta description <Counter length={seo.meta_description.trim().length} range={DESCRIPTION_RANGE} /></span>
        <textarea className={styles.input} rows={3} value={seo.meta_description}
          placeholder="A short summary shown under the title in search results"
          onChange={(event) => actions.setSeoField('meta_description', event.target.value)} />
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={seo.noindex} onChange={(event) => actions.setSeoField('noindex', event.target.checked)} />
        Ask search engines not to index this page
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Canonical URL</span>
        <input className={styles.input} value={seo.canonical_url} placeholder={`${window.location.origin}/${slug}`}
          onChange={(event) => actions.setSeoField('canonical_url', event.target.value)} />
        <span className={styles.help}>Leave empty to use this page's own address.</span>
      </label>
    </div>
  );
}

/** Open Graph fields with a share card preview, shown inside the Social sharing check. */
function SocialEditor() {
  const { actions } = useStore();
  const seo = useEditor((state) => state.seo);
  const title = useEditor((state) => state.title);
  const [picking, setPicking] = useState(false);
  const shareTitle = seo.og_title.trim() || seo.seo_title.trim() || title;
  const shareDescription = seo.og_description.trim() || seo.meta_description.trim();
  return (
    <div className={styles.fieldGroup}>
      <div className={styles.shareCard} aria-label="Social share preview">
        {seo.og_image
          ? <img src={seo.og_image} alt="" className={seo.twitter_card === 'summary' ? styles.shareImageSmall : styles.shareImage} />
          : <div className={styles.shareImageEmpty}>No social image</div>}
        <div className={styles.shareText}>
          <span className={styles.shareHost}>{window.location.host}</span>
          <strong>{shareTitle || 'Untitled'}</strong>
          {shareDescription && <span>{shareDescription.slice(0, 110)}{shareDescription.length > 110 ? '…' : ''}</span>}
        </div>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>OG title</span>
        <input className={styles.input} value={seo.og_title} placeholder={seo.seo_title || title} onChange={(event) => actions.setSeoField('og_title', event.target.value)} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>OG description</span>
        <textarea className={styles.input} rows={2} value={seo.og_description} placeholder={seo.meta_description}
          onChange={(event) => actions.setSeoField('og_description', event.target.value)} />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Share image (Open Graph & Twitter)</span>
        <div className={styles.imageRow}>
          <button type="button" className={styles.smallButton} onClick={() => setPicking(true)}>{seo.og_image ? 'Replace image' : 'Choose image'}</button>
          {seo.og_image && <button type="button" className={styles.ghostButton} onClick={() => actions.setSeoField('og_image', '')}>Remove</button>}
        </div>
        <span className={styles.help}>1200 × 630 px works for most networks.</span>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Twitter card</span>
        <select className={styles.input} value={seo.twitter_card} onChange={(event) => actions.setSeoField('twitter_card', event.target.value)}>
          <option value="summary_large_image">Large image</option>
          <option value="summary">Small image (summary)</option>
        </select>
      </label>
      {picking && (
        <MediaManager heading="Choose a social share image" onClose={() => setPicking(false)}
          onSelect={(item) => { actions.setSeoField('og_image', item.url); setPicking(false); }} />
      )}
    </div>
  );
}

/** Tickable task cards. Ticks save with the page (doc.settings.seoChecklist) and can be undone. */
function TaskChecklist({ title, tasks }: { title: string; tasks: ChecklistTask[] }) {
  const { actions } = useStore();
  const settings = useEditor((state) => state.doc.settings);
  const state = readChecklist(settings as Record<string, unknown>);
  const done = progress(tasks, state);
  const toggle = (id: string, value: boolean) => {
    const next = { ...state, [id]: value };
    if (!value) delete next[id];
    actions.setDocumentSetting(CHECKLIST_SETTING, next);
  };
  return (
    <div className={styles.taskList}>
      <div className={styles.taskHead}>
        <span>{title}</span>
        <span className={styles.taskProgress}>{done}/{tasks.length}</span>
      </div>
      <div className={styles.progressBar} aria-hidden="true"><span style={{ width: `${(done / tasks.length) * 100}%` }} /></div>
      {tasks.map((task) => (
        <label key={task.id} className={state[task.id] ? styles.taskDone : styles.task}>
          <input type="checkbox" checked={Boolean(state[task.id])} onChange={(event) => toggle(task.id, event.target.checked)} />
          <span>
            <strong>{task.label}</strong>
            <small>{task.help}</small>
            {task.link && <a href={task.link.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{task.link.label} ↗</a>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Links to Google's validators, and a ready-to-paste Article JSON-LD built from this page. */
function SchemaTools() {
  const page = useEditor((state) => state.page);
  const seo = useEditor((state) => state.seo);
  const title = useEditor((state) => state.title);
  const [author, setAuthor] = useState('');
  const [copied, setCopied] = useState('');
  const liveUrl = `${window.location.origin}/${page.slug}`;
  const published = page.status === 'published';

  useEffect(() => {
    if (!page.author_id) return undefined;
    let active = true;
    void fetchProfile(page.author_id).then((profile) => {
      if (active) setAuthor(profile?.display_name || profile?.email?.split('@')[0] || '');
    }).catch(() => {});
    return () => { active = false; };
  }, [page.author_id]);

  const article = {
    '@context': 'https://schema.org',
    '@type': page.is_post ? 'BlogPosting' : 'Article',
    headline: (seo.seo_title.trim() || title).slice(0, 110),
    description: seo.meta_description.trim() || undefined,
    image: seo.og_image.trim() || undefined,
    author: { '@type': 'Person', name: author || 'Author name' },
    datePublished: page.created_at,
    dateModified: page.updated_at,
    mainEntityOfPage: { '@type': 'WebPage', '@id': liveUrl },
  };
  const snippet = `<script type="application/ld+json">\n${JSON.stringify(article, null, 2).replace(/</g, '\\u003c')}\n</script>`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      window.prompt('Copy this code', text);
    }
  };

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.imageRow}>
        <a className={styles.smallButton} target="_blank" rel="noopener noreferrer"
          href={published ? `https://search.google.com/test/rich-results?url=${encodeURIComponent(liveUrl)}` : 'https://search.google.com/test/rich-results'}
          title={published ? 'Tests the live, rendered page' : 'Drafts are not public: choose "Code" in the tool and paste the schema'}>
          Rich Results Test ↗
        </a>
        <a className={styles.smallButton} target="_blank" rel="noopener noreferrer" href="https://validator.schema.org/">Schema validator ↗</a>
      </div>
      <button type="button" className={styles.smallButton} onClick={() => void copy(snippet, 'article')}>
        {copied === 'article' ? 'Copied ✓' : `Copy ${article['@type']} schema`}
      </button>
      <span className={styles.help}>
        Paste it into a Custom HTML widget (administrators only){author ? '' : ', and replace "Author name"'}. FAQ schema is a switch on the Accordion widget; breadcrumb schema is on the Breadcrumbs widget.
      </span>
    </div>
  );
}

function CheckItem({ check }: { check: SeoCheck }) {
  const [open, setOpen] = useState(check.id === 'social' ? false : check.status === 'fail');
  return (
    <li className={styles.check}>
      <button type="button" className={styles.checkHead} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <StatusIcon status={check.status} />
        <span className={styles.checkTitle}>
          <strong>{check.title}</strong>
          <small>{check.summary}</small>
        </span>
        <span className={`${styles.badge} ${styles[`badge_${check.status}`]}`}>{statusLabels[check.status]}</span>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div className={styles.checkBody}>
          {check.findings.length > 0 && (
            <ul className={styles.findings}>
              {check.findings.map((finding, index) => (
                <li key={index} className={finding.status === 'info' ? styles.findingInfo : undefined}>
                  {finding.status === 'info' ? <span className={styles.infoDot} aria-hidden="true" /> : <StatusIcon status={finding.status} size={13} />}
                  <span>{finding.text}</span>
                </li>
              ))}
            </ul>
          )}
          {check.manual && check.manual.length > 0 && (
            <div className={styles.manual}>
              <span><ClipboardList size={12} aria-hidden="true" /> Check outside the editor</span>
              <ul>{check.manual.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {check.id === 'social' && <SocialEditor />}
          {check.id === 'keywords' && <TaskChecklist title="Keyword research" tasks={keywordResearchTasks} />}
          {check.id === 'build-backlink' && <TaskChecklist title="Outreach & promotion" tasks={outreachTasks} />}
          {check.id === 'structured-data' && <SchemaTools />}
        </div>
      )}
    </li>
  );
}

function CategorySection({ category, checks, defaultOpen }: { category: SeoCategory; checks: SeoCheck[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const count = (status: SeoStatus) => checks.filter((check) => check.status === status).length;
  return (
    <section className={styles.category}>
      <button type="button" className={styles.categoryHead} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        <span className={styles.categoryTitle}>{categoryLabels[category]}</span>
        <span className={styles.categoryCounts}>
          {count('fail') > 0 && <span className={`${styles.badge} ${styles.badge_fail}`}>{count('fail')}</span>}
          {count('warning') > 0 && <span className={`${styles.badge} ${styles.badge_warning}`}>{count('warning')}</span>}
          {count('pass') > 0 && <span className={`${styles.badge} ${styles.badge_pass}`}>{count('pass')}</span>}
        </span>
      </button>
      {open && <ul className={styles.checkList}>{checks.map((check) => <CheckItem key={check.id} check={check} />)}</ul>}
    </section>
  );
}

export default function SeoPanel() {
  const { actions } = useStore();
  const keyword = useEditor((state) => state.seo.focus_keyword);
  const isTemplate = useEditor((state) => Boolean(state.page.is_site_template));
  const updatedAt = useEditor((state) => state.page.updated_at);
  const seoDirty = useEditor((state) => state.seo !== state.savedSeo);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { report, refresh } = useSeoAnalyzer();

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3>SEO</h3>
        <button type="button" className={styles.iconButton} onClick={refresh} title="Run the analysis again" aria-label="Run the SEO analysis again">
          <RefreshCw size={14} />
        </button>
      </div>

      {isTemplate && <p className={styles.notice}>This is a site template. Its content is shared by many pages, so page-level SEO scores are only a rough guide here.</p>}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Focus keyword</span>
        <input className={styles.input} value={keyword} placeholder="The phrase this page should rank for"
          onChange={(event) => actions.setSeoField('focus_keyword', event.target.value)} />
      </label>

      {report ? <ScoreRing report={report} /> : <p className={styles.help}>Analyzing the page…</p>}

      <section className={styles.category}>
        <button type="button" className={styles.categoryHead} aria-expanded={appearanceOpen} onClick={() => setAppearanceOpen((value) => !value)}>
          {appearanceOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          <span className={styles.categoryTitle}>Search appearance</span>
        </button>
        {appearanceOpen && <div className={styles.categoryBody}><SearchAppearance /></div>}
      </section>

      {report && (['critical', 'high', 'medium'] as SeoCategory[]).map((category) => (
        <CategorySection key={category} category={category} defaultOpen={category === 'critical'}
          checks={report.checks.filter((check) => check.category === category)} />
      ))}

      <p className={`${styles.help} content-updates-date`} data-content-updates-date={updatedAt}>
        Content last updated {new Date(updatedAt).toLocaleString()}
        {report ? ` · analysed ${new Date(report.analyzedAt).toLocaleTimeString()} (${report.device} preview)` : ''}
      </p>
      {seoDirty && <p className={styles.unsaved}>SEO changes are saved with the page (Publish / Update / Save draft).</p>}
      <p className={styles.help}>
        Checks run on the canvas as it renders. They are guidelines, not ranking guarantees. N/A checks, task checklists and the “Check outside the editor” notes are not scored.
      </p>
    </div>
  );
}
