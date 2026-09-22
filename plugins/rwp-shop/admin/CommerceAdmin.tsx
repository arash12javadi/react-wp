import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkPriceAlerts, deleteBundleRow, fetchAlertsForAdmin, fetchBundleRows, fetchOffersForAdmin, fetchProductChoices,
  fetchQuestionsForAdmin, notifyOfferCustomer, respondToOffer, saveBundleRow, sendPriceAlertEmails, updateQuestion,
  deleteQuestion, type OfferStatus, type PriceAlert, type ProductBundle, type ProductOffer, type ProductQuestion, type QuestionStatus,
} from '../lib/commerce';
import { formatPrice } from '../lib/currencies';
import { loadShopSettings, saveShopSettings, useShopSettings, type ShopSettings } from '../lib/settings';
import { Feedback } from './common';
import styles from './admin.module.css';

type Section = 'offers' | 'questions' | 'alerts' | 'bundles';

/** Shop → Offers, Questions, Price alerts and Bundles; the sidebar submenu picks the section. */
export default function CommerceAdmin({ section }: { section: Section }) {
  return (
    <div className={styles.wrap}>
      {section === 'questions' ? <QuestionsAdmin />
        : section === 'alerts' ? <AlertsAdmin />
          : section === 'bundles' ? <BundlesAdmin />
            : <OffersAdmin />}
    </div>
  );
}

/** A setting of this screen, saved on its own (merged into shop_settings). */
function SettingsStrip({ fields }: { fields: Array<{ key: keyof ShopSettings; label: string; type: 'toggle' | 'number'; min?: number; max?: number; suffix?: string }> }) {
  const { settings, ready } = useShopSettings();
  const [draft, setDraft] = useState<Partial<ShopSettings>>({});
  const [message, setMessage] = useState({ error: '', success: '' });
  if (!ready) return null;
  const value = (key: keyof ShopSettings) => (key in draft ? draft[key] : settings[key]);
  const save = async () => {
    setMessage({ error: '', success: '' });
    try {
      const current = await loadShopSettings(true);
      await saveShopSettings({ ...current, ...draft });
      setDraft({});
      setMessage({ error: '', success: 'Saved.' });
    } catch (saveError: unknown) {
      setMessage({ error: saveError instanceof Error ? saveError.message : 'Not saved.', success: '' });
    }
  };
  return (
    <div className={styles.toolbar} style={{ flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      {fields.map((field) => (
        <label key={field.key} className={styles.check} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {field.type === 'toggle' ? (
            <input type="checkbox" checked={Boolean(value(field.key))} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.checked }))} />
          ) : null}
          {field.label}
          {field.type === 'number' && (
            <input className={styles.input} style={{ width: 80 }} type="number" min={field.min} max={field.max} value={Number(value(field.key))}
              onChange={(event) => setDraft((current) => ({ ...current, [field.key]: Number(event.target.value) }))} />
          )}
          {field.suffix}
        </label>
      ))}
      <button type="button" className={styles.buttonSecondary} disabled={!Object.keys(draft).length} onClick={() => void save()}>Save settings</button>
      <Feedback error={message.error} success={message.success} />
    </div>
  );
}

const offerStatusLabels: Record<OfferStatus, string> = {
  pending: 'Pending', countered: 'Countered', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn',
};

function OffersAdmin() {
  const { settings } = useShopSettings();
  const [status, setStatus] = useState<OfferStatus | ''>('pending');
  const [offers, setOffers] = useState<ProductOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ error: '', success: '' });
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setOffers(await fetchOffersForAdmin(status));
    } catch (loadError: unknown) {
      setFeedback({ error: loadError instanceof Error ? loadError.message : 'Offers could not be loaded.', success: '' });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const money = (value: number | null) => (value === null ? '—' : formatPrice(value, settings));

  const respond = async (offer: ProductOffer, action: 'accept' | 'reject' | 'counter') => {
    const counter = action === 'counter' ? Number(counters[offer.id]) : null;
    if (action === 'counter' && !(counter && counter > 0)) {
      setFeedback({ error: 'Enter the counter-offer amount first.', success: '' });
      return;
    }
    setBusy(offer.id);
    setFeedback({ error: '', success: '' });
    try {
      const updated = await respondToOffer(offer.id, action, counter, notes[offer.id] || '');
      const email = await notifyOfferCustomer(updated.id);
      const verb = action === 'accept' ? `accepted; coupon ${updated.coupon_code} was created for the customer`
        : action === 'counter' ? `countered at ${money(updated.counter_price)}` : 'declined';
      setFeedback({ error: '', success: `Offer ${verb}. ${email.sent ? 'The customer was emailed.' : `No email was sent (${email.skipped || 'unknown reason'}); the customer sees the answer on the product page.`}` });
      await load();
    } catch (respondError: unknown) {
      setFeedback({ error: respondError instanceof Error ? respondError.message : 'The offer was not answered.', success: '' });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <p className={styles.muted}>
        Customers offer a price on simple products; accept, decline or counter here. Accepting (or the customer accepting your
        counter-offer) creates a single-use coupon for that product and that customer&rsquo;s email, valid for {settings.offer_valid_days} days,
        so the agreed price is applied at checkout by the database like any coupon.
      </p>
      <SettingsStrip fields={[
        { key: 'enable_offers', label: 'Accept offers', type: 'toggle' },
        { key: 'offer_min_percent', label: 'Lowest offer', type: 'number', min: 0, max: 99, suffix: '% of the price' },
        { key: 'offer_valid_days', label: 'Accepted offers valid for', type: 'number', min: 1, max: 90, suffix: 'days' },
      ]} />
      <div className={styles.subTabs}>
        {(['pending', 'countered', 'accepted', 'rejected', 'withdrawn', ''] as Array<OfferStatus | ''>).map((value) => (
          <button key={value || 'all'} type="button" className={status === value ? styles.subTabActive : styles.subTab} onClick={() => setStatus(value)}>
            {value ? offerStatusLabels[value] : 'All'}
          </button>
        ))}
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Product</th><th>Customer</th><th>Offer</th><th>Price then</th><th>Status</th><th>Answer</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className={styles.muted}>Loading…</td></tr>}
            {!loading && offers.length === 0 && <tr><td colSpan={6} className={styles.muted}>No offers here.</td></tr>}
            {offers.map((offer) => (
              <tr key={offer.id}>
                <td>{offer.shop_products ? <a href={`/product/${offer.shop_products.slug}`} target="_blank" rel="noreferrer">{offer.shop_products.name}</a> : '—'}</td>
                <td>
                  <strong>{offer.profiles?.display_name || 'Customer'}</strong>
                  {offer.profiles?.email && <div className={styles.muted}><a href={`mailto:${offer.profiles.email}`}>{offer.profiles.email}</a></div>}
                  <div className={styles.muted}>{new Date(offer.created_at).toLocaleString()}</div>
                </td>
                <td>
                  <strong>{money(offer.offered_price)}</strong>
                  {offer.list_price ? <div className={styles.muted}>{Math.round((offer.offered_price / offer.list_price) * 100)}% of the price</div> : null}
                  {offer.message && <div style={{ maxWidth: 260 }}>“{offer.message}”</div>}
                </td>
                <td>{money(offer.list_price)}</td>
                <td>
                  {offerStatusLabels[offer.status]}
                  {offer.status === 'countered' && <div className={styles.muted}>at {money(offer.counter_price)}</div>}
                  {offer.coupon_code && <div className={styles.muted}>Coupon {offer.coupon_code}{offer.expires_at ? `, until ${new Date(offer.expires_at).toLocaleDateString()}` : ''}</div>}
                </td>
                <td>
                  {offer.status === 'pending' ? (
                    <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                      <input className={styles.input} placeholder="Message to the customer (optional)" value={notes[offer.id] || ''}
                        onChange={(event) => setNotes((current) => ({ ...current, [offer.id]: event.target.value }))} />
                      <div className={styles.rowActions}>
                        <button type="button" className={styles.button} disabled={busy === offer.id} onClick={() => void respond(offer, 'accept')}>Accept</button>
                        <button type="button" className={styles.buttonSecondary} disabled={busy === offer.id} onClick={() => void respond(offer, 'reject')}>Decline</button>
                      </div>
                      <div className={styles.rowActions}>
                        <input className={styles.input} style={{ width: 110 }} type="number" step="0.01" min={offer.offered_price} placeholder="Counter"
                          value={counters[offer.id] || ''} onChange={(event) => setCounters((current) => ({ ...current, [offer.id]: event.target.value }))} />
                        <button type="button" className={styles.buttonSecondary} disabled={busy === offer.id} onClick={() => void respond(offer, 'counter')}>Counter</button>
                      </div>
                    </div>
                  ) : offer.response_message ? <span className={styles.muted}>“{offer.response_message}”</span> : <span className={styles.muted}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function QuestionsAdmin() {
  const [status, setStatus] = useState<QuestionStatus | ''>('pending');
  const [questions, setQuestions] = useState<ProductQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ error: '', success: '' });

  const load = useCallback(async () => {
    try {
      const loaded = await fetchQuestionsForAdmin(status);
      setQuestions(loaded);
      setAnswers(Object.fromEntries(loaded.map((question) => [question.id, question.answer || ''])));
    } catch (loadError: unknown) {
      setFeedback({ error: loadError instanceof Error ? loadError.message : 'Questions could not be loaded.', success: '' });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setFeedback({ error: '', success: '' });
    try {
      await action();
      setFeedback({ error: '', success });
      await load();
    } catch (actionError: unknown) {
      setFeedback({ error: actionError instanceof Error ? actionError.message : 'That did not work.', success: '' });
    }
  };

  return (
    <>
      <p className={styles.muted}>
        Questions stay visible only to the customer who asked until you answer them; answering publishes the question with
        your answer on the product page. Hide a question to take it off the page without deleting it.
      </p>
      <SettingsStrip fields={[{ key: 'enable_qa', label: 'Customers can ask questions on product pages', type: 'toggle' }]} />
      <div className={styles.subTabs}>
        {([['pending', 'Waiting for an answer'], ['published', 'Published'], ['hidden', 'Hidden'], ['', 'All']] as Array<[QuestionStatus | '', string]>).map(([value, label]) => (
          <button key={label} type="button" className={status === value ? styles.subTabActive : styles.subTab} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Question</th><th>Product</th><th>Answer</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className={styles.muted}>Loading…</td></tr>}
            {!loading && questions.length === 0 && <tr><td colSpan={4} className={styles.muted}>No questions here.</td></tr>}
            {questions.map((question) => (
              <tr key={question.id}>
                <td style={{ maxWidth: 320 }}>
                  <strong>{question.question}</strong>
                  <div className={styles.muted}>{question.author_name} · {new Date(question.created_at).toLocaleString()}</div>
                </td>
                <td>{question.shop_products ? <a href={`/product/${question.shop_products.slug}`} target="_blank" rel="noreferrer">{question.shop_products.name}</a> : '—'}</td>
                <td style={{ minWidth: 280 }}>
                  <textarea className={styles.textarea} rows={3} value={answers[question.id] || ''} placeholder="Your answer"
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
                </td>
                <td>
                  <div className={styles.rowActions} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <button type="button" className={styles.button} disabled={!answers[question.id]?.trim() || answers[question.id] === (question.answer || '')}
                      onClick={() => void act(() => updateQuestion(question.id, { answer: answers[question.id] }), question.answer ? 'Answer updated.' : 'Answered and published.')}>
                      {question.answer ? 'Update answer' : 'Answer & publish'}
                    </button>
                    {question.status !== 'hidden'
                      ? <button type="button" className={styles.buttonLink} onClick={() => void act(() => updateQuestion(question.id, { status: 'hidden' }), 'Question hidden.')}>Hide</button>
                      : <button type="button" className={styles.buttonLink} onClick={() => void act(() => updateQuestion(question.id, { status: question.answer ? 'published' : 'pending' }), 'Question restored.')}>Unhide</button>}
                    <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }}
                      onClick={() => { if (window.confirm('Delete this question permanently?')) void act(() => deleteQuestion(question.id), 'Question deleted.'); }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AlertsAdmin() {
  const { settings } = useShopSettings();
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: '', success: '' });

  const load = useCallback(async () => {
    try {
      // Catches scheduled sales that started since anyone saved the product.
      await checkPriceAlerts().catch(() => 0);
      setAlerts(await fetchAlertsForAdmin());
    } catch (loadError: unknown) {
      setFeedback({ error: loadError instanceof Error ? loadError.message : 'Alerts could not be loaded.', success: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const unsent = alerts.filter((alert) => alert.is_notified && !alert.emailed_at).length;
  const send = async () => {
    setBusy(true);
    setFeedback({ error: '', success: '' });
    try {
      const result = await sendPriceAlertEmails();
      setFeedback({
        error: result.failed.length ? `Some emails failed: ${result.failed.join(' ')}` : '',
        success: result.skipped ? '' : `${result.sent} email${result.sent === 1 ? '' : 's'} sent.`,
      });
      if (result.skipped) setFeedback({ error: result.skipped, success: '' });
      await load();
    } catch (sendError: unknown) {
      setFeedback({ error: sendError instanceof Error ? sendError.message : 'The emails were not sent.', success: '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className={styles.muted}>
        Customers ask to be told when a product reaches a price. The database marks an alert as soon as a price change
        reaches it (customers also see it on the product page right away). The emails go out when you press Send, which
        needs SMTP set up on the server (Shop → Settings → Status). Opening this screen also catches sales that started on
        a schedule.
      </p>
      <SettingsStrip fields={[{ key: 'enable_price_alerts', label: 'Customers can set price-drop alerts', type: 'toggle' }]} />
      <div className={styles.toolbar}>
        <button type="button" className={styles.button} disabled={busy || !unsent} onClick={() => void send()}>
          {busy ? 'Sending…' : `Send ${unsent} pending email${unsent === 1 ? '' : 's'}`}
        </button>
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Product</th><th>Customer</th><th>Target</th><th>Status</th><th>Set</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className={styles.muted}>Loading…</td></tr>}
            {!loading && alerts.length === 0 && <tr><td colSpan={5} className={styles.muted}>No price alerts yet.</td></tr>}
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td>{alert.shop_products ? <a href={`/product/${alert.shop_products.slug}`} target="_blank" rel="noreferrer">{alert.shop_products.name}</a> : '—'}</td>
                <td>{alert.profiles?.display_name || 'Customer'}{alert.profiles?.email && <div className={styles.muted}>{alert.profiles.email}</div>}</td>
                <td>{formatPrice(alert.target_price, settings)}</td>
                <td>
                  {!alert.is_notified ? 'Waiting'
                    : alert.emailed_at ? `Emailed ${new Date(alert.emailed_at).toLocaleDateString()}`
                      : `Reached (${formatPrice(alert.notified_price ?? 0, settings)}), email pending`}
                </td>
                <td>{new Date(alert.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BundlesAdmin() {
  const [products, setProducts] = useState<Array<{ id: string; name: string; status: string; type: string }>>([]);
  const [main, setMain] = useState('');
  const [rows, setRows] = useState<ProductBundle[]>([]);
  const [suggested, setSuggested] = useState('');
  const [discount, setDiscount] = useState('10');
  const [feedback, setFeedback] = useState({ error: '', success: '' });

  useEffect(() => {
    fetchProductChoices().then(setProducts).catch((loadError: unknown) => setFeedback({ error: loadError instanceof Error ? loadError.message : 'Products could not be loaded.', success: '' }));
  }, []);

  const loadRows = useCallback(async (productId: string) => {
    if (!productId) { setRows([]); return; }
    try {
      setRows(await fetchBundleRows(productId));
    } catch (loadError: unknown) {
      setFeedback({ error: loadError instanceof Error ? loadError.message : 'The bundle could not be loaded.', success: '' });
    }
  }, []);

  useEffect(() => { void loadRows(main); }, [loadRows, main]);

  const names = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setFeedback({ error: '', success: '' });
    try {
      await action();
      setFeedback({ error: '', success });
      await loadRows(main);
    } catch (actionError: unknown) {
      setFeedback({ error: actionError instanceof Error ? actionError.message : 'That did not work.', success: '' });
    }
  };

  const add = () => act(async () => {
    if (!suggested) throw new Error('Choose a product to suggest.');
    await saveBundleRow({ main_product_id: main, suggested_product_id: suggested, discount_percentage: Number(discount) || 0, menu_order: rows.length });
    setSuggested('');
  }, 'Suggestion saved.');

  return (
    <>
      <p className={styles.muted}>
        Frequently Bought Together: products suggested on a product&rsquo;s page, with an optional discount that applies when a
        suggested product is in the same cart as the main one (for as many units as there are of the main product). The
        discount is applied by the database in the cart and at checkout. Only simple products can be added with one click.
      </p>
      <div className={styles.toolbar}>
        <label className={styles.field} style={{ minWidth: 320 }}>
          Main product
          <select className={styles.select} value={main} onChange={(event) => setMain(event.target.value)}>
            <option value="">Choose a product…</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.status === 'publish' ? '' : ` (${product.status})`}</option>)}
          </select>
        </label>
      </div>
      <Feedback error={feedback.error} success={feedback.success} />
      {main && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Suggested product</th><th>Discount when bought together</th><th /></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={3} className={styles.muted}>No suggestions for this product yet.</td></tr>}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{names.get(row.suggested_product_id)?.name || row.suggested_product_id}{names.get(row.suggested_product_id)?.type !== 'simple' && <span className={styles.muted}> · needs options, linked only</span>}</td>
                    <td>
                      <input className={styles.input} style={{ width: 90 }} type="number" min={0} max={90} step="0.5" defaultValue={row.discount_percentage}
                        onBlur={(event) => {
                          const next = Number(event.target.value);
                          if (next !== row.discount_percentage) void act(() => saveBundleRow({ ...row, discount_percentage: next }), 'Discount updated.');
                        }} /> %
                    </td>
                    <td><button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} onClick={() => void act(() => deleteBundleRow(row.id), 'Suggestion removed.')}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.toolbar}>
            <select className={styles.select} value={suggested} onChange={(event) => setSuggested(event.target.value)} aria-label="Product to suggest">
              <option value="">Add a suggested product…</option>
              {products.filter((product) => product.id !== main && !rows.some((row) => row.suggested_product_id === product.id))
                .map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input className={styles.input} style={{ width: 80 }} type="number" min={0} max={90} step="0.5" value={discount} onChange={(event) => setDiscount(event.target.value)} /> % off
            </label>
            <button type="button" className={styles.button} disabled={!suggested} onClick={() => void add()}>Add</button>
          </div>
        </>
      )}
    </>
  );
}
