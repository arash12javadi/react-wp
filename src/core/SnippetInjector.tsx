/**
 * Runs the snippets saved in public.code_snippets (the Code Snippets screen).
 *
 * Four kinds, each applied differently:
 *   css         a <style> element in <head>
 *   javascript  a <script> element whose code runs inside an IIFE with a try/catch around it
 *   html        the markup as written, with any <script> in it re-created so it executes
 *   hook        evaluated with `new Function`, receiving the hook registry as `rwp`
 *
 * None of this is sandboxed, and it is not meant to be: running the administrator's own code is
 * the entire point of the feature, exactly like the Theme Editor's code areas. What protects the
 * site is that only manage_options may write the table (see the migration), that a snippet has to
 * be switched on, and that everything here is undoable — every element and every hook a snippet
 * registers is tracked, so switching it off removes it completely without a reload.
 *
 * Errors are caught per snippet. One snippet that throws must not stop the others, and must never
 * stop the page rendering; the failure is logged and kept in the runtime report, which
 * the Code Snippets screen → Status shows.
 */

import React, { useEffect, type ReactNode } from 'react';
import { addAction, addFilter, applyFilters, doAction, DEFAULT_PRIORITY } from './hooks';
import { addSlotContent } from './HookSlot';
import {
  fetchActiveSnippets, type CodeSnippet, type SnippetSurface,
} from '../lib/snippets';
import { describeDbError } from '../lib/db';

/**
 * What a hook snippet's code is given. The same registry every plugin uses, plus React itself:
 * a snippet is evaluated, not compiled, so it has no JSX and no imports — `rwp.React.createElement`
 * is the only way it can put markup into a layout zone.
 */
export interface SnippetHookApi {
  addAction: (name: string, callback: (...args: any[]) => void, priority?: number) => void;
  addFilter: (name: string, callback: (value: any, ...args: any[]) => any, priority?: number) => void;
  addSlotContent: (name: string, id: string, render: (args: Record<string, unknown>) => ReactNode, priority?: number) => void;
  applyFilters: typeof applyFilters;
  doAction: typeof doAction;
  React: typeof React;
  DEFAULT_PRIORITY: number;
}

export interface SnippetRunReport {
  /** When the snippets were last loaded and applied. */
  at: number;
  surface: SnippetSurface;
  applied: number;
  /** Why the whole load failed (no table yet, offline, RLS), or ''. */
  loadError: string;
  /** One entry per snippet that threw while being applied. */
  failures: Array<{ id: string; title: string; message: string }>;
}

type Cleanup = () => void;

const elementId = (snippet: CodeSnippet) => `rwp-snippet-${snippet.snippet_type}-${snippet.id}`;

/**
 * Appends `html` to `parent`, returning the nodes it added.
 *
 * <script> elements created by the HTML parser never execute, so each one is rebuilt as a fresh
 * element. Anyone who saves an HTML snippet with a script in it means it to run — silently
 * dropping it would look like the snippet was ignored.
 */
function appendHtml(parent: Node, html: string): ChildNode[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  const added: ChildNode[] = [];
  for (const node of [...template.content.childNodes]) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : null;
    if (element?.tagName === 'SCRIPT') {
      const script = document.createElement('script');
      for (const attribute of [...element.attributes]) script.setAttribute(attribute.name, attribute.value);
      script.textContent = element.textContent;
      parent.appendChild(script);
      added.push(script);
      continue;
    }
    parent.appendChild(node);
    added.push(node as ChildNode);
  }
  return added;
}

/** A JS snippet gets its own scope, so two snippets can both declare `const items`. */
const wrapJavaScript = (snippet: CodeSnippet) => [
  '(function () { try {',
  snippet.code,
  `} catch (error) { console.error(${JSON.stringify(`[rwp-code-snippets] The JavaScript snippet "${snippet.title}" threw:`)}, error); } })();`,
].join('\n');

function applyCss(snippet: CodeSnippet): Cleanup {
  const style = document.createElement('style');
  style.id = elementId(snippet);
  style.setAttribute('data-rwp-snippet', snippet.id);
  // textContent, never innerHTML: the browser does not re-parse it, so "</style>" in a comment
  // cannot close the element early.
  style.textContent = snippet.code;
  document.head.appendChild(style);
  return () => style.remove();
}

function applyJavaScript(snippet: CodeSnippet): Cleanup {
  const script = document.createElement('script');
  script.id = elementId(snippet);
  script.setAttribute('data-rwp-snippet', snippet.id);
  script.textContent = wrapJavaScript(snippet);
  // 'head' puts it in <head>, where it runs before the rest of the page finishes; anything else
  // goes at the end of <body>, where the DOM it wants to touch already exists.
  (snippet.location === 'head' ? document.head : document.body).appendChild(script);
  // Removing the element does not undo what the code already did — only a reload does. Documented
  // on the editor screen, because it is the one thing about snippets that surprises people.
  return () => script.remove();
}

function applyHtml(snippet: CodeSnippet): Cleanup {
  if (snippet.location === 'head') {
    const nodes = appendHtml(document.head, snippet.code);
    return () => nodes.forEach((node) => node.remove());
  }
  const container = document.createElement('div');
  container.id = elementId(snippet);
  container.setAttribute('data-rwp-snippet', snippet.id);
  document.body.appendChild(container);
  appendHtml(container, snippet.code);
  return () => container.remove();
}

function applyHook(snippet: CodeSnippet): Cleanup {
  const removers: Cleanup[] = [];
  const api: SnippetHookApi = {
    addAction: (name, callback, priority = DEFAULT_PRIORITY) => { removers.push(addAction(name, callback, priority)); },
    addFilter: (name, callback, priority = DEFAULT_PRIORITY) => { removers.push(addFilter(name, callback, priority)); },
    addSlotContent: (name, id, render, priority = DEFAULT_PRIORITY) => { removers.push(addSlotContent(name, id, render, priority)); },
    applyFilters,
    doAction,
    React,
    DEFAULT_PRIORITY,
  };
  // new Function, not eval: the code gets the global scope and its own parameters, and cannot see
  // or overwrite the local variables of this module.
  const run = new Function('rwp', 'snippet', `"use strict";\n${snippet.code}\n`) as (
    rwp: SnippetHookApi, meta: { id: string; title: string },
  ) => unknown;
  const returned = run(api, { id: snippet.id, title: snippet.title });
  if (typeof returned === 'function') removers.push(returned as Cleanup);
  return () => removers.forEach((remove) => {
    try {
      remove();
    } catch (error) {
      console.error(`[rwp-code-snippets] Cleaning up the hook snippet "${snippet.title}" threw.`, error);
    }
  });
}

const appliers: Record<CodeSnippet['snippet_type'], (snippet: CodeSnippet) => Cleanup> = {
  css: applyCss,
  javascript: applyJavaScript,
  html: applyHtml,
  hook: applyHook,
};

// The runtime ------------------------------------------------------------------------------------
// One per document. Starting it twice (the plugin on activation, a component mounting) reuses the
// running one and only bumps a reference count, so nothing is ever injected twice.

interface Runtime {
  surface: SnippetSurface;
  cleanups: Map<string, Cleanup>;
  references: number;
  /** Bumped by every refresh, so a slow load that was superseded discards its own result. */
  generation: number;
}

let runtime: Runtime | null = null;
let report: SnippetRunReport = { at: 0, surface: 'public', applied: 0, loadError: '', failures: [] };
const listeners = new Set<() => void>();

const publish = (next: SnippetRunReport) => {
  report = next;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('[rwp-code-snippets] A runtime subscriber threw.', error);
    }
  });
};

/** The result of the last load: what ran, and what failed. Read by the Status screen. */
export const getSnippetRunReport = (): SnippetRunReport => report;

export const subscribeSnippetRuntime = (listener: () => void): Cleanup => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function removeAll(current: Runtime) {
  current.cleanups.forEach((cleanup, id) => {
    try {
      cleanup();
    } catch (error) {
      console.error(`[rwp-code-snippets] Removing snippet ${id} threw.`, error);
    }
  });
  current.cleanups.clear();
}

async function load(current: Runtime) {
  const generation = current.generation;
  let snippets: CodeSnippet[];
  try {
    snippets = await fetchActiveSnippets(current.surface);
  } catch (error) {
    // A site that has not run the migration yet, or a network blip during a refresh. Whatever is
    // already applied stays applied: dropping working snippets because one fetch failed would
    // restyle the page for no reason. The failure is reported instead.
    publish({
      at: Date.now(), surface: current.surface, applied: current.cleanups.size, failures: [],
      loadError: describeDbError(error),
    });
    return;
  }
  // A refresh that started later has already taken over; this result is stale.
  if (runtime !== current || generation !== current.generation) return;

  removeAll(current);
  const failures: SnippetRunReport['failures'] = [];
  for (const snippet of snippets) {
    try {
      current.cleanups.set(snippet.id, appliers[snippet.snippet_type](snippet));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: snippet.id, title: snippet.title, message });
      console.error(`[rwp-code-snippets] The snippet "${snippet.title}" could not be applied.`, error);
    }
  }
  publish({ at: Date.now(), surface: current.surface, applied: current.cleanups.size, failures, loadError: '' });
  doAction('rwp_snippets_applied', current.cleanups.size, current.surface);
}

/** /admin is the admin surface; every other path is the public site. Mirrors src/main.jsx. */
export const currentSurface = (): SnippetSurface =>
  (window.location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'public');

/**
 * Loads the active snippets and applies them. Returns a function that removes every one of them
 * again — the plugin returns it from its register() so deactivating removes the snippets too.
 */
export function startSnippetRuntime(surface: SnippetSurface = currentSurface()): Cleanup {
  if (runtime) {
    runtime.references += 1;
  } else {
    runtime = { surface, cleanups: new Map(), references: 1, generation: 0 };
    void load(runtime);
  }
  const started = runtime;
  let stopped = false;
  return () => {
    if (stopped || runtime !== started) return;
    stopped = true;
    started.references -= 1;
    if (started.references > 0) return;
    removeAll(started);
    runtime = null;
    publish({ at: Date.now(), surface: started.surface, applied: 0, failures: [], loadError: '' });
  };
}

/**
 * Re-reads the table and re-applies everything. Called after a snippet is saved, toggled or
 * deleted, so the admin sees the change without reloading. Resolves once the new set is applied.
 */
export async function refreshSnippets(): Promise<SnippetRunReport> {
  if (!runtime) return report;
  runtime.generation += 1;
  await load(runtime);
  return report;
}

/**
 * The runtime as a component, for mounting at the app root instead of starting it from the plugin:
 *
 *     <SnippetInjector />
 *
 * It renders nothing. The plugin uses startSnippetRuntime() directly, so that deactivating the
 * plugin under Plugins also removes its snippets.
 */
export default function SnippetInjector({ surface }: { surface?: SnippetSurface } = {}) {
  useEffect(() => startSnippetRuntime(surface), [surface]);
  return null;
}
