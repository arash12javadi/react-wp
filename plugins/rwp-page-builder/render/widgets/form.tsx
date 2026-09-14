import { useId, useState, type FormEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../../../../src/lib/db';
import { alignControl, colorControl, opts, typographyControl } from '../../lib/controls';
import type { WidgetDefinition } from '../../lib/registry';
import { safeUrl } from '../../lib/sanitize';
import { border, boxSides, color, isSet, length, typography, type Border, type Box, type Typography } from '../../lib/style';
import type { FormField } from '../../lib/types';
import { useRenderContext } from '../context';
import { useText } from './shared';

export const FORM_ENDPOINT = '/api/plugins/rwp-page-builder/forms/submit';

interface SubmitResult { ok: boolean; message?: string; error?: string; errors?: Record<string, string>; redirect_url?: string | null }

/**
 * The server route validates through builder_submit_form() and then sends the notification
 * email. If the server is unreachable (e.g. `npm run dev` without `npm start`), the entry is
 * still stored by calling the same function directly; only the email is skipped.
 */
async function submitForm(pageId: number, formId: string, fields: Record<string, unknown>, honeypot: string): Promise<SubmitResult> {
  try {
    const response = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: pageId, form_id: formId, fields, hp: honeypot }),
    });
    const payload = await response.json().catch(() => null) as SubmitResult | { error?: string } | null;
    if (payload && 'ok' in payload) return payload;
    if (response.status !== 404 && payload?.error) return { ok: false, error: payload.error };
    if (response.status !== 404) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn('[rwp-page-builder] Form server route unavailable; storing the entry directly without email.', error);
  }
  if (honeypot) return { ok: true };
  const { data, error } = await getSupabaseClient().rpc('builder_submit_form', { p_page_id: pageId, p_form_id: formId, p_fields: fields });
  if (error) {
    return {
      ok: false,
      error: /builder_submit_form/.test(describeDbError(error))
        ? 'Forms are not set up on this site yet: run supabase/migrations/20260918_page_builder.sql.'
        : describeDbError(error),
    };
  }
  return data as SubmitResult;
}

const newField = (type: FormField['type'] = 'text'): FormField => ({
  id: `field_${Math.random().toString(36).slice(2, 7)}`, type, label: 'New field', required: false, width: '100',
});

export const form: WidgetDefinition = {
  type: 'form',
  label: 'Form',
  icon: 'inbox',
  category: 'pro',
  keywords: ['contact', 'lead', 'newsletter', 'email'],
  defaults: () => ({
    settings: {
      form_name: 'Contact form',
      fields: [
        { id: 'name', type: 'text', label: 'Name', placeholder: 'Your name', required: true, width: '50' },
        { id: 'email', type: 'email', label: 'Email', placeholder: 'you@example.com', required: true, width: '50' },
        { id: 'message', type: 'textarea', label: 'Message', placeholder: 'How can we help?', required: true, width: '100' },
      ] satisfies FormField[],
      submitText: 'Send message',
      success_message: 'Thanks! We will get back to you soon.',
      actions: ['save'],
      redirect_url: '',
      showLabels: true,
    },
  }),
  controls: [
    { key: 'form_name', label: 'Form name', type: 'text', help: 'Shown on the Submissions screen and in notification emails.' },
    { key: 'fields', label: 'Fields', type: 'formFields', newItem: () => newField() as unknown as Record<string, unknown> },
    { key: 'showLabels', label: 'Show labels', type: 'toggle' },
    { key: 'submitText', label: 'Submit button text', type: 'text' },
    { key: '_actions', label: 'Actions after submit', type: 'heading' },
    { key: 'success_message', label: 'Success message', type: 'textarea' },
    { key: 'formEmail', label: 'Email notification', type: 'formEmail' },
    { key: 'redirect_url', label: 'Redirect to URL', type: 'text', placeholder: '/thank-you', help: 'Optional. Visitors go here after a successful submission.' },
    alignControl('buttonAlign', 'Button alignment', true),
    { key: 'fieldGap', label: 'Space between fields (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    colorControl('labelColor', 'Label colour'),
    typographyControl('labelTypography', 'Label typography'),
    colorControl('fieldText', 'Field text colour'),
    colorControl('fieldBg', 'Field background'),
    { key: 'fieldBorder', label: 'Field border', type: 'border', tab: 'style' },
    colorControl('buttonText', 'Button text colour'),
    colorControl('buttonBg', 'Button background'),
    colorControl('buttonHoverBg', 'Button hover background'),
    { key: 'buttonPadding', label: 'Button padding', type: 'dimensions', tab: 'style', units: ['px', 'em'] },
  ],
  css: (bag) => ({
    ' .rwpb-form': { gap: length(bag.fieldGap ?? 16, 'px') },
    ' .rwpb-form label': { color: color(bag.labelColor), ...typography(bag.labelTypography as Typography | undefined) },
    ' .rwpb-form-control': { color: color(bag.fieldText), 'background-color': color(bag.fieldBg), ...border(bag.fieldBorder as Border | undefined) },
    ' .rwpb-form-actions': { 'justify-content': bag.buttonAlign === 'center' ? 'center' : bag.buttonAlign === 'right' ? 'flex-end' : undefined },
    ' .rwpb-form-submit': {
      width: bag.buttonAlign === 'justify' ? '100%' : undefined,
      color: color(bag.buttonText),
      'background-color': color(bag.buttonBg),
      ...boxSides('padding', bag.buttonPadding as Box | undefined),
    },
    ' .rwpb-form-submit:hover': { 'background-color': isSet(bag.buttonHoverBg) ? color(bag.buttonHoverBg) : undefined },
  }),
  View: function FormView({ node }) {
    const { mode, pageId } = useRenderContext();
    const uid = useId();
    const fields = (Array.isArray(node.settings.fields) ? node.settings.fields : []) as FormField[];
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [honeypot, setHoneypot] = useState('');
    const [status, setStatus] = useState<{ state: 'idle' | 'sending' | 'done' | 'error'; message: string; errors: Record<string, string> }>({ state: 'idle', message: '', errors: {} });
    const submitText = useText(node.settings.submitText || 'Submit');
    const showLabels = node.settings.showLabels !== false;

    const submit = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (mode === 'edit') return;
      if (!pageId) {
        setStatus({ state: 'error', message: 'This form only works on a published page.', errors: {} });
        return;
      }
      setStatus({ state: 'sending', message: '', errors: {} });
      const result = await submitForm(pageId, node.id, values, honeypot);
      if (!result.ok) {
        setStatus({ state: 'error', message: result.error || 'The form could not be sent.', errors: result.errors || {} });
        return;
      }
      const redirect = safeUrl(result.redirect_url || '');
      if (redirect && redirect !== '#') {
        window.location.href = redirect;
        return;
      }
      setValues({});
      setStatus({ state: 'done', message: result.message || 'Thanks! Your submission has been received.', errors: {} });
    };

    if (status.state === 'done') return <div className="rwpb-form-success" role="status">{status.message}</div>;

    const set = (id: string, value: unknown) => setValues((current) => ({ ...current, [id]: value }));

    return (
      <form className="rwpb-form" onSubmit={submit} noValidate={mode === 'edit'}>
        {/* Honeypot: invisible to people, filled in by naive bots. */}
        <input className="rwpb-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="company_website" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
        {fields.map((field) => {
          const id = `${uid}-${field.id}`;
          const error = status.errors[field.id];
          const label = <>{field.label}{field.required && <span className="rwpb-required" aria-hidden="true"> *</span>}</>;
          const common = {
            id, name: field.id, required: field.required, 'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? `${id}-error` : undefined,
          };
          let control;
          if (field.type === 'textarea') {
            control = <textarea {...common} className="rwpb-form-control" rows={5} placeholder={field.placeholder} value={String(values[field.id] ?? '')} onChange={(event) => set(field.id, event.target.value)} />;
          } else if (field.type === 'select') {
            control = (
              <select {...common} className="rwpb-form-control" value={String(values[field.id] ?? '')} onChange={(event) => set(field.id, event.target.value)}>
                <option value="">{field.placeholder || 'Choose…'}</option>
                {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            );
          } else if (field.type === 'checkbox' && field.options?.length) {
            const picked = (values[field.id] as string[] | undefined) || [];
            control = (
              <span className="rwpb-form-choices" role="group" aria-labelledby={`${id}-label`}>
                {field.options.map((option) => (
                  <label key={option} className="rwpb-form-choice">
                    <input type="checkbox" checked={picked.includes(option)} onChange={(event) => set(field.id, event.target.checked ? [...picked, option] : picked.filter((item) => item !== option))} /> {option}
                  </label>
                ))}
              </span>
            );
          } else if (field.type === 'checkbox') {
            return (
              <div key={field.id} className={`rwpb-form-field rwpb-form-w${field.width === '50' ? '50' : '100'}`}>
                <label className="rwpb-form-choice"><input {...common} type="checkbox" checked={Boolean(values[field.id])} onChange={(event) => set(field.id, event.target.checked)} /> {label}</label>
                {error && <span id={`${id}-error`} className="rwpb-form-error">{error}</span>}
              </div>
            );
          } else {
            control = <input {...common} className="rwpb-form-control" type={field.type === 'email' ? 'email' : 'text'} placeholder={field.placeholder} value={String(values[field.id] ?? '')} onChange={(event) => set(field.id, event.target.value)} />;
          }
          return (
            <div key={field.id} className={`rwpb-form-field rwpb-form-w${field.width === '50' ? '50' : '100'}`}>
              {field.type === 'checkbox'
                ? <span id={`${id}-label`} className="rwpb-form-label">{label}</span>
                : <label htmlFor={id} className={showLabels ? 'rwpb-form-label' : 'rwpb-sr-only'}>{label}</label>}
              {control}
              {error && <span id={`${id}-error`} className="rwpb-form-error">{error}</span>}
            </div>
          );
        })}
        {status.state === 'error' && status.message && <div className="rwpb-form-alert" role="alert">{status.message}</div>}
        <div className="rwpb-form-actions">
          <button type="submit" className="rwpb-button rwpb-button-md rwpb-form-submit" disabled={status.state === 'sending'}>
            {status.state === 'sending' ? 'Sending…' : submitText}
          </button>
        </div>
      </form>
    );
  },
};

export const formFieldTypes = opts(['text', 'Text'], ['email', 'Email'], ['textarea', 'Textarea'], ['select', 'Select'], ['checkbox', 'Checkbox']);
export { newField };
