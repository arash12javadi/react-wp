/**
 * Server routes for rwp-shop, served at /api/plugins/rwp-shop/<route> by server.mjs
 * (self-hosted) and api/plugins.ts (Vercel). Registered in server/plugins.mjs.
 *
 * Nothing here trusts an amount from the browser. Payment sessions are created from the
 * order total stored by shop_place_order(), and an order is only marked paid after the
 * gateway itself reports the payment, re-checked against that total in SQL.
 */
import {
  HttpError, isShopManager, loadOrder, loadSettings, rpc, requireShopManager, select,
} from './server/supabase.mjs';
import { buildEmail, send, smtpConfigured } from './server/emails.mjs';
import {
  fromStripeAmount, paypal, paypalConfigured, paypalMode, stripe, stripeConfigured, stripeMode,
  toPaypalValue, toStripeAmount, verifyStripeSignature,
} from './server/gateways.mjs';

const customerEmailForStatus = {
  'on-hold': 'customer_on_hold',
  processing: 'customer_processing',
  completed: 'customer_completed',
  refunded: 'customer_refunded',
};

/**
 * Sends each email type at most once per order when claimOnce is true (needs the service
 * key). Returns the list of sent types; failures are reported, never thrown, because an
 * email problem must not undo a payment or an order.
 */
async function sendOrderEmails(ctx, order, types, { claimOnce, extra = {} }) {
  const sent = [];
  const problems = [];
  if (!smtpConfigured()) return { sent, skipped: 'SMTP is not configured on the server (SMTP_HOST and SMTP_FROM).' };
  const settings = await loadSettings(ctx);
  for (const type of types) {
    if (settings?.emails?.enabled && settings.emails.enabled[type] === false) continue;
    try {
      if (claimOnce) {
        const claimed = await rpc(ctx, 'shop_claim_order_email', { p_order_id: order.id, p_event: type }, 'service');
        if (!claimed) continue;
      }
      const email = await buildEmail(ctx, type, order, settings, extra);
      if (!email) continue;
      await send({ ...email, fromName: settings?.emails?.from_name });
      sent.push(type);
    } catch (error) {
      problems.push(`${type}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  return { sent, ...(problems.length ? { skipped: problems.join(' ') } : {}) };
}

async function lowStockProducts(ctx, order, settings) {
  const ids = [...new Set((order.items || []).map((item) => item.product_id).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await select(ctx, `shop_products?id=in.(${ids.join(',')})&manage_stock=eq.true&select=name,stock_quantity,low_stock_amount`);
  return rows.filter((row) => row.stock_quantity !== null
    && row.stock_quantity <= (row.low_stock_amount ?? settings?.low_stock_amount ?? 2));
}

async function afterPayment(ctx, orderId, orderKey) {
  const order = await loadOrder(ctx, orderId, orderKey);
  const types = ['new_order', customerEmailForStatus[order.status]].filter(Boolean);
  return sendOrderEmails(ctx, order, types, { claimOnce: true });
}

// Stripe -------------------------------------------------------------------------

async function confirmStripeSession(ctx, session) {
  const orderId = Number(session.metadata?.order_id);
  const orderKey = session.metadata?.order_key;
  if (!orderId || !orderKey) throw new HttpError(400, 'This Stripe session was not created by the shop (no order metadata).');
  if (session.payment_status !== 'paid') {
    return { status: 'pending', message: `Stripe reports the payment as "${session.payment_status}". The order will update when payment completes.` };
  }
  const currency = String(session.currency || '').toUpperCase();
  const result = await rpc(ctx, 'shop_mark_order_paid', {
    p_order_id: orderId,
    p_gateway: 'stripe',
    p_transaction_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || session.id,
    p_amount: fromStripeAmount(session.amount_total, currency),
    p_currency: currency,
    p_data: { stripe_session_id: session.id },
  }, 'service');
  if (!result?.ok) throw new HttpError(409, result?.error || 'The payment could not be applied to the order.');
  if (!result.already) await afterPayment(ctx, orderId, orderKey);
  return { status: result.status };
}

// PayPal -------------------------------------------------------------------------

async function confirmPaypalOrder(ctx, orderId, orderKey, paypalOrderId) {
  const order = await loadOrder(ctx, orderId, orderKey);
  let paypalOrder = await paypal('GET', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  const unit = paypalOrder.purchase_units?.[0];
  if (String(unit?.custom_id) !== String(order.id)) {
    throw new HttpError(400, 'This PayPal payment belongs to a different order.');
  }
  if (paypalOrder.status === 'APPROVED') {
    paypalOrder = await paypal('POST', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {});
  }
  const capture = paypalOrder.purchase_units?.[0]?.payments?.captures?.[0];
  if (paypalOrder.status !== 'COMPLETED' || !capture || capture.status !== 'COMPLETED') {
    return { status: order.status, message: `PayPal reports the payment as "${capture?.status || paypalOrder.status}".` };
  }
  const result = await rpc(ctx, 'shop_mark_order_paid', {
    p_order_id: order.id,
    p_gateway: 'paypal',
    p_transaction_id: capture.id,
    p_amount: Number(capture.amount.value),
    p_currency: capture.amount.currency_code,
    p_data: { paypal_order_id: paypalOrderId, paypal_capture_id: capture.id },
  }, 'service');
  if (!result?.ok) throw new HttpError(409, result?.error || 'The payment could not be applied to the order.');
  if (!result.already) await afterPayment(ctx, order.id, order.order_key);
  return { status: result.status };
}

const assertPayable = (order, gateway) => {
  if (order.payment_method !== gateway) {
    throw new HttpError(400, `Order #${order.id} was placed with ${order.payment_method_title || order.payment_method}, not ${gateway}.`);
  }
  if (!['pending', 'failed'].includes(order.status)) {
    throw new HttpError(409, `Order #${order.id} is ${order.status} and does not need payment.`);
  }
};

export default {
  id: 'rwp-shop',
  routes: {
    'POST status': async (ctx) => {
      await requireShopManager(ctx);
      return {
        status: 200,
        body: {
          service_key: Boolean(ctx.supabase.secretKey),
          stripe: stripeConfigured(),
          stripe_webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
          stripe_mode: stripeMode(),
          paypal: paypalConfigured(),
          paypal_mode: paypalMode(),
          smtp: smtpConfigured(),
          site_url: ctx.origin,
          webhook_url: `${ctx.origin}/api/plugins/rwp-shop/stripe/webhook`,
        },
      };
    },

    'POST stripe/start': async (ctx) => {
      const { order_id: orderId, order_key: orderKey } = ctx.json();
      const order = await loadOrder(ctx, orderId, orderKey);
      assertPayable(order, 'stripe');
      const key = encodeURIComponent(order.order_key);
      const session = await stripe('POST', 'checkout/sessions', {
        mode: 'payment',
        client_reference_id: String(order.id),
        customer_email: order.billing?.email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: toStripeAmount(order.total, order.currency),
            product_data: {
              name: `Order #${order.id}`,
              description: (order.items || []).map((item) => `${item.name} × ${item.quantity}`).join(', ').slice(0, 500) || undefined,
            },
          },
        }],
        metadata: { order_id: String(order.id), order_key: order.order_key },
        payment_intent_data: { metadata: { order_id: String(order.id) } },
        success_url: `${ctx.origin}/checkout/order-received/${order.id}?key=${key}&stripe_session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${ctx.origin}/checkout/order-pay/${order.id}?key=${key}&error=${encodeURIComponent('Payment was cancelled. You can try again below.')}`,
      });
      if (ctx.supabase.secretKey) {
        await rpc(ctx, 'shop_set_gateway_data', { p_order_id: order.id, p_data: { stripe_session_id: session.id } }, 'service').catch(() => {});
      }
      return { status: 200, body: { url: session.url } };
    },

    'POST stripe/confirm': async (ctx) => {
      const { order_id: orderId, order_key: orderKey, reference } = ctx.json();
      const order = await loadOrder(ctx, orderId, orderKey);
      if (!/^cs_[A-Za-z0-9_]+$/.test(String(reference || ''))) throw new HttpError(400, 'A valid Stripe session id is required.');
      const session = await stripe('GET', `checkout/sessions/${reference}`);
      if (String(session.metadata?.order_id) !== String(order.id) || session.metadata?.order_key !== order.order_key) {
        throw new HttpError(400, 'This Stripe payment belongs to a different order.');
      }
      return { status: 200, body: await confirmStripeSession(ctx, session) };
    },

    'POST stripe/webhook': async (ctx) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return { status: 501, body: { error: 'STRIPE_WEBHOOK_SECRET is not set on the server.' } };
      if (!verifyStripeSignature(ctx.rawBody, ctx.headers['stripe-signature'], secret)) {
        return { status: 400, body: { error: 'Invalid Stripe signature.' } };
      }
      const event = JSON.parse(ctx.rawBody.toString('utf8'));
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        const session = event.data?.object;
        // Only sessions this shop created carry an order key.
        if (session?.metadata?.order_key) await confirmStripeSession(ctx, session);
      }
      return { status: 200, body: { received: true } };
    },

    'POST paypal/start': async (ctx) => {
      const { order_id: orderId, order_key: orderKey } = ctx.json();
      const order = await loadOrder(ctx, orderId, orderKey);
      assertPayable(order, 'paypal');
      const key = encodeURIComponent(order.order_key);
      const created = await paypal('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: String(order.id),
          custom_id: String(order.id),
          description: `Order #${order.id}`,
          amount: { currency_code: order.currency, value: toPaypalValue(order.total, order.currency) },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: `${ctx.origin}/checkout/order-received/${order.id}?key=${key}&paypal=1`,
              cancel_url: `${ctx.origin}/checkout/order-pay/${order.id}?key=${key}&error=${encodeURIComponent('Payment was cancelled. You can try again below.')}`,
            },
          },
        },
      });
      const approve = (created.links || []).find((link) => link.rel === 'payer-action' || link.rel === 'approve');
      if (!approve) throw new HttpError(502, 'PayPal did not return an approval link.');
      if (ctx.supabase.secretKey) {
        await rpc(ctx, 'shop_set_gateway_data', { p_order_id: order.id, p_data: { paypal_order_id: created.id } }, 'service').catch(() => {});
      }
      return { status: 200, body: { url: approve.href } };
    },

    'POST paypal/confirm': async (ctx) => {
      const { order_id: orderId, order_key: orderKey, reference } = ctx.json();
      if (!/^[A-Z0-9]+$/.test(String(reference || ''))) throw new HttpError(400, 'A valid PayPal order id is required.');
      return { status: 200, body: await confirmPaypalOrder(ctx, orderId, orderKey, reference) };
    },

    'POST orders/notify': async (ctx) => {
      const body = ctx.json();
      const manager = await isShopManager(ctx);
      const event = String(body.event || '');
      const order = await loadOrder(ctx, body.order_id, body.order_key, manager ? 'user' : 'anon');
      const settings = await loadSettings(ctx);

      if (event === 'placed') {
        // Anyone holding the order key may trigger this once; the claims make repeats no-ops.
        if (!ctx.supabase.secretKey && !manager) {
          return { status: 200, body: { sent: [], skipped: 'SUPABASE_SECRET_KEY is not set, so emails for new orders are not sent.' } };
        }
        const types = order.status === 'pending' ? [] : ['new_order', customerEmailForStatus[order.status]].filter(Boolean);
        const result = await sendOrderEmails(ctx, order, types, { claimOnce: Boolean(ctx.supabase.secretKey) });
        const low = await lowStockProducts(ctx, order, settings).catch(() => []);
        if (low.length && settings?.notify_low_stock !== false) {
          const stock = await sendOrderEmails(ctx, order, ['low_stock'], { claimOnce: Boolean(ctx.supabase.secretKey), extra: { products: low } });
          result.sent.push(...stock.sent);
        }
        return { status: 200, body: result };
      }

      if (!manager) throw new HttpError(403, 'Only shop managers can send this email.');

      let types = [];
      const extra = {};
      if (event.startsWith('status:')) {
        const status = event.slice(7);
        types = status === 'cancelled' ? ['cancelled_order']
          : status === 'failed' ? ['failed_order']
            : [customerEmailForStatus[status]].filter(Boolean);
      } else if (event === 'customer_note') {
        types = ['customer_note'];
        extra.note = String(body.note || '');
      } else if (event === 'refunded') {
        types = ['customer_refunded'];
        extra.amount = Number(body.amount) || 0;
      } else if (event === 'resend:new_order') {
        types = ['new_order'];
      } else if (event === 'resend:customer') {
        types = ['customer_invoice'];
      } else {
        throw new HttpError(400, `Unknown email event "${event}".`);
      }
      // Manager actions are explicit, so they send every time rather than once per order.
      return { status: 200, body: await sendOrderEmails(ctx, order, types, { claimOnce: false, extra }) };
    },

    'POST refunds/create': async (ctx) => {
      await requireShopManager(ctx);
      const body = ctx.json();
      const order = await loadOrder(ctx, body.order_id, '', 'user');
      const amount = Number(body.amount);
      const refundable = Number(order.total) - Number(order.refunded_total);
      if (!(amount > 0) || amount > refundable + 0.00001) {
        throw new HttpError(400, `The refund amount must be between 0 and ${refundable}.`);
      }
      if (!order.transaction_id) throw new HttpError(400, 'This order has no gateway transaction to refund. Use a manual refund.');

      let gatewayRefundId;
      if (order.payment_method === 'stripe') {
        const refund = await stripe('POST', 'refunds', {
          payment_intent: order.transaction_id,
          amount: toStripeAmount(amount, order.currency),
          metadata: { order_id: String(order.id), reason: String(body.reason || '').slice(0, 450) },
        });
        gatewayRefundId = refund.id;
      } else if (order.payment_method === 'paypal') {
        const refund = await paypal('POST', `/v2/payments/captures/${encodeURIComponent(order.transaction_id)}/refund`, {
          amount: { value: toPaypalValue(amount, order.currency), currency_code: order.currency },
          note_to_payer: String(body.reason || '').slice(0, 255) || undefined,
        });
        gatewayRefundId = refund.id;
      } else {
        throw new HttpError(400, `${order.payment_method_title || order.payment_method} does not support automatic refunds. Use a manual refund.`);
      }

      try {
        await rpc(ctx, 'shop_create_refund', {
          p_order_id: order.id,
          p_amount: amount,
          p_reason: String(body.reason || ''),
          p_items: Array.isArray(body.items) ? body.items : [],
          p_refunded_payment: true,
          p_gateway_refund_id: gatewayRefundId,
        }, 'user');
      } catch (error) {
        throw new HttpError(500, `The money WAS refunded at ${order.payment_method} (refund ${gatewayRefundId}), but recording it in the shop failed: ${error instanceof Error ? error.message : 'unknown error'}. Record it with “Refund manually” so the order totals are correct — do not refund again at the gateway.`);
      }

      const updated = await loadOrder(ctx, order.id, '', 'user');
      const emails = await sendOrderEmails(ctx, updated, ['customer_refunded'], { claimOnce: false, extra: { amount } });
      return { status: 200, body: { refund_id: gatewayRefundId, emails } };
    },

    'POST emails/test': async (ctx) => {
      await requireShopManager(ctx);
      const { to } = ctx.json();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) throw new HttpError(400, 'Enter a valid email address.');
      await send({
        to: [to],
        subject: 'Test email from your shop',
        html: '<p>This is a test email from RWP Shop. If you are reading it, SMTP is configured correctly.</p>',
      }).catch((error) => {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, `The SMTP server rejected the email: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
      return { status: 200, body: { sent: true } };
    },
  },
};
