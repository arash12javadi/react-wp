import { useEffect, useRef, useState } from 'react';
import { snippetTypeLabels, type SnippetType } from '../../src/lib/snippets';
import { askAssistant, type ChatMessage } from './services/geminiSnippetAssistant';
import styles from './snippets.module.css';

/**
 * The assistant drawer: a conversation with Gemini that has been told how this CMS actually works
 * (the hook registry, the tables, the global rwp- and rwpb- class names, the fact that there is
 * no Tailwind here). The system prompt lives on the server in serverAi.mjs, so it cannot be
 * edited away from a browser console.
 *
 * Whatever the assistant answers is a suggestion, never an action: "Insert into editor" puts the
 * code in the editor for a person to read, and a snippet still has to be saved and switched on
 * before anything runs.
 */

const STARTERS = [
  'How do I add a banner above the site header?',
  'Write CSS that makes page-builder buttons full width on phones.',
  'Which filter changes the site title, and what does it receive?',
  'Why is my JavaScript snippet running before the page exists?',
];

interface Props {
  onClose: () => void;
  /** Present while the snippet editor is open, so the assistant can see and replace its code. */
  editor?: { code: string; type: SnippetType; insert: (code: string) => void } | null;
}

export default function AiChatDrawer({ onClose, editor }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, and only then — scrolling on every render would fight
  // with someone reading back through earlier answers.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history: ChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(history);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const result = await askAssistant(history, { editorCode: editor?.code, editorType: editor?.type });
      setModel(result.model);
      setMessages([...history, { role: 'assistant', text: result.reply, code: result.code, codeType: result.codeType }]);
    } catch (askError) {
      // The question stays in the history so "Send" can be pressed again after the cause is fixed.
      setError(askError instanceof Error ? askError.message : 'The assistant did not answer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={styles.drawer} aria-label="AI developer assistant">
      <div className={styles.drawerHead}>
        <h3>AI Developer Assistant</h3>
        <button type="button" className={styles.iconButton} onClick={() => setMessages([])} disabled={!messages.length || busy}>New chat</button>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close the assistant">✕</button>
        <p>
          Knows this site’s hooks, tables and class names.
          {editor ? ` It can also see the ${snippetTypeLabels[editor.type]} snippet you have open.` : ''}
          {model ? ` · ${model}` : ''}
        </p>
      </div>

      <div className={styles.messages} ref={listRef}>
        {!messages.length && (
          <div className={styles.starters}>
            {STARTERS.map((starter) => (
              <button key={starter} type="button" className={styles.starter} onClick={() => void send(starter)}>{starter}</button>
            ))}
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? styles.fromUser : styles.fromAssistant}>
            {message.text}
            {message.code && (
              <>
                <pre className={styles.messageCode}>{message.code}</pre>
                <div className={styles.messageActions}>
                  {editor && (
                    <button type="button" className={styles.primary} onClick={() => editor.insert(message.code!)}>
                      Insert into editor
                    </button>
                  )}
                  <button type="button" className={styles.secondary} onClick={() => void navigator.clipboard?.writeText(message.code!)}>
                    Copy
                  </button>
                  {message.codeType && <span className={styles.badge}>{snippetTypeLabels[message.codeType]}</span>}
                </div>
              </>
            )}
          </div>
        ))}
        {busy && <div className={styles.fromAssistant}>Thinking…</div>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => { event.preventDefault(); void send(draft); }}
      >
        <textarea
          value={draft}
          rows={3}
          placeholder="Ask for a snippet, or about how React-WP works…"
          aria-label="Your question"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter starts a new line — what every chat box does.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className={styles.composerRow}>
          <span className={styles.muted} style={{ fontSize: '.78rem' }}>Enter sends · Shift + Enter for a new line</span>
          <span className={styles.spacer} />
          <button type="submit" className={styles.primary} disabled={busy || !draft.trim()}>{busy ? 'Asking…' : 'Send'}</button>
        </div>
      </form>
    </aside>
  );
}
