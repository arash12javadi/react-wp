import { createContext, useContext } from 'react';
import type { EngagementTargetType } from '../../lib/engagement';

/**
 * The item a page is showing, for engagement shortcodes placed in its content: [rwp_like] without an
 * id likes the post it is written in. PublicContent provides it around the article; shortcodes are
 * portalled from inside ContentRenderer, so they see it.
 */
export interface EngagementTarget {
  targetType: EngagementTargetType;
  targetId: string | number;
  authorId?: string | null;
  categoryId?: string | null;
}

const EngagementTargetContext = createContext<EngagementTarget | null>(null);

export const EngagementTargetProvider = EngagementTargetContext.Provider;
export const useEngagementTarget = () => useContext(EngagementTargetContext);
