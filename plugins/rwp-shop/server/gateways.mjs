import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './supabase.mjs';

// Stripe amounts are in minor units. https://docs.stripe.com/currencies#zero-decimal
const stripeZeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const stripeThreeDecimal = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
const paypalZeroDecimal = new Set(['HUF', 'JPY', 'TWD']);

const stripeExponent = (currency) => (stripeZeroDecimal.has(currency) ? 0 : stripeThreeDecimal.has(currency) ? 3 : 2);
export const toStripeAmount = (amount, currency) => {
  const exponent = stripeExponent(currency);
  const minor = Math.round(Number(amount) * 10 ** exponent);
  // Stripe requires three-decimal currencies to be charged in multiples of 10.
  return exponent === 3 ? Math.round(minor / 10) * 10 : minor;
};
export const fromStripeAmount = (minor, currency) => Number(minor) / 10 ** stripeExponent(currency);

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
export const stripeMode = () => (String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : 'test');

const encodeForm = (value, prefix = '', pairs = []) => {
  if (value === undefined || value === null) return pairs;
  if (typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, inner]) => encodeForm(inner, prefix ? `${prefix}[${key}]` : key, pairs));
  } else if (Array.isArray(value)) {
    value.forEach((inner, index) => encodeForm(inner, `${prefix}[${index}]`, pairs));
  } else {
    pairs.push([prefix, String(value)]);
  }
  return pairs;
};

export async function stripe(method, path, params) {
  if (!stripeConfigured()) {
    throw new HttpError(501, 'Stripe is not configured: set STRIPE_SECRET_KEY on the server (.env.local or your host\'s environment variables) and restart it.');
  }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? new URLSearchParams(encodeForm(params)).toString() : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, `Stripe: ${payload.error?.message || `request failed with HTTP ${response.status}`}`);
  }
  return payload;
}

/** Verifies a Stripe-Signature header against the raw request body. */
export function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((part) => part.split('=')).filter((pair) => pair.length === 2).map(([k, v]) => [k, v]));
  const signatures = String(header || '').split(',').filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  const timestamp = Number(parts.t);
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  return signatures.some((signature) => {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export const paypalConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
export const paypalMode = () => (process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox');
const paypalBase = () => (paypalMode() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

export const toPaypalValue = (amount, currency) => Number(amount).toFixed(paypalZeroDecimal.has(currency) ? 0 : 2);

let paypalToken = { value: '', expires: 0 };

async function paypalAccessToken() {
  if (!paypalConfigured()) {
    throw new HttpError(501, 'PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (and PAYPAL_MODE=live for real payments) on the server and restart it.');
  }
  if (paypalToken.value && paypalToken.expires > Date.now() + 60_000) return paypalToken.value;
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, `PayPal rejected the API credentials (${payload.error_description || `HTTP ${response.status}`}). Check PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and that PAYPAL_MODE (${paypalMode()}) matches the credentials.`);
  }
  paypalToken = { value: payload.access_token, expires: Date.now() + Number(payload.expires_in || 0) * 1000 };
  return paypalToken.value;
}

export async function paypal(method, path, body) {
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.details?.[0]?.description || payload.message || `HTTP ${response.status}`;
    throw new HttpError(502, `PayPal: ${detail}`);
  }
  return payload;
}
