import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { findNode } from '../../lib/tree';
import type { SectionNode } from '../../lib/types';
import {
  describeSection, extractSectionCopy, optimizeSection, previewText,
  type CopyChange, type OptimizePreset, type OptimizeResult, type OptimizeTone,
} from '../../services/geminiSectionOpt';
import Modal from '../Modal';
import { useEditor, useStore } from '../store';
import editorStyles from '../editor.module.css';
import styles from './sectionAi.module.css';

const presets: Array<{ id: OptimizePreset; icon: string; label: string; help: string }> = [
  { id: 'seo', icon: '🎯', label: 'Improve Copy & SEO', help: 'Readable copy that uses the focus keyword naturally.' },
  { id: 'cta', icon: '⚡', label: 'Strengthen CTA', help: 'Action verbs and benefit-led buttons that convert.' },
  { id: 'shorten', icon: '✂️', label: 'Shorten & Simplify', help: 'Punchy, modern, fewer words.' },
  { id: 'tone', icon: '💬', label: 'Adjust Tone', help: 'Rewrite in a different voice.' },
];

const tones: Array<{ id: OptimizeTone; label: string }> = [
  { id: 'professional', label: 'Professional' },
  { id: 'casual', label: 'Casual' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'persuasive', label: 'Persuasive' },
];

type Part = { kind: 'same' | 'added' | 'removed'; text: string };

/** Word-level diff (longest common subsequence). Long texts fall back to a plain before/after. */
function diffWords(before: string, after: string): { left: Part[]; right: Part[] } {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 250_000) return { left: [{ kind: 'removed', text: before }], right: [{ kind: 'added', text: after }] };
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const left: Part[] = [];
  const right: Part[] = [];
  const push = (list: Part[], kind: Part['kind'], text: string) => {
    const last = list[list.length - 1];
    if (last && last.kind === kind) last.text += text; else list.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push(left, 'same', a[i]); push(right, 'same', b[j]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push(left, 'removed', a[i]); i += 1; }
    else { push(right, 'added', b[j]); j += 1; }
  }
  while (i < a.length) { push(left, 'removed', a[i]); i += 1; }
  while (j < b.length) { push(right, 'added', b[j]); j += 1; }
  return { left, right };
}

function Diff({ change }: { change: CopyChange }) {
  const { left, right } = useMemo(() => diffWords(previewText(change), previewText(change, change.after)), [change]);
  const render = (parts: Part[]) => parts.map((part, index) => (
    <span key={index} className={part.kind === 'added' ? styles.added : part.kind === 'removed' ? styles.removed : undefined}>{part.text}</span>
  ));
  return (
    <div className={styles.diff}>
      <div><span className={styles.diffLabel}>Original</span><p>{render(left)}</p></div>
      <div><span className={styles.diffLabel}>AI optimized</span><p>{render(right)}</p></div>
    </div>
  );
}

export default function SectionAiModal({ sectionId, onClose }: { sectionId: string; onClose: () => void }) {
  const { actions, getState } = useStore();
  const section = useEditor((state) => findNode(state.doc, sectionId)) as SectionNode | null;
  const focusKeyword = useEditor((state) => state.seo.focus_keyword);
  const [preset, setPreset] = useState<OptimizePreset | null>('seo');
  const [tone, setTone] = useState<OptimizeTone>('professional');
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  // Computed from the section as it was when the window opened plus live edits; cheap for one section.
  const overview = useMemo(() => (section ? describeSection(getState().doc, section) : null), [section, getState]);
  const copy = useMemo(() => (section ? extractSectionCopy(section) : []), [section]);

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const state = getState();
      const next = await optimizeSection({
        doc: state.doc, sectionId, focusKeyword, preset, tone: preset === 'tone' ? tone : null,
        customPrompt, pageTitle: state.seo.seo_title || state.title,
      });
      setResult(next);
      setChosen(new Set(next.changes.map((change) => change.id)));
      if (!next.changes.length) setError('The AI suggested no changes for this section. Try another preset or a more specific instruction.');
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'The AI request failed.');
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!result) return;
    const selected = result.changes.filter((change) => chosen.has(change.id));
    const { applied, stale } = actions.applySectionCopy(selected);
    if (stale && !applied) {
      setError('Nothing was applied: every selected field was edited after the AI read it. Generate again.');
      return;
    }
    if (stale) window.alert(`${applied} change(s) applied. ${stale} field(s) were edited after the AI read them and were left as they are.`);
    onClose();
  };

  if (!section || !overview) {
    return (
      <Modal title="AI Section Refine" onClose={onClose}>
        <p className={editorStyles.errorText}>This section no longer exists.</p>
      </Modal>
    );
  }

  const toggle = (id: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Modal title="✨ AI Section Refine" onClose={onClose} wide>
      <div className={styles.layout}>
        <section className={styles.overview} aria-label="Selected section">
          <div className={styles.overviewHead}>
            <span className={styles.kind}>{overview.kind}</span>
            <span className={styles.meta}>{overview.columns} column{overview.columns === 1 ? '' : 's'} · {overview.position}</span>
          </div>
          <p className={styles.meta}>{overview.widgets.join(', ') || 'No widgets'}</p>
          {copy.length ? (
            <ul className={styles.preview}>
              {copy.slice(0, 4).map((item) => (
                <li key={item.id}><small>{item.field}</small><span>{previewText(item).slice(0, 140)}{previewText(item).length > 140 ? '…' : ''}</span></li>
              ))}
              {copy.length > 4 && <li className={styles.meta}>…and {copy.length - 4} more text field(s)</li>}
            </ul>
          ) : (
            <p className={editorStyles.warning}>This section has no editable text (only images, spacers, Custom HTML or dynamic content).</p>
          )}
        </section>

        <section className={styles.controls} aria-label="Optimization options">
          <div className={styles.presets} role="radiogroup" aria-label="Preset">
            {presets.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={preset === item.id}
                className={preset === item.id ? styles.presetActive : styles.preset}
                onClick={() => setPreset(preset === item.id ? null : item.id)}>
                <span className={styles.presetIcon} aria-hidden="true">{item.icon}</span>
                <strong>{item.label}</strong>
                <small>{item.help}</small>
              </button>
            ))}
          </div>
          {preset === 'tone' && (
            <div className={styles.tones} role="radiogroup" aria-label="Tone">
              {tones.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={tone === item.id}
                  className={tone === item.id ? styles.toneActive : styles.tone} onClick={() => setTone(item.id)}>{item.label}</button>
              ))}
            </div>
          )}
          <label className={styles.field}>
            <span>✍️ Custom instruction {preset ? '(optional)' : ''}</span>
            <textarea className={editorStyles.input} rows={2} maxLength={500} value={customPrompt}
              placeholder='e.g. "Make this section sound like an Apple product launch"'
              onChange={(event) => setCustomPrompt(event.target.value)} />
          </label>
          <p className={styles.meta}>
            {focusKeyword.trim() ? <>Focus keyword: <strong>{focusKeyword}</strong> (from the SEO tab).</> : 'No focus keyword set in the SEO tab; the SEO preset will focus on readability.'}
          </p>
          <div className={styles.actions}>
            <button type="button" className={editorStyles.primaryButton} disabled={loading || !copy.length || (!preset && !customPrompt.trim())} onClick={() => void generate()}>
              <Sparkles size={14} aria-hidden="true" /> {loading ? 'Generating…' : result ? 'Regenerate' : 'Generate suggestions'}
            </button>
            <span className={styles.meta}>Only this section’s text is sent to Google Gemini. Links, images, layout and settings are never changed.</span>
          </div>
        </section>

        {error && <p className={editorStyles.errorText} role="alert">{error}</p>}
        {loading && <p className={styles.loading} role="status">Asking Gemini to rewrite {copy.length} text field(s)…</p>}

        {result && result.changes.length > 0 && !loading && (
          <section className={styles.results} aria-label="Suggested changes">
            <div className={styles.resultsHead}>
              <div>
                <strong>{result.changes.length} suggested change{result.changes.length === 1 ? '' : 's'}</strong>
                {result.summary && <p className={styles.meta}>{result.summary}</p>}
              </div>
              <div className={styles.selectButtons}>
                <button type="button" onClick={() => setChosen(new Set(result.changes.map((change) => change.id)))}>Select all</button>
                <button type="button" onClick={() => setChosen(new Set())}>None</button>
              </div>
            </div>
            {result.rejected.length > 0 && (
              <p className={editorStyles.warning}>
                Kept the original for {result.rejected.map((entry) => `“${entry.field}” (${entry.reason})`).join(', ')}.
              </p>
            )}
            <ul className={styles.changeList}>
              {result.changes.map((change) => (
                <li key={change.id} className={chosen.has(change.id) ? styles.changeChosen : styles.change}>
                  <label className={styles.changeHead}>
                    <input type="checkbox" checked={chosen.has(change.id)} onChange={() => toggle(change.id)} />
                    <span>{change.widget}</span>
                    <small>{change.field}</small>
                  </label>
                  <Diff change={change} />
                </li>
              ))}
            </ul>
            <div className={styles.applyBar}>
              <span className={styles.meta}>Applied as one step: Ctrl+Z undoes it. {result.model && `Model: ${result.model}.`}</span>
              <button type="button" className={editorStyles.secondaryButton} onClick={onClose}>Cancel</button>
              <button type="button" className={editorStyles.primaryButton} disabled={!chosen.size} onClick={apply}>
                Apply to Section ({chosen.size})
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
