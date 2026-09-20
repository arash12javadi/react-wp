/**
 * The site-wide hook registry: WordPress's actions and filters, with priorities.
 *
 * This is the one registry. `rwp.actions` / `rwp.filters` in src/lib/rwp.tsx are thin wrappers
 * around these functions, so a plugin written against either API sees the same callbacks. Adding
 * a second registry here would silently split them, and a filter added through one would never
 * run for the other.
 *
 * Actions are side effects and return nothing. Filters transform a value and MUST return it —
 * a filter that returns undefined is treated as a bug and its result is discarded, because the
 * alternative (writing undefined into the site title, a menu or a layout) is far harder to trace.
 */

/** WordPress's default, kept so "priority 10" means the same thing here. */
export const DEFAULT_PRIORITY = 10;

export type ActionCallback = (...args: any[]) => void;
export type FilterCallback<T = any> = (value: T, ...args: any[]) => T;

interface Registration {
  callback: (...args: any[]) => any;
  priority: number;
  /** Registration order, so equal priorities keep the order they were added in. */
  order: number;
}

type Registry = Map<string, Registration[]>;

const actionRegistry: Registry = new Map();
const filterRegistry: Registry = new Map();

let counter = 0;
let version = 0;
const listeners = new Set<() => void>();

const notify = () => {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('A hook subscriber threw while the registry was changing.', error);
    }
  });
};

/**
 * Bumps on every add and remove. React components read it through useSyncExternalStore so a
 * plugin that registers late (activation, HMR) re-renders whatever depends on its hooks.
 */
export const getHookVersion = () => version;

export const subscribeHooks = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function register(registry: Registry, name: string, callback: (...args: any[]) => any, priority: number): () => void {
  if (typeof callback !== 'function') {
    throw new Error(`The hook "${name}" was given a ${typeof callback} instead of a function.`);
  }
  const entry: Registration = { callback, priority, order: counter += 1 };
  const list = registry.get(name) || [];
  list.push(entry);
  // Lower priority first, then registration order — Array.prototype.sort is stable, but the
  // explicit tiebreak keeps the order right even for callbacks added at the same priority later.
  list.sort((a, b) => (a.priority - b.priority) || (a.order - b.order));
  registry.set(name, list);
  notify();

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const current = registry.get(name);
    if (!current) return;
    const index = current.indexOf(entry);
    if (index === -1) return;
    current.splice(index, 1);
    if (!current.length) registry.delete(name);
    notify();
  };
}

function unregister(registry: Registry, name: string, callback: (...args: any[]) => any): boolean {
  const current = registry.get(name);
  if (!current) return false;
  const index = current.findIndex((entry) => entry.callback === callback);
  if (index === -1) return false;
  current.splice(index, 1);
  if (!current.length) registry.delete(name);
  notify();
  return true;
}

// Filters ------------------------------------------------------------------------------------

/**
 * Registers a value transformer. Returns a function that removes it again — keep it and call it
 * from a plugin's cleanup, or the callback keeps running after the plugin is deactivated.
 */
export function addFilter<T>(name: string, callback: FilterCallback<T>, priority = DEFAULT_PRIORITY): () => void {
  return register(filterRegistry, name, callback, priority);
}

export function removeFilter<T>(name: string, callback: FilterCallback<T>): boolean {
  return unregister(filterRegistry, name, callback);
}

/**
 * Runs `value` through every filter registered for `name`, lowest priority first. A filter that
 * throws, or returns undefined, is skipped with a console error and the previous value is kept:
 * one broken plugin must not blank out a header or a page.
 */
export function applyFilters<T>(name: string, value: T, ...args: unknown[]): T {
  const list = filterRegistry.get(name);
  if (!list?.length) return value;
  let result = value;
  // A copy, because a filter is allowed to add or remove filters for the same hook.
  for (const entry of [...list]) {
    try {
      const next = entry.callback(result, ...args) as T;
      if (next === undefined) {
        console.error(`The filter "${name}" returned undefined. Filters must return the value; the previous one was kept.`);
      } else {
        result = next;
      }
    } catch (error) {
      console.error(`A filter on "${name}" threw. Its result was ignored.`, error);
    }
  }
  return result;
}

// Actions ------------------------------------------------------------------------------------

export function addAction(name: string, callback: ActionCallback, priority = DEFAULT_PRIORITY): () => void {
  return register(actionRegistry, name, callback, priority);
}

export function removeAction(name: string, callback: ActionCallback): boolean {
  return unregister(actionRegistry, name, callback);
}

/** Fires every callback registered for `name`. Errors are logged, never rethrown to the caller. */
export function doAction(name: string, ...args: unknown[]): void {
  const list = actionRegistry.get(name);
  if (!list?.length) return;
  for (const entry of [...list]) {
    try {
      entry.callback(...args);
    } catch (error) {
      console.error(`An action on "${name}" threw.`, error);
    }
  }
}

// Introspection ---------------------------------------------------------------------------------

export const hasFilter = (name: string): boolean => Boolean(filterRegistry.get(name)?.length);
export const hasAction = (name: string): boolean => Boolean(actionRegistry.get(name)?.length);

/** Every hook name with at least one callback, for the Guide screen and for debugging. */
export const listHooks = (): { actions: Array<{ name: string; count: number }>; filters: Array<{ name: string; count: number }> } => ({
  actions: [...actionRegistry.entries()].map(([name, list]) => ({ name, count: list.length })).sort((a, b) => a.name.localeCompare(b.name)),
  filters: [...filterRegistry.entries()].map(([name, list]) => ({ name, count: list.length })).sort((a, b) => a.name.localeCompare(b.name)),
});

/** Clears a hook, or the whole registry. Meant for tests and HMR, not for plugins. */
export function removeAllHooks(name?: string): void {
  if (name) {
    actionRegistry.delete(name);
    filterRegistry.delete(name);
  } else {
    actionRegistry.clear();
    filterRegistry.clear();
  }
  notify();
}

// Well-known hook names ---------------------------------------------------------------------------
// Plugins may use any string; these are the zones core itself fires, collected so they can be
// autocompleted and listed in the admin Guide.

/** Layout zones rendered with <HookSlot name="…" />. */
export const slotNames = [
  'before_header',
  'after_header',
  'before_content',
  'after_content',
  'before_footer',
  'after_footer',
  'sidebar_widgets',
  'comment_form_before',
  'comment_form_after',
  'admin_before_content',
  'admin_after_content',
  'admin_sidebar_after_nav',
  'builder_sidebar_tabs',
  'builder_topbar_actions',
] as const;

export type SlotName = (typeof slotNames)[number];

/** Filters core applies to content and translations. */
export const coreFilterNames = [
  /** The HTML of a page or post body, before it is sanitized and rendered. */
  'the_content',
  /** (translated, key, locale) — the final string for one translation key. */
  'i18n_translate_key',
  /** The active locale code, before it is applied to the document. */
  'i18n_locale',
  /** The locales offered in the language switcher. */
  'i18n_supported_locales',
  /** Widget types the page builder offers, as an array of definitions. */
  'builder_widgets',
  /** The admin sidebar, as AdminNavItem[]. */
  'rwp_admin_navigation',
] as const;
