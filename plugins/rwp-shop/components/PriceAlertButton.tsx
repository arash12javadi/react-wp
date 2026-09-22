import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { loginHref } from '../../../src/lib/account';
import { fetchMyPriceAlert, removePriceAlert, setPriceAlert, type PriceAlert } from '../lib/commerce';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import { useSignedIn } from './useSignedIn';
import './commerce.css';

/**
 * <PriceAlertButton product_id={id} current_price={price} />: a bell that asks to be told when the
 * price drops to a target. The database marks the alert when a price change reaches it; the email goes
 * out from Shop → Offers & Q&A → Price alerts (or the next check), and the button shows it here too.
 */
export default function PriceAlertButton({ product_id: productId, current_price: currentPrice }: { product_id: string; current_price: number | null }) {
  const { settings, ready } = useShopSettings();
  const userId = useSignedIn();
  const [alert, setAlert] = useState<PriceAlert | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId || !productId) return;
    fetchMyPriceAlert(productId).then(setAlert).catch(() => setAlert(null));
  }, [productId, userId]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => { if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!ready || !settings.enable_price_alerts || !productId || currentPrice === null) return null;
  const money = (value: number | null) => formatPrice(value ?? 0, settings);

  const toggle = () => {
    if (userId === '') { window.location.href = loginHref(); return; }
    setError('');
    const decimals = Math.max(settings.decimals, 0);
    setTarget(alert ? String(alert.target_price) : (Math.floor(currentPrice * 0.9 * 10 ** decimals) / 10 ** decimals).toFixed(decimals));
    setOpen((value) => !value);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setAlert(await setPriceAlert(productId, Number(target)));
      setOpen(false);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'The alert was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removePriceAlert(productId);
      setAlert(null);
      setOpen(false);
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : 'The alert was not removed.');
    } finally {
      setBusy(false);
    }
  };

  const label = alert?.is_notified ? `Price dropped to ${money(alert.notified_price)}!`
    : alert ? `Alert at ${money(alert.target_price)}` : 'Price drop alert';

  return (
    <div className="rwp-shop-alert" ref={wrapper}>
      <button type="button" className={`rwp-shop-tool-button rwp-shop-alert-button${alert ? ' is-active' : ''}`} aria-expanded={open}
        disabled={userId === null} onClick={toggle}>
        {alert?.is_notified ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />} {label}
      </button>
      {open && (
        <form className="rwp-shop-alert-panel" onSubmit={(event) => void save(event)} aria-label="Price drop alert">
          <label className="rwp-shop-field">
            <span>Tell me when the price is at or below</span>
            <input type="number" required min={0.01} max={currentPrice} step="0.01" inputMode="decimal" value={target}
              onChange={(event) => setTarget(event.target.value)} />
          </label>
          <span className="rwp-shop-note">Now {money(currentPrice)}. You&rsquo;ll see it here, and get one email, when it drops.</span>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="submit" className="rwp-shop-tool-button is-primary" disabled={busy}>{alert ? 'Update alert' : 'Set alert'}</button>
            {alert && <button type="button" className="rwp-shop-tool-button" disabled={busy} onClick={() => void remove()}>Remove</button>}
          </div>
          {error && <p className="rwp-shop-error" role="alert">{error}</p>}
        </form>
      )}
      {!open && error && <p className="rwp-shop-error" role="alert">{error}</p>}
    </div>
  );
}
