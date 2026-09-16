import { useMemo } from 'react';
import type { RwpTemplateRenderProps } from '../../../src/lib/plugin-api';
import { liveTemplate } from '../lib/siteTemplates';
import type { BuilderPage } from '../lib/types';
import BuilderRenderer, { parseDocument } from './BuilderRenderer';
import { TemplateProvider, type TemplateContextValue } from './context';

/**
 * Renders a published site template in place of part of the public site. Dynamic widgets show the
 * post being viewed (single post, page); archive widgets read the archive from TemplateProvider.
 */
export default function SiteTemplateView({ type, post, archive, layoutWidth }: RwpTemplateRenderProps) {
  const template = liveTemplate(type);
  const doc = useMemo(() => parseDocument(template?.builder_data), [template]);
  const context = useMemo<TemplateContextValue>(() => ({ type, archive, layoutWidth }), [type, archive, layoutWidth]);
  if (!template || !doc) return null;
  return (
    <div className={`rwpb-template rwpb-template-${type.replace(/_/g, '-')}`}>
      <TemplateProvider value={context}>
        <BuilderRenderer doc={doc} page={template} contextPage={post ? (post as unknown as BuilderPage) : null} />
      </TemplateProvider>
    </div>
  );
}
