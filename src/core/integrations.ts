/**
 * The Integrations hub's card registry.
 *
 * Core renders four cards (GitHub, AI, Media & storage, Email). A plugin that talks to a service of
 * its own — a payment processor, a CRM, an SMS gateway — adds a fifth by registering one, which is
 * what makes Settings → Integrations the single place an administrator looks rather than one hub plus
 * a settings screen per plugin.
 *
 * Two things are deliberate about the shape. A card owns its own screen area (`renderComponent`) and
 * the *plugin* loads and saves its own row, because only the plugin knows what the values mean; what
 * core guarantees is the placement, the heading, the capability check and the "Not configured" state
 * that keeps an empty card honest. And `order` exists so a plugin can sit next to the built-in card
 * it belongs with (media providers near Media, say) instead of being appended in load order.
 *
 * The registry is a plain module with a version counter, read through `useSyncExternalStore` by
 * `useIntegrationsRegistry()` — the same pattern as the hook registry in `./hooks`, so a plugin
 * activated after the first paint puts its card on screen without a reload.
 */
import { useMemo, useSyncExternalStore, type ComponentType } from 'react';

export interface IntegrationCardProps {
  /** Which provider or service the card is set to, as the card's own `describe` reports it. */
  status: { configured: boolean; label: string };
  /** Reads the card's own `system_settings` row again, after a save or a test. */
  refresh: () => void;
}

export interface RwpIntegrationCard {
  /** Unique, and stable: the hub uses it as the React key and as the card's DOM id. */
  id: string;
  title: string;
  /** An emoji, rendered as text — no icon font and no image to load. */
  icon?: string;
  description: string;
  /** Hides the card from, and blocks it for, roles without this capability. Defaults to `manage_options`. */
  capability?: string;
  /**
   * Where the card sits among the built-ins. Lower comes first; built-ins use 10, 20, 30, 40, so a
   * plugin that belongs beside Media passes 35.
   */
  order?: number;
  /**
   * Whether the plugin considers itself configured, for the card's state pill. Optional: a card that
   * omits it simply has no pill, which beats one that is wrong.
   */
  describe?: () => Promise<{ configured: boolean; label: string }>;
  /** Renders the card's own form. Everything inside it is the plugin's business. */
  renderComponent: ComponentType<IntegrationCardProps>;
}

const cards = new Map<string, RwpIntegrationCard>();
const subscribers = new Set<() => void>();

let version = 0;
const notify = () => {
  version += 1;
  subscribers.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('An integrations card subscriber threw while the registry was changing.', error);
    }
  });
};

export const getIntegrationCardsVersion = () => version;

export const subscribeIntegrationCards = (listener: () => void): (() => void) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};

/** Every registered card, in the order the hub renders them. */
export const getIntegrationCards = (): RwpIntegrationCard[] =>
  [...cards.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/**
 * Adds a card to Settings → Integrations. Returns the usual remove function, so a plugin's cleanup
 * takes its card away with the rest of its contributions.
 */
export const registerIntegrationCard = (card: RwpIntegrationCard): (() => void) => {
  if (!card?.id) throw new Error('An integration card needs an id.');
  cards.set(card.id, card);
  notify();
  return () => {
    cards.delete(card.id);
    notify();
  };
};

export const clearIntegrationCards = (): void => {
  cards.clear();
  notify();
};

/**
 * The hook, which is what the hub itself renders from and what a plugin author is handed: the cards
 * that exist right now, plus the registrar, so a plugin can add one from inside a component it
 * already has on screen.
 */
export const useIntegrationsRegistry = (): {
  cards: RwpIntegrationCard[];
  registerIntegrationCard: typeof registerIntegrationCard;
} => {
  // The version is what the component re-renders on: a plugin that registers a card after the hub has
  // painted puts it on screen without a reload.
  const version = useSyncExternalStore(
    subscribeIntegrationCards,
    getIntegrationCardsVersion,
    getIntegrationCardsVersion,
  );
  return useMemo(
    () => ({ cards: getIntegrationCards(), registerIntegrationCard }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
};
