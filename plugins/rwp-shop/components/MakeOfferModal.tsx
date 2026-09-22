import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HandCoins } from 'lucide-react';
import { loginHref } from '../../../src/lib/account';
import { answerCounterOffer, fetchMyOffer, makeOffer, withdrawOffer, type ProductOffer } from '../lib/commerce';
import { cart } from '../lib/cart';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import { useSignedIn } from './useSignedIn';
import './commerce.css';

/**
 * <MakeOfferModal product_id={id} original_price={price} />: an eBay-style "Make an offer" button and
 * dialog. The offer is only a request. When the store accepts (or the customer accepts a counter-offer)
 * the database creates a single-use coupon for this product and this customer's email, which is how the
 * agreed price reaches checkout; nothing here decides an amount.
 */
export default function MakeOfferModal({ product_id: productId, original_price: originalPrice, product_type: productType = 'simple' }: {
  product_id: string;
  original_price: number | null;
  /** Offers are for simple products only (the database refuses others). */
  product_type?: string;
}) {
  const { settings, ready } = useShopSettings();
  const userId = useSignedIn();
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<ProductOffer | null>(null);
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId || !productId) return;
    fetchMyOffer(productId).then(setOffer).catch(() => setOffer(null));
  }, [productId, userId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!ready || !settings.enable_offers || productType !== 'simple' || originalPrice === null || !productId) return null;

  const money = (value: number | null | undefined) => formatPrice(value ?? 0, settings);
  const minimum = Math.ceil(originalPrice * settings.offer_min_percent) / 100;
  const openOffer = offer && (offer.status === 'pending' || offer.status === 'countered') ? offer : null;

  const start = () => {
    if (userId === '') { window.location.href = loginHref(); return; }
    setError('');
    setNotice('');
    setPrice(openOffer?.status === 'pending' ? String(openOffer.offered_price) : '');
    setMessage(openOffer?.status === 'pending' ? openOffer.message : '');
    setOpen(true);
  };

  const run = async (action: () => Promise<ProductOffer>, success: string) => {
    setBusy(true);
    setError('');
    try {
      const updated = await action();
      setOffer(updated);
      setNotice(success);
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(price);
    if (!(amount > 0)) { setError('Enter the amount you would like to pay.'); return; }
    void run(() => makeOffer(productId, amount, message.trim()), 'Your offer has been sent. The store will answer here, and by email if the store has email set up.');
  };

  const buyWithCoupon = (code: string) => {
    cart.add(productId, 1);
    cart.applyCoupon(code);
    window.location.href = '/cart';
  };

  const statusText = (value: ProductOffer) => {
    switch (value.status) {
      case 'pending': return `Your offer of ${money(value.offered_price)} is waiting for the store's answer.`;
      case 'countered': return `The store has countered with ${money(value.counter_price)}.`;
      case 'accepted': return `Offer accepted! Buy one at ${money(value.counter_price ?? value.offered_price)} with the code below${value.expires_at ? ` before ${new Date(value.expires_at).toLocaleDateString()}` : ''}.`;
      case 'rejected': return `The store declined your offer of ${money(value.offered_price)}. You can make a new one.`;
      default: return 'You withdrew your last offer. You can make a new one.';
    }
  };

  const buttonLabel = offer?.status === 'accepted' ? 'Your offer was accepted'
    : offer?.status === 'countered' ? 'Counter-offer received' : openOffer ? 'Your offer is pending' : 'Make an offer';

  return (
    <>
      <button type="button" className={`rwp-shop-tool-button rwp-shop-offer-button${openOffer || offer?.status === 'accepted' ? ' is-active' : ''}`}
        disabled={userId === null} onClick={start} aria-haspopup="dialog">
        <HandCoins aria-hidden="true" /> {buttonLabel}
      </button>
      {open && (
        <div className="rwp-shop-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="rwp-shop-modal" role="dialog" aria-modal="true" aria-labelledby={`rwp-offer-${productId}`} ref={dialog}>
            <h2 id={`rwp-offer-${productId}`}>Make an offer</h2>
            <p className="rwp-shop-note">Price: <strong>{money(originalPrice)}</strong>. Offers from {money(minimum)} are considered.</p>
            {offer && <div className="rwp-shop-offer-status" role="status">{statusText(offer)}
              {offer.response_message && <><br /><em data-rwp-user-content>“{offer.response_message}”</em></>}
            </div>}
            {offer?.status === 'accepted' && offer.coupon_code && (
              <>
                <p>Your code: <span className="rwp-shop-coupon">{offer.coupon_code.toUpperCase()}</span></p>
                <div className="rwp-shop-modal-actions">
                  <button type="button" className="rwp-shop-tool-button is-primary" onClick={() => buyWithCoupon(offer.coupon_code!)}>Add to cart with this price</button>
                </div>
              </>
            )}
            {offer?.status === 'countered' && (
              <div className="rwp-shop-modal-actions">
                <button type="button" className="rwp-shop-tool-button" disabled={busy}
                  onClick={() => void run(() => answerCounterOffer(offer.id, false), 'You declined the counter-offer.')}>Decline</button>
                <button type="button" className="rwp-shop-tool-button is-primary" disabled={busy}
                  onClick={() => void run(() => answerCounterOffer(offer.id, true), 'Accepted! Your code is below.')}>Accept {money(offer.counter_price)}</button>
              </div>
            )}
            {(!offer || offer.status === 'pending' || offer.status === 'rejected' || offer.status === 'withdrawn') && (
              <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem' }}>
                <label className="rwp-shop-field">
                  <span>Your offer</span>
                  <input type="number" required min={minimum} max={originalPrice} step="0.01" inputMode="decimal" value={price}
                    onChange={(event) => setPrice(event.target.value)} />
                </label>
                <label className="rwp-shop-field">
                  <span>Message to the store (optional)</span>
                  <textarea rows={3} maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} />
                </label>
                <div className="rwp-shop-modal-actions">
                  {offer?.status === 'pending' && (
                    <button type="button" className="rwp-shop-tool-button" disabled={busy}
                      onClick={() => void run(() => withdrawOffer(offer.id), 'Your offer was withdrawn.')}>Withdraw offer</button>
                  )}
                  <button type="submit" className="rwp-shop-tool-button is-primary" disabled={busy}>
                    {busy ? 'Sending…' : offer?.status === 'pending' ? 'Update offer' : 'Send offer'}
                  </button>
                </div>
              </form>
            )}
            {notice && <p className="rwp-shop-success" role="status">{notice}</p>}
            {error && <p className="rwp-shop-error" role="alert">{error}</p>}
            <div className="rwp-shop-modal-actions">
              <button type="button" className="rwp-shop-tool-button" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
