import { tryGetSupabaseClient, describeDbError } from '../../../src/lib/db';
import { directionOf, getLocale, getSurface, lookupTranslation, subscribeLocale } from '../../../src/lib/i18n';
import {
  formatLocalDate, hasLetters, maxPhraseLength, normalizePhrase, phraseGroup, phraseKey, phraseSource, phraseTarget,
  translateText,
} from './phrases';
import { getPoSettings, subscribePoSettings } from './settings';

/**
 * Translates the rendered public page, text node by text node.
 *
 * Every text node and translatable attribute (placeholder, title, aria-label, alt, a button's
 * value) keeps its original in a WeakMap. On a language change, a new node, or new strings
 * arriving, the node is rewritten from that original — so switching back restores the exact
 * English, and nothing is ever translated twice.
 *
 * Why this is safe with React: text is changed in place (nodeValue / setAttribute), never by
 * replacing nodes, so every node React holds a reference to stays the same node. When React
 * later writes a new value, the value no longer matches what we wrote, so it becomes the new
 * original. The MutationObserver callback runs as a microtask right after React commits, before
 * the browser paints, so visitors do not see the English first.
 *
 * Left alone: code, form values, anything marked translate="no", .notranslate, data-po-skip or
 * data-rwp-user-content (comments), page translations (.po-text, already bilingual) and this
 * plugin's own controls (they use t()).
 */

const excluded = [
  'script', 'style', 'noscript', 'template', 'code', 'pre', 'kbd', 'samp', 'textarea', 'svg', 'math',
  '[contenteditable]:not([contenteditable="false"])', '[translate="no"]', '.notranslate', '[data-po-skip]',
  '[data-rwp-user-content]', '.po-text', '.po-switch-outer', '.po-settings', '.po-translator',
].join(',');

const attributes = ['placeholder', 'title', 'aria-label', 'alt', 'aria-placeholder', 'value', 'label'];
const buttonTypes = new Set(['submit', 'button', 'reset']);

interface Record { source: string; written: string }

const texts = new WeakMap<Text, Record>();
const attributeRecords = new WeakMap<Element, Map<string, Record>>();

let observer: MutationObserver | null = null;
let titleObserver: MutationObserver | null = null;
let titleRecord: Record | null = null;
let running = false;

const isExcluded = (element: Element | null) => !element || Boolean(element.closest(excluded));

/** Only a submit/button input's value is text a visitor reads; any other value is data. */
const translatableAttribute = (element: Element, name: string) =>
  name !== 'value' || (element instanceof HTMLInputElement && buttonTypes.has(element.type));

// Collecting untranslated text (administrators only) -----------------------------------------------------------

let canCollect = false;
let collectDisabled = false;
const collected = new Set<string>();
const collectQueue = new Map<string, string>();
let collectTimer: number | undefined;

/** Called by the runtime once it knows the viewer may translate. */
export const setCollecting = (enabled: boolean) => { canCollect = enabled; };

const scriptOf = (text: string) => ({
  arabic: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text),
  latin: /[A-Za-z]/.test(text),
});

/** Whether text shown while the target language is active still looks like the source language. */
const looksUntranslated = (text: string) => {
  const script = scriptOf(text);
  return directionOf(phraseTarget()) === 'rtl' ? script.latin && !script.arabic : !script.latin && script.arabic;
};

const flushCollected = async () => {
  collectTimer = undefined;
  const supabase = tryGetSupabaseClient();
  const batch = [...collectQueue.entries()];
  collectQueue.clear();
  if (!supabase || !batch.length || collectDisabled) return;
  const target = phraseTarget();
  for (let start = 0; start < batch.length; start += 200) {
    const rows = batch.slice(start, start + 200).map(([key, source]) => ({
      translation_key: key, locale: target, translation_value: null, source_text: source, group_name: phraseGroup,
    }));
    // ignoreDuplicates: an existing row, translated or not, is never touched.
    const { error } = await supabase.from('rwp_translations')
      .upsert(rows, { onConflict: 'translation_key,locale', ignoreDuplicates: true });
    if (error) {
      console.warn(`Site text could not be collected: ${describeDbError(error)}`);
      if (/schema cache|does not exist|PGRST205|42P01|row-level security/i.test(describeDbError(error))) collectDisabled = true;
      return;
    }
  }
};

function collect(source: string, translated: boolean) {
  if (!canCollect || collectDisabled || !getPoSettings().collect_text) return;
  const text = normalizePhrase(source);
  if (!text || text.length > maxPhraseLength || !hasLetters(text)) return;
  const active = getLocale();
  const target = phraseTarget();
  // Viewing the source language: anything the target lacks. Viewing the target: what was left in the source language.
  if (active === phraseSource()) {
    if (lookupTranslation(target, phraseKey(text)) !== undefined) return;
  } else if (active === target) {
    if (translated || !looksUntranslated(text)) return;
  } else {
    return;
  }
  const key = phraseKey(text);
  if (collected.has(key)) return;
  collected.add(key);
  collectQueue.set(key, text);
  if (collectTimer === undefined) collectTimer = window.setTimeout(() => void flushCollected(), 3000);
}

// Translating ------------------------------------------------------------------------------------------------------

/** <time datetime="…"> is rendered from its machine-readable date, not by parsing the text. */
function timeText(node: Text, source: string, locale: string): string | null {
  const parent = node.parentElement;
  if (!(parent instanceof HTMLTimeElement) || !getPoSettings().localize_dates || locale.startsWith('en')) return null;
  // Only when the date is the element's whole text; "Published <time>…</time>" keeps its words.
  if (parent.childNodes.length !== 1 || !/\d/.test(source)) return null;
  const date = new Date(parent.dateTime || parent.getAttribute('datetime') || '');
  return Number.isNaN(date.getTime()) ? null : formatLocalDate(date, locale) || null;
}

/** `checked`: the caller's walk already rejected excluded branches, so the ancestor check is skipped. */
function processText(node: Text, checked = false) {
  const current = node.nodeValue ?? '';
  let record = texts.get(node);
  // New, or rewritten by React since we last wrote it: what is there now is the original.
  if (!record || current !== record.written) record = { source: current, written: current };
  if (!/\S/.test(record.source) || (!checked && isExcluded(node.parentElement))) {
    texts.set(node, record);
    return;
  }
  const locale = getLocale();
  const fromTime = timeText(node, record.source, locale);
  const { text, translated } = fromTime !== null ? { text: fromTime, translated: false } : translateText(record.source, locale);
  if (text !== current) node.nodeValue = text;
  record.written = text;
  texts.set(node, record);
  collect(record.source, translated);
}

function processAttribute(element: Element, name: string) {
  if (!translatableAttribute(element, name) || isExcluded(element)) return;
  const current = element.getAttribute(name);
  if (current === null) return;
  const records = attributeRecords.get(element) || new Map<string, Record>();
  let record = records.get(name);
  if (!record || current !== record.written) record = { source: current, written: current };
  const { text, translated } = translateText(record.source, getLocale());
  if (text !== current) element.setAttribute(name, text);
  record.written = text;
  records.set(name, record);
  attributeRecords.set(element, records);
  collect(record.source, translated);
}

const attributeSelector = attributes.map((name) => `[${name}]`).join(',');

function processTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    processText(root as Text);
    return;
  }
  // An excluded element excludes everything inside it, so the whole branch is skipped.
  if (!(root instanceof Element) || isExcluded(root)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.nodeType === Node.TEXT_NODE
      ? NodeFilter.FILTER_ACCEPT
      : (node as Element).matches(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => processText(node, true));
  const elements = root.matches(attributeSelector) ? [root, ...root.querySelectorAll(attributeSelector)] : [...root.querySelectorAll(attributeSelector)];
  elements.forEach((element) => attributes.forEach((name) => { if (element.hasAttribute(name)) processAttribute(element, name); }));
}

function handle(records: MutationRecord[]) {
  records.forEach((record) => {
    if (record.type === 'characterData') processText(record.target as Text);
    else if (record.type === 'attributes' && record.attributeName) processAttribute(record.target as Element, record.attributeName);
    else record.addedNodes.forEach((node) => processTree(node));
  });
}

/** Runs `work`, then drops the mutation records our own writes produced. */
function withoutEcho(work: () => void) {
  if (observer) handle(observer.takeRecords());
  work();
  observer?.takeRecords();
}

// The tab title: "Page ‹ Site", translated part by part ----------------------------------------------------------------

function processTitle() {
  const element = document.querySelector('title');
  if (!element) return;
  const current = document.title;
  if (!titleRecord || current !== titleRecord.written) titleRecord = { source: current, written: current };
  const locale = getLocale();
  const text = titleRecord.source.split(' ‹ ').map((part) => translateText(part, locale).text).join(' ‹ ');
  if (text !== current) document.title = text;
  titleRecord.written = text;
  titleObserver?.takeRecords();
}

/** Re-translates everything on the page, e.g. after a language switch or a saved translation. */
export function retranslatePage() {
  if (!running || !document.body) return;
  withoutEcho(() => processTree(document.body));
  processTitle();
}

let pending = false;
const scheduleRetranslate = () => {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    retranslatePage();
  });
};

// Reading originals for the translate mode -----------------------------------------------------------------------------

/** The original text of a node this translator handles, or null for one it leaves alone. */
export const sourceOfText = (node: Text): string | null => {
  if (isExcluded(node.parentElement)) return null;
  const record = texts.get(node);
  const source = record && node.nodeValue === record.written ? record.source : node.nodeValue;
  return source && hasLetters(source) ? normalizePhrase(source) : null;
};

export const sourceOfAttribute = (element: Element, name: string): string | null => {
  if (isExcluded(element)) return null;
  const record = attributeRecords.get(element)?.get(name);
  const current = element.getAttribute(name);
  const source = record && current === record.written ? record.source : current;
  return source && hasLetters(source) ? normalizePhrase(source) : null;
};

export const isInsidePageTranslation = (node: Node) => Boolean((node instanceof Element ? node : node.parentElement)?.closest('.po-text'));

// Start and stop ------------------------------------------------------------------------------------------------------------

/**
 * Starts translating the public site. Returns the cleanup, which puts every original text and
 * attribute back before it stops, so deactivating the plugin leaves an untouched page.
 */
export function startPageTranslator(): () => void {
  if (typeof document === 'undefined' || getSurface() !== 'public') return () => undefined;
  const cleanups: Array<() => void> = [];

  const start = () => {
    if (running || !document.body) return;
    running = true;
    observer = new MutationObserver(handle);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
    const title = document.querySelector('title');
    if (title) {
      titleObserver = new MutationObserver(processTitle);
      titleObserver.observe(title, { subtree: true, childList: true, characterData: true });
    }
    retranslatePage();
  };

  const stop = () => {
    if (!running) return;
    observer?.disconnect();
    titleObserver?.disconnect();
    observer = null;
    titleObserver = null;
    running = false;
    // Put the originals back.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const record = texts.get(node);
      if (record && node.nodeValue === record.written && record.written !== record.source) node.nodeValue = record.source;
    }
    document.body.querySelectorAll(attributeSelector).forEach((element) => {
      attributeRecords.get(element)?.forEach((record, name) => {
        if (element.getAttribute(name) === record.written && record.written !== record.source) element.setAttribute(name, record.source);
      });
    });
    if (titleRecord && document.title === titleRecord.written) document.title = titleRecord.source;
    titleRecord = null;
  };

  const sync = () => (getPoSettings().translate_site ? start() : stop());
  sync();
  // A language switch, or strings arriving (a locale's database strings, a saved phrase).
  cleanups.push(subscribeLocale(() => { if (running) scheduleRetranslate(); }));
  cleanups.push(subscribePoSettings(() => {
    sync();
    if (running) scheduleRetranslate();
  }));

  return () => {
    cleanups.forEach((cleanup) => cleanup());
    stop();
    window.clearTimeout(collectTimer);
  };
}
