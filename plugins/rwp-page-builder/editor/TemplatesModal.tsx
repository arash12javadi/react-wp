import { useEffect, useMemo, useState } from 'react';
import { createTemplate, deleteTemplate, listTemplates } from '../lib/api';
import { findNode } from '../lib/tree';
import type { BuilderTemplate, SectionNode } from '../lib/types';
import Modal from './Modal';
import { createSection, createWidget, useEditor, useStore } from './store';
import styles from './editor.module.css';

export type TemplatesModalMode = { kind: 'insert' } | { kind: 'save-section'; nodeId: string } | { kind: 'save-page' };

/** Pre-designed blocks that ship with the plugin, built from the same factories as the editor. */
function starterBlocks(): Array<{ id: string; title: string; description: string; build: () => SectionNode[] }> {
  const widget = (type: string, settings: Record<string, unknown> = {}, style: Record<string, unknown> = {}) => {
    const node = createWidget(type);
    node.settings = { ...node.settings, ...settings };
    node.style = { desktop: { ...node.style.desktop, ...style } };
    return node;
  };
  return [
    {
      id: 'hero', title: 'Hero', description: 'Big headline, supporting text and a button on a dark background.',
      build: () => {
        const section = createSection([100]);
        section.style.desktop = { padding: { top: 120, bottom: 120, unit: 'px' }, background: { color: 'global:secondary' }, heightMode: 'min', minHeight: { size: 70, unit: 'vh' }, contentPosition: 'middle' };
        section.style.mobile = { padding: { top: 64, bottom: 64, left: 20, right: 20, unit: 'px' } };
        section.children[0].children = [
          widget('heading', { title: 'Build something people love', tag: 'h1' }, { align: 'center', color: '#ffffff', typography: { size: 56, weight: '800' } }),
          widget('text', { html: '<p>A short, benefit-led sentence that explains what you offer and who it is for.</p>' }, { align: 'center', color: 'rgba(255,255,255,0.8)', typography: { size: 20 } }),
          widget('button', { text: 'Get started', size: 'lg', link: { url: '#' } }, { align: 'center' }),
        ];
        section.children[0].children[0].style.mobile = { typography: { size: 36 } };
        return [section];
      },
    },
    {
      id: 'features', title: 'Three features', description: 'Icon boxes in three columns.',
      build: () => {
        const section = createSection([33.333, 33.333, 33.334]);
        section.style.desktop = { padding: { top: 80, bottom: 80, unit: 'px' }, gap: 32 };
        const items = [['zap', 'Fast'], ['shield-check', 'Secure'], ['smile', 'Friendly']];
        section.children.forEach((column, index) => {
          column.children = [widget('icon-box', { icon: items[index][0], title: items[index][1] })];
        });
        return [section];
      },
    },
    {
      id: 'faq', title: 'FAQ', description: 'Heading and an accordion with FAQ schema.',
      build: () => {
        const section = createSection([100]);
        section.style.desktop = { padding: { top: 80, bottom: 80, unit: 'px' }, contentWidth: 800 };
        section.children[0].children = [
          widget('heading', { title: 'Frequently asked questions', tag: 'h2' }, { align: 'center' }),
          widget('accordion', { faqSchema: true }),
        ];
        return [section];
      },
    },
    {
      id: 'contact', title: 'Contact', description: 'Text on the left, a contact form on the right.',
      build: () => {
        const section = createSection([40, 60]);
        section.style.desktop = { padding: { top: 80, bottom: 80, unit: 'px' }, gap: 48, background: { color: '#f8fafc' } };
        section.children[0].children = [
          widget('heading', { title: 'Get in touch', tag: 'h2' }),
          widget('text', { html: '<p>Tell us about your project and we will reply within one business day.</p>' }),
        ];
        section.children[1].children = [widget('form')];
        return [section];
      },
    },
    {
      id: 'blog', title: 'Latest posts', description: 'Heading and a three-column posts grid.',
      build: () => {
        const section = createSection([100]);
        section.style.desktop = { padding: { top: 80, bottom: 80, unit: 'px' } };
        section.children[0].children = [widget('heading', { title: 'From the blog', tag: 'h2' }), widget('posts', { limit: 3 })];
        return [section];
      },
    },
    {
      id: 'cta', title: 'Call to action', description: 'A full-width banner with a button.',
      build: () => {
        const section = createSection([100]);
        section.style.desktop = { padding: { top: 40, bottom: 40, unit: 'px' } };
        section.children[0].children = [widget('cta')];
        return [section];
      },
    },
  ];
}

export default function TemplatesModal({ mode, onClose }: { mode: TemplatesModalMode; onClose: () => void }) {
  const store = useStore();
  const { actions } = store;
  const title = useEditor((state) => state.title);
  const [templates, setTemplates] = useState<BuilderTemplate[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => {
    if (mode.kind === 'save-page') return title;
    if (mode.kind === 'save-section') return findNode(store.getState().doc, mode.nodeId)?.label || 'My section';
    return '';
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [tab, setTab] = useState<'blocks' | 'saved'>('blocks');
  const blocks = useMemo(starterBlocks, []);

  useEffect(() => {
    if (mode.kind !== 'insert') return;
    listTemplates().then(setTemplates).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load templates.'));
  }, [mode.kind]);

  const insert = (sections: SectionNode[]) => {
    actions.insertSections(sections);
    onClose();
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const state = store.getState();
      if (mode.kind === 'save-section') {
        const node = findNode(state.doc, mode.nodeId);
        if (!node || node.kind !== 'section') throw new Error('Only sections can be saved as section templates.');
        await createTemplate(name, 'section', [node]);
      } else {
        if (!state.doc.content.length) throw new Error('The page is empty, so there is nothing to save.');
        await createTemplate(name, 'page', state.doc.content);
      }
      setDone(`Saved “${name}”. Find it under Templates → Saved templates.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Saving the template failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (template: BuilderTemplate) => {
    if (!window.confirm(`Delete the template “${template.title}”? Pages that used it are not affected.`)) return;
    try {
      await deleteTemplate(template.id);
      setTemplates((current) => (current || []).filter((item) => item.id !== template.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed.');
    }
  };

  if (mode.kind !== 'insert') {
    return (
      <Modal title={mode.kind === 'save-page' ? 'Save page as template' : 'Save section as template'} onClose={onClose}>
        {done ? (
          <>
            <p className={styles.successText} role="status">{done}</p>
            <div className={styles.buttonRow}><button type="button" className={styles.primaryButton} onClick={onClose}>Close</button></div>
          </>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void save(); }} className={styles.stack}>
            <label className={styles.miniField}><span>Template name</span><input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} autoFocus required /></label>
            <p className={styles.hint}>Templates are shared with everyone who can use the builder. Form email recipients are not included.</p>
            {error && <p className={styles.errorText} role="alert">{error}</p>}
            <div className={styles.buttonRow}>
              <button type="submit" className={styles.primaryButton} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save template'}</button>
              <button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Templates" onClose={onClose} wide>
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'blocks'} className={tab === 'blocks' ? styles.tabActive : styles.tab} onClick={() => setTab('blocks')}>Blocks</button>
        <button type="button" role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? styles.tabActive : styles.tab} onClick={() => setTab('saved')}>Saved templates{templates ? ` (${templates.length})` : ''}</button>
      </div>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
      {tab === 'blocks' ? (
        <div className={styles.templateGrid}>
          {blocks.map((block) => (
            <article key={block.id} className={styles.templateCard}>
              <h3>{block.title}</h3>
              <p>{block.description}</p>
              <button type="button" className={styles.primaryButton} onClick={() => insert(block.build())}>Insert</button>
            </article>
          ))}
        </div>
      ) : (
        <>
          {!templates && !error && <p className={styles.hint}>Loading templates…</p>}
          {templates?.length === 0 && <p className={styles.hint}>No saved templates yet. Use “Save as template” on a section, or “Save page as template” in the Publish menu.</p>}
          <div className={styles.templateGrid}>
            {(templates || []).map((template) => {
              const sections = Array.isArray(template.builder_data?.content) ? template.builder_data.content : [];
              return (
                <article key={template.id} className={styles.templateCard}>
                  <span className={styles.templateType}>{template.type === 'page' ? 'Page' : 'Section'}</span>
                  <h3>{template.title}</h3>
                  <p>{sections.length} section{sections.length === 1 ? '' : 's'} · updated {new Date(template.updated_at).toLocaleDateString()}</p>
                  <div className={styles.buttonRow}>
                    <button type="button" className={styles.primaryButton} disabled={!sections.length} onClick={() => insert(sections)}>Insert</button>
                    <button type="button" className={styles.smallButtonGhost} onClick={() => void remove(template)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      <p className={styles.hint}>Inserted blocks get new ids, so they can be edited without affecting the template.</p>
    </Modal>
  );
}
