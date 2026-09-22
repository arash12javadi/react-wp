import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { loginHref } from '../../../src/lib/account';
import { askQuestion, deleteQuestion, fetchProductQuestions, type ProductQuestion } from '../lib/commerce';
import { useShopSettings } from '../lib/settings';
import { useSignedIn } from './useSignedIn';
import './commerce.css';

/**
 * <ProductQA product_id={id} />: customer questions and the store's answers as an accordion, and an
 * "Ask a question" form for signed-in customers. New questions stay private to the asker until the
 * store answers them (answering publishes), which the database enforces.
 */
export default function ProductQA({ product_id: productId, title = 'Questions & answers' }: { product_id: string; title?: string }) {
  const { settings, ready } = useShopSettings();
  const userId = useSignedIn();
  const [questions, setQuestions] = useState<ProductQuestion[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setQuestions(await fetchProductQuestions(productId));
      setError('');
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Questions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { if (productId) void load(); }, [load, productId]);

  if (!ready || !settings.enable_qa || !productId) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await askQuestion(productId, draft);
      setDraft('');
      setMessage('Thank you! Your question will appear here once the store has answered it.');
      await load();
    } catch (askError: unknown) {
      setError(askError instanceof Error ? askError.message : 'Your question was not sent.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (question: ProductQuestion) => {
    if (!window.confirm('Delete your question?')) return;
    try {
      await deleteQuestion(question.id);
      await load();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'The question was not deleted.');
    }
  };

  const term = search.trim().toLowerCase();
  const visible = term
    ? questions.filter((question) => `${question.question} ${question.answer || ''}`.toLowerCase().includes(term))
    : questions;
  const answered = questions.filter((question) => question.status === 'published').length;

  return (
    <section className="rwp-shop-qa" aria-labelledby={`rwp-qa-${productId}`}>
      <h2 id={`rwp-qa-${productId}`}>{title}{answered > 0 && ` (${answered})`}</h2>
      {questions.length > 5 && (
        <label className="rwp-shop-field">
          <span>Search questions</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      )}
      {loading && <p className="rwp-shop-note">Loading…</p>}
      {!loading && !questions.length && !error && <p className="rwp-shop-note">No questions yet. Be the first to ask.</p>}
      {visible.length > 0 && (
        <ul className="rwp-shop-qa-list">
          {visible.map((question) => (
            <li key={question.id}>
              <details className="rwp-shop-qa-item" open={question.status === 'pending'}>
                <summary><span data-rwp-user-content>{question.question}</span></summary>
                <div className="rwp-shop-qa-body">
                  {question.answer
                    ? <p className="rwp-shop-qa-answer" data-rwp-user-content>{question.answer}</p>
                    : <p className="rwp-shop-note">Waiting for an answer from the store. Only you can see this question until then.</p>}
                  <span className="rwp-shop-qa-meta">
                    Asked by <span data-rwp-user-content>{question.author_name}</span> on {new Date(question.created_at).toLocaleDateString()}
                    {question.answered_at && <> · answered {new Date(question.answered_at).toLocaleDateString()}</>}
                  </span>
                  {question.user_id === userId && !question.answer && (
                    <div><button type="button" className="rwp-shop-tool-button" onClick={() => void remove(question)}>Delete my question</button></div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3>Ask a question</h3>
        {userId === null ? null : !userId ? (
          <p className="rwp-shop-note"><a href={loginHref()}>Log in</a> to ask the store about this product.</p>
        ) : (
          <form className="rwp-shop-qa-form" onSubmit={(event) => void submit(event)}>
            <label className="rwp-shop-field">
              <span>Your question</span>
              <textarea required minLength={3} maxLength={1000} rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />
            </label>
            <div>
              <button type="submit" className="rwp-shop-tool-button is-primary" disabled={saving || draft.trim().length < 3}>
                {saving ? 'Sending…' : 'Ask the store'}
              </button>
            </div>
          </form>
        )}
        {message && <p className="rwp-shop-success" role="status">{message}</p>}
        {error && <p className="rwp-shop-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
