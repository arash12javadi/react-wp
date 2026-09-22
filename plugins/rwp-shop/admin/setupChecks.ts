import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import type { RwpSetupNotice } from '../../../src/lib/plugin-api';
import { callShopServer } from '../lib/api';
import { enabledGateways, loadShopSettings } from '../lib/settings';

interface ServerStatus {
  service_key: boolean;
  stripe: boolean;
  paypal: boolean;
  smtp: boolean;
}

const settingsAction = { label: 'Open Shop → Settings', section: 'rwp-shop', subsection: 'settings' };

/** Dashboard → Overview checklist items for the shop. Only the things that stop it selling are "required". */
export async function shopSetupNotices(): Promise<RwpSetupNotice[]> {
  const notices: RwpSetupNotice[] = [];
  const supabase = getSupabaseClient();

  const { count, error: productsError } = await supabase
    .from('shop_products').select('id', { count: 'exact', head: true }).eq('status', 'publish');
  if (productsError) {
    const message = describeDbError(productsError);
    if (/shop_products|schema cache|42P01|PGRST205/i.test(message)) {
      return [{
        id: 'shop-migration',
        level: 'required',
        title: 'Run the shop database migration',
        description: `RWP Shop is active, but its tables are missing (${message}). Nothing in the shop works until the migration has run.`,
        steps: [
          'Open your Supabase project → SQL Editor → New query.',
          'Paste the whole of supabase/migrations/20260917_shop_plugin.sql and click Run. It is safe to run again.',
          'Reload this page.',
        ],
        action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
      }];
    }
  }

  const { error: commerceError } = await supabase.from('shop_product_bundles').select('id', { count: 'exact', head: true });
  if (commerceError && /schema cache|42P01|PGRST205|does not exist/i.test(describeDbError(commerceError))) {
    notices.push({
      id: 'shop-migration-20261005',
      level: 'recommended',
      title: 'Run the shop engagement migration',
      description: 'Product likes and saves, Q&A, Make an Offer, price-drop alerts and Frequently Bought Together need it; until then they stay hidden or show the error.',
      steps: [
        'Open your Supabase project → SQL Editor → New query.',
        'Run supabase/migrations/20261004_engagement.sql first if you have not, then paste the whole of supabase/migrations/20261005_shop_engagement.sql and click Run. Both are safe to run again.',
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  const settings = await loadShopSettings(true);
  if (!settings.store_address.trim() || !settings.store_city.trim() || !settings.store_country) {
    notices.push({
      id: 'shop-store-address',
      level: 'recommended',
      title: 'Add your store address',
      description: 'Tax "based on shop base address", local pickup and the cheque payment instructions all use it, and it appears on order emails.',
      steps: ['Open Shop → Settings → General.', 'Fill in address, city, postcode and country, then Save changes.'],
      action: settingsAction,
    });
  }

  const gateways = enabledGateways(settings);
  if (gateways.length === 0) {
    notices.push({
      id: 'shop-payments',
      level: 'required',
      title: 'Enable at least one payment method',
      description: 'Checkout cannot place an order while every payment method is switched off.',
      steps: [
        'Open Shop → Settings → Payments.',
        'Tick "Enable this payment method" for bank transfer, cheque, cash on delivery, Stripe or PayPal.',
        'Save changes.',
      ],
      action: settingsAction,
    });
  }

  if (!productsError && !count) {
    notices.push({
      id: 'shop-first-product',
      level: 'recommended',
      title: 'Publish your first product',
      description: 'The /shop page is empty until at least one product has the status "Published".',
      action: { label: 'Open Shop → Products', section: 'rwp-shop', subsection: 'products' },
    });
  }

  let status: ServerStatus | null = null;
  try {
    status = await callShopServer<ServerStatus>('status', {});
  } catch (serverError) {
    notices.push({
      id: 'shop-server',
      level: 'recommended',
      title: 'The shop server routes are not answering',
      description: `${serverError instanceof Error ? serverError.message : 'The status check failed.'} Online payments and order emails run on the server, so they will fail too.`,
      steps: ['Run the site with npm start (or deploy to Vercel), not only npm run dev.', 'Reload this page.'],
    });
  }
  if (!status) return notices;

  const online = gateways.filter((gateway) => gateway.id === 'stripe' || gateway.id === 'paypal');
  if (gateways.some((gateway) => gateway.id === 'stripe') && !status.stripe) {
    notices.push({
      id: 'shop-stripe-key',
      level: 'required',
      title: 'Stripe is enabled but STRIPE_SECRET_KEY is not set',
      description: 'Customers who choose card payment will get an error at checkout.',
      steps: [
        'In Stripe → Developers → API keys, copy the secret key (sk_test_… for testing).',
        'Add STRIPE_SECRET_KEY=… to .env.local (or your host’s environment variables).',
        'Restart the server (npm start).',
      ],
      action: { label: 'Open Stripe API keys', href: 'https://dashboard.stripe.com/apikeys' },
    });
  }
  if (gateways.some((gateway) => gateway.id === 'paypal') && !status.paypal) {
    notices.push({
      id: 'shop-paypal-keys',
      level: 'required',
      title: 'PayPal is enabled but its API credentials are not set',
      description: 'Customers who choose PayPal will get an error at checkout.',
      steps: [
        'In the PayPal developer dashboard → Apps & Credentials, create an app.',
        'Add PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MODE=sandbox (or live) to .env.local.',
        'Restart the server.',
      ],
      action: { label: 'Open PayPal developer', href: 'https://developer.paypal.com/dashboard/applications' },
    });
  }
  if (!status.service_key) {
    notices.push({
      id: 'shop-service-key',
      level: online.length ? 'required' : 'recommended',
      title: 'Set SUPABASE_SECRET_KEY on the server',
      description: online.length
        ? 'Without it, paid Stripe and PayPal orders can never be marked as paid, and guests get no order emails.'
        : 'Without it, customers who check out as guests get no order emails. Online payments will also need it.',
      steps: [
        'In Supabase → Project Settings → API Keys, copy the secret key (sb_secret_…, or the legacy service_role key).',
        'Add SUPABASE_SECRET_KEY=… to .env.local. Never put it in any admin screen: those settings are public.',
        'Restart the server.',
      ],
    });
  }
  if (!status.smtp) {
    notices.push({
      id: 'shop-smtp',
      level: 'optional',
      title: 'Configure SMTP to send order emails',
      description: 'Orders work without it, but neither you nor your customers are emailed about them.',
      steps: [
        'Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to .env.local.',
        'Restart the server, then send a test from Shop → Settings → Emails.',
      ],
      action: settingsAction,
    });
  }
  return notices;
}
