import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import ResizableImage from './editor/ResizableImage';
import { TableKit } from '@tiptap/extension-table';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import MediaManager from './MediaManager';
import styles from './ClassicEditor.module.css';

interface ClassicEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const swatches = [
  '#000000', '#374151', '#6b7280', '#b91c1c', '#ea580c', '#ca8a04',
  '#15803d', '#0e7490', '#1d4ed8', '#6d28d9', '#be185d', '#ffffff',
];

const highlights = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa'];

function Btn({
  onClick, active, title, disabled, children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? styles.toolbarActive : undefined}
      disabled={disabled}
      // Keeps focus in the document so the command applies to the current selection.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function ClassicEditor({ value, onChange, placeholder, disabled = false }: ClassicEditorProps) {
  const [mode, setMode] = useState<'visual' | 'text'>('visual');
  const [mediaOpen, setMediaOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [newTab, setNewTab] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  // TipTap normalises HTML, so editor.getHTML() rarely matches the stored string byte for
  // byte. Comparing against what we last emitted — rather than against the prop — is what
  // stops the editor resetting its document mid-edit and throwing focus to the toolbar.
  const lastEmitted = useRef(value);

  const editor = useEditor({
    editable: !disabled,
    content: value,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noreferrer noopener' } },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      ResizableImage.configure({ inline: false, HTMLAttributes: { loading: 'lazy' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      TextStyleKit.configure({ fontFamily: false, fontSize: false, lineHeight: false }),
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    editorProps: { attributes: { class: styles.canvas } },
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor || mode === 'text') return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, mode, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      return {
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        underline: instance.isActive('underline'),
        strike: instance.isActive('strike'),
        code: instance.isActive('code'),
        blockquote: instance.isActive('blockquote'),
        codeBlock: instance.isActive('codeBlock'),
        bulletList: instance.isActive('bulletList'),
        orderedList: instance.isActive('orderedList'),
        link: instance.isActive('link'),
        table: instance.isActive('table'),
        align: ['left', 'center', 'right', 'justify'].find((a) => instance.isActive({ textAlign: a })) || '',
        heading: [1, 2, 3, 4, 5, 6].find((level) => instance.isActive('heading', { level })) || 'p',
        color: instance.getAttributes('textStyle').color || '',
        canUndo: instance.can().undo(),
        canRedo: instance.can().redo(),
        text: instance.getText(),
      };
    },
  });

  if (!editor || !state) return <div className={styles.editor} />;

  const locked = disabled || mode === 'text';
  const words = state.text.trim() ? state.text.trim().split(/\s+/).length : 0;

  const applyLink = () => {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: newTab ? '_blank' : null }).run();
  };

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <div className={styles.toolbar} aria-label="Formatting toolbar">
          <select
            aria-label="Text format"
            disabled={locked}
            value={String(state.heading)}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'p') editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({ level: Number(next) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
            }}
          >
            <option value="p">Paragraph</option>
            {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={String(level)}>Heading {level}</option>)}
          </select>

          <Btn title="Bold" active={state.bold} disabled={locked} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></Btn>
          <Btn title="Italic" active={state.italic} disabled={locked} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Btn>
          <Btn title="Underline" active={state.underline} disabled={locked} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
          <Btn title="Strikethrough" active={state.strike} disabled={locked} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
          <Btn title="Inline code" active={state.code} disabled={locked} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</Btn>

          <span className={styles.divider} />
          <div className={styles.colorWrap}>
            <Btn title="Text colour" active={colorOpen} disabled={locked} onClick={() => setColorOpen((open) => !open)}>
              <span className={styles.colorGlyph}>A<span className={styles.colorBar} style={{ background: state.color || '#111827' }} /></span>
            </Btn>
            {colorOpen && !locked && (
              <div className={styles.colorPopover}>
                <p>Text colour</p>
                <div className={styles.swatches}>
                  {swatches.map((color) => (
                    <button key={color} type="button" title={color} style={{ background: color }}
                      className={state.color === color ? styles.swatchActive : styles.swatch}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { editor.chain().focus().setColor(color).run(); setColorOpen(false); }} />
                  ))}
                </div>
                <p>Highlight</p>
                <div className={styles.swatches}>
                  {highlights.map((color) => (
                    <button key={color} type="button" title={color} style={{ background: color }} className={styles.swatch}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { editor.chain().focus().setBackgroundColor(color).run(); setColorOpen(false); }} />
                  ))}
                </div>
                <div className={styles.colorActions}>
                  <label>
                    Custom
                    <input type="color" value={state.color || '#111827'}
                      onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} />
                  </label>
                  <button type="button" onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { editor.chain().focus().unsetColor().unsetBackgroundColor().run(); setColorOpen(false); }}>
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className={styles.divider} />
          <Btn title="Blockquote" active={state.blockquote} disabled={locked} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❞</Btn>
          <Btn title="Code block" active={state.codeBlock} disabled={locked} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>▤</Btn>
          <Btn title="Bulleted list" active={state.bulletList} disabled={locked} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</Btn>
          <Btn title="Numbered list" active={state.orderedList} disabled={locked} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</Btn>

          <span className={styles.divider} />
          {([['left', 'Align left', '⬅'], ['center', 'Align center', '↔'], ['right', 'Align right', '➡'], ['justify', 'Justify', '☰']] as Array<[string, string, string]>).map(([align, label, glyph]) => (
            <Btn key={align} title={label} active={state.align === align} disabled={locked}
              onClick={() => editor.chain().focus().setTextAlign(align).run()}>{glyph}</Btn>
          ))}

          <span className={styles.divider} />
          <Btn title="Insert link" active={state.link} disabled={locked}
            onClick={() => { setLinkUrl(editor.getAttributes('link').href || 'https://'); setLinkOpen(true); }}>🔗</Btn>
          <Btn title="Remove link" disabled={locked || !state.link} onClick={() => editor.chain().focus().unsetLink().run()}>⛓</Btn>
          <Btn title="Insert image" disabled={locked} onClick={() => setMediaOpen(true)}>▧</Btn>
          <Btn title="Insert table" disabled={locked}
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>⊞</Btn>
          <Btn title="Horizontal rule" disabled={locked} onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</Btn>

          <span className={styles.divider} />
          <Btn title="Undo" disabled={locked || !state.canUndo} onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
          <Btn title="Redo" disabled={locked || !state.canRedo} onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
          <Btn title="Clear formatting" disabled={locked} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>Tx</Btn>
        </div>

        <div className={styles.modes} role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={mode === 'visual'}
            className={mode === 'visual' ? styles.activeMode : ''} onClick={() => setMode('visual')}>Visual</button>
          <button type="button" role="tab" aria-selected={mode === 'text'}
            className={mode === 'text' ? styles.activeMode : ''} onClick={() => setMode('text')}>Text</button>
        </div>
      </div>

      {state.table && mode === 'visual' && (
        <div className={styles.tableBar} aria-label="Table controls">
          <button type="button" onClick={() => editor.chain().focus().addColumnBefore().run()}>+ Col before</button>
          <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Col after</button>
          <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete col</button>
          <button type="button" onClick={() => editor.chain().focus().addRowBefore().run()}>+ Row before</button>
          <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row after</button>
          <button type="button" onClick={() => editor.chain().focus().mergeOrSplit().run()}>Merge / split</button>
          <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button>
        </div>
      )}

      {mode === 'visual' ? (
        <EditorContent editor={editor} />
      ) : (
        <textarea
          className={styles.source}
          value={value}
          disabled={disabled}
          aria-label="HTML source"
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <div className={styles.footer}>
        <span>{words} {words === 1 ? 'word' : 'words'}, {state.text.length} characters</span>
      </div>

      {mediaOpen && (
        <MediaManager
          heading="Insert image"
          onClose={() => setMediaOpen(false)}
          onSelect={(item) => {
            setMediaOpen(false);
            editor.chain().focus().setImage({ src: item.url, alt: item.alt_text || item.title || '' }).run();
          }}
        />
      )}

      {linkOpen && (
        <div className={styles.modalBackdrop} role="presentation">
          <form className={styles.modal} onSubmit={(event) => { event.preventDefault(); applyLink(); }}>
            <h3>Insert link</h3>
            <label>URL
              <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} autoFocus required />
            </label>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} /> Open in new tab
            </label>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setLinkOpen(false)}>Cancel</button>
              <button type="submit">Insert link</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
