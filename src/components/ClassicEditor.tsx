import { useEffect, useRef, useState } from 'react';
import styles from './ClassicEditor.module.css';

interface ClassicEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

type Command = 'bold' | 'italic' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList' |
  'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'justifyFull' | 'removeFormat' | 'unlink';

const textFromHtml = (html: string) => {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent || '';
};

export default function ClassicEditor({ value, onChange, placeholder, disabled = false }: ClassicEditorProps) {
  const visualRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [mode, setMode] = useState<'visual' | 'text'>('visual');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkText, setLinkText] = useState('');
  const [newTab, setNewTab] = useState(false);
  const [wordCount, setWordCount] = useState(0);

  useEffect(() => {
    if (mode === 'visual' && visualRef.current && visualRef.current.innerHTML !== value) {
      visualRef.current.innerHTML = value;
    }
    const text = textFromHtml(value).trim();
    setWordCount(text ? text.split(/\s+/).length : 0);
  }, [mode, value]);

  const emitVisualChange = () => {
    const html = visualRef.current?.innerHTML || '';
    onChange(html);
    const text = visualRef.current?.textContent?.trim() || '';
    setWordCount(text ? text.split(/\s+/).length : 0);
  };

  const focusEditor = () => visualRef.current?.focus();
  const run = (command: Command, argument?: string) => {
    focusEditor();
    document.execCommand(command, false, argument);
    emitVisualChange();
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount) savedRange.current = selection.getRangeAt(0).cloneRange();
  };

  const openLink = () => {
    rememberSelection();
    const selection = window.getSelection();
    setLinkText(selection?.toString() || '');
    setLinkOpen(true);
  };

  const insertLink = () => {
    focusEditor();
    if (savedRange.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange.current);
    }
    const url = linkUrl.trim();
    if (!url) return;
    if (linkText.trim() && window.getSelection()?.isCollapsed) {
      document.execCommand('insertText', false, linkText.trim());
    }
    document.execCommand('createLink', false, url);
    const links = visualRef.current?.querySelectorAll('a');
    const link = links?.[links.length - 1];
    if (link && newTab) {
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
    }
    setLinkOpen(false);
    emitVisualChange();
  };

  const insertImage = () => {
    const url = window.prompt('Image URL');
    if (url?.trim()) {
      focusEditor();
      document.execCommand('insertImage', false, url.trim());
      emitVisualChange();
    }
  };

  const changeMode = (nextMode: 'visual' | 'text') => {
    if (nextMode === 'text') emitVisualChange();
    setMode(nextMode);
  };

  const text = mode === 'text' ? textFromHtml(value) : (visualRef.current?.textContent || textFromHtml(value));
  const characters = text.length;

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <div className={styles.toolbar} aria-label="Formatting toolbar">
          <select aria-label="Text format" disabled={disabled || mode === 'text'} defaultValue="p" onChange={(event) => run('formatBlock', event.target.value)}>
            <option value="p">Paragraph</option>
            {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={`h${level}`}>Heading {level}</option>)}
          </select>
          <button type="button" title="Bold" aria-label="Bold" disabled={disabled || mode === 'text'} onMouseDown={(event) => event.preventDefault()} onClick={() => run('bold')}><strong>B</strong></button>
          <button type="button" title="Italic" aria-label="Italic" disabled={disabled || mode === 'text'} onMouseDown={(event) => event.preventDefault()} onClick={() => run('italic')}><em>I</em></button>
          <button type="button" title="Strikethrough" aria-label="Strikethrough" disabled={disabled || mode === 'text'} onMouseDown={(event) => event.preventDefault()} onClick={() => run('strikeThrough')}><s>S</s></button>
          <button type="button" title="Blockquote" aria-label="Blockquote" disabled={disabled || mode === 'text'} onClick={() => run('formatBlock', 'blockquote')}>❞</button>
          <span className={styles.divider} />
          <button type="button" title="Bulleted list" aria-label="Bulleted list" disabled={disabled || mode === 'text'} onClick={() => run('insertUnorderedList')}>•≡</button>
          <button type="button" title="Numbered list" aria-label="Numbered list" disabled={disabled || mode === 'text'} onClick={() => run('insertOrderedList')}>1≡</button>
          <span className={styles.divider} />
          {(['justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'] as Command[]).map((command, index) => (
            <button key={command} type="button" title={['Align left', 'Align center', 'Align right', 'Justify'][index]} aria-label={['Align left', 'Align center', 'Align right', 'Justify'][index]} disabled={disabled || mode === 'text'} onClick={() => run(command)}>{['≡', '≡', '≡', '☰'][index]}</button>
          ))}
          <span className={styles.divider} />
          <button type="button" title="Insert link" aria-label="Insert link" disabled={disabled || mode === 'text'} onClick={openLink}>🔗</button>
          <button type="button" title="Remove link" aria-label="Remove link" disabled={disabled || mode === 'text'} onClick={() => run('unlink')}>⛓</button>
          <button type="button" title="Insert image" aria-label="Insert image" disabled={disabled || mode === 'text'} onClick={insertImage}>▧</button>
          <span className={styles.divider} />
          <button type="button" title="Undo" aria-label="Undo" disabled={disabled || mode === 'text'} onClick={() => run('undo')}>↶</button>
          <button type="button" title="Redo" aria-label="Redo" disabled={disabled || mode === 'text'} onClick={() => run('redo')}>↷</button>
          <button type="button" title="Clear formatting" aria-label="Clear formatting" disabled={disabled || mode === 'text'} onClick={() => run('removeFormat')}>Tx</button>
        </div>
        <div className={styles.modes} role="tablist" aria-label="Editor mode">
          <button type="button" className={mode === 'visual' ? styles.activeMode : ''} onClick={() => changeMode('visual')} role="tab" aria-selected={mode === 'visual'}>Visual</button>
          <button type="button" className={mode === 'text' ? styles.activeMode : ''} onClick={() => changeMode('text')} role="tab" aria-selected={mode === 'text'}>Text</button>
        </div>
      </div>
      {mode === 'visual' ? (
        <div
          ref={visualRef}
          className={styles.canvas}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emitVisualChange}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
              event.preventDefault();
              openLink();
            }
          }}
        />
      ) : (
        <textarea className={styles.source} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label="HTML source" />
      )}
      <div className={styles.footer}><span>{wordCount} {wordCount === 1 ? 'word' : 'words'}, {characters} characters</span></div>
      {linkOpen && (
        <div className={styles.modalBackdrop} role="presentation">
          <form className={styles.modal} onSubmit={(event) => { event.preventDefault(); insertLink(); }}>
            <h3>Insert link</h3>
            <label>URL<input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} autoFocus required /></label>
            <label>Link text<input value={linkText} onChange={(event) => setLinkText(event.target.value)} /></label>
            <label className={styles.checkbox}><input type="checkbox" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} /> Open in new tab</label>
            <div className={styles.modalActions}><button type="button" onClick={() => setLinkOpen(false)}>Cancel</button><button type="submit">Insert link</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
