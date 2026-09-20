import {
  Component, useCallback, useEffect, useMemo, useSyncExternalStore,
  type ErrorInfo, type ReactNode,
} from 'react';
import {
  addAction, addFilter, applyFilters, doAction, getHookVersion, subscribeHooks,
  DEFAULT_PRIORITY, type ActionCallback, type FilterCallback,
} from './hooks';

/**
 * React bindings for the hook registry.
 *
 * Everything here re-renders when the registry changes, so a plugin activated after the first
 * paint still gets its contributions on screen without a reload.
 */

const useHookVersion = (): number => useSyncExternalStore(subscribeHooks, getHookVersion, getHookVersion);

/** The value after every filter registered for `name` has run. Re-runs when plugins change. */
export function useApplyFilters<T>(name: string, value: T, ...args: unknown[]): T {
  const version = useHookVersion();
  // args is a fresh array each render, so it is spread into the dependency list instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => applyFilters(name, value, ...args), [name, value, version, ...args]);
}

/** Fires an action once per change of `deps`. Use for "this screen opened" style events. */
export function useDoAction(name: string, deps: unknown[], ...args: unknown[]): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { doAction(name, ...args); }, [name, ...deps]);
}

/** Registers a filter for as long as the component is mounted. */
export function useFilter<T>(name: string, callback: FilterCallback<T>, priority = DEFAULT_PRIORITY): void {
  useEffect(() => addFilter(name, callback, priority), [name, callback, priority]);
}

/** Registers an action for as long as the component is mounted. */
export function useAction(name: string, callback: ActionCallback, priority = DEFAULT_PRIORITY): void {
  useEffect(() => addAction(name, callback, priority), [name, callback, priority]);
}

/**
 * The dispatcher, for code that fires hooks in event handlers rather than during render.
 * The returned object is stable, so it is safe in a dependency list.
 */
export function useHooks() {
  const applyFiltersStable = useCallback(<T,>(name: string, value: T, ...args: unknown[]) => applyFilters(name, value, ...args), []);
  const doActionStable = useCallback((name: string, ...args: unknown[]) => doAction(name, ...args), []);
  return useMemo(() => ({
    addFilter,
    applyFilters: applyFiltersStable,
    addAction,
    doAction: doActionStable,
  }), [applyFiltersStable, doActionStable]);
}

// Slots ----------------------------------------------------------------------------------------

/** One plugin's contribution to a layout zone. `id` is the React key and must be unique per slot. */
export interface SlotContribution {
  id: string;
  node: ReactNode;
}

/**
 * Adds markup to a layout zone (`before_header`, `sidebar_widgets`, …). Under the hood a slot is
 * a filter over SlotContribution[], so a plugin can equally well reorder or remove what others
 * added by registering a filter on the same name.
 *
 * Returns the usual remove function.
 */
export function addSlotContent(
  name: string,
  id: string,
  render: (args: Record<string, unknown>) => ReactNode,
  priority = DEFAULT_PRIORITY,
): () => void {
  return addFilter<SlotContribution[]>(name, (contributions, args) => {
    const node = render((args as Record<string, unknown>) || {});
    // Rendering nothing is a normal outcome (a cart badge with an empty cart, say).
    if (node === null || node === undefined || node === false) return contributions;
    return [...contributions, { id, node }];
  }, priority);
}

interface BoundaryProps { label: string; children: ReactNode }

/**
 * A contribution that throws must not take the page with it. Matches how BlockFrame protects
 * theme blocks: the rest of the layout keeps rendering, and the error is named in the console.
 */
class SlotErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed and was removed from the page.`, error, info);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface HookSlotProps {
  /** The hook name, e.g. "before_header". */
  name: string;
  /** Passed to every contributor as the second filter argument. */
  args?: Record<string, unknown>;
  /** Rendered when no plugin contributes anything. */
  fallback?: ReactNode;
  /** Wraps the contributions when there is at least one. */
  wrapper?: (children: ReactNode) => ReactNode;
}

/**
 * Renders everything plugins have added to a layout zone.
 *
 *   <HookSlot name="before_header" />
 *   <HookSlot name="sidebar_widgets" args={{ pageId }} wrapper={(kids) => <aside>{kids}</aside>} />
 */
export function HookSlot({ name, args, fallback = null, wrapper }: HookSlotProps) {
  // A new object literal every render would re-run every filter every render.
  const stableArgs = useMemo(() => args || {}, [args]);
  const empty = useMemo<SlotContribution[]>(() => [], []);
  const contributions = useApplyFilters<SlotContribution[]>(name, empty, stableArgs);

  if (!contributions.length) return <>{fallback}</>;
  const children = contributions.map(({ id, node }) => (
    <SlotErrorBoundary key={id} label={`The "${id}" item in the ${name} slot`}>{node}</SlotErrorBoundary>
  ));
  return <>{wrapper ? wrapper(children) : children}</>;
}

export default HookSlot;
