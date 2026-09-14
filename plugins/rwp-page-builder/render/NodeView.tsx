import { memo, type CSSProperties, type ReactNode } from 'react';
import { getWidget } from '../lib/registry';
import { cssIdent } from '../lib/sanitize';
import type { BuilderNode, ColumnNode, SectionNode, WidgetNode } from '../lib/types';
import { resolveText } from '../lib/dynamic';
import { useRenderContext, type EditableTextProps } from './context';

const sectionTags = new Set(['section', 'div', 'header', 'footer', 'main', 'article', 'aside', 'nav']);

function hasOverlay(node: BuilderNode) {
  return Object.values(node.style || {}).some((bag) => {
    const background = (bag as Record<string, unknown> | undefined)?.background as { overlayColor?: string } | undefined;
    return Boolean(background?.overlayColor);
  });
}

function useNodeAttributes(node: BuilderNode, baseClass: string) {
  const { mode, editor } = useRenderContext();
  const { advanced = {} } = node;
  const classes = [
    'rwpb-el', baseClass, `rwpb-n-${node.id}`, cssIdent(advanced.cssClasses),
    node.hidden ? 'rwpb-is-hidden' : '',
  ];
  const style: CSSProperties & Record<string, string> = {};
  // Entrance animations only play on the public site; in the editor they would hide content.
  if (mode === 'view' && advanced.animation) {
    classes.push('rwpb-anim', `rwpb-anim-${cssIdent(advanced.animation)}`);
    style['--rwpb-anim-duration'] = `${Number(advanced.animationDuration) || 600}ms`;
    style['--rwpb-anim-delay'] = `${Number(advanced.animationDelay) || 0}ms`;
  }
  return {
    className: classes.filter(Boolean).join(' '),
    id: cssIdent(advanced.cssId).replace(/\s+/g, '-') || undefined,
    style: Object.keys(style).length ? style : undefined,
    ...(editor ? editor.nodeProps(node) : {}),
  };
}

function Chrome({ node }: { node: BuilderNode }) {
  const { editor } = useRenderContext();
  return editor ? <editor.Chrome node={node} /> : null;
}

function WidgetView({ node }: { node: WidgetNode }) {
  const { mode } = useRenderContext();
  const attributes = useNodeAttributes(node, `rwpb-widget rwpb-widget-${cssIdent(node.type)}`);
  const definition = getWidget(node.type);
  if (!definition) {
    return mode === 'edit' ? (
      <div {...attributes}>
        <div className="rwpb-missing">This “{node.type}” widget is not available. The plugin that provides it may be inactive.</div>
        <Chrome node={node} />
      </div>
    ) : null;
  }
  const { View } = definition;
  return (
    <div {...attributes}>
      <View node={node} />
      <Chrome node={node} />
    </div>
  );
}

function ColumnView({ node }: { node: ColumnNode }) {
  const { mode, editor } = useRenderContext();
  const attributes = useNodeAttributes(node, 'rwpb-column');
  const visible = mode === 'edit' ? node.children : node.children.filter((child) => !child.hidden);
  return (
    <div {...attributes}>
      {hasOverlay(node) && <div className="rwpb-overlay" aria-hidden="true" />}
      <div className="rwpb-column-inner" data-rwpb-container={node.id} data-rwpb-accepts="widget">
        {visible.map((child) => <NodeView key={child.id} node={child} />)}
        {editor && node.children.length === 0 && <editor.EmptyColumn columnId={node.id} />}
      </div>
      <Chrome node={node} />
    </div>
  );
}

function SectionView({ node }: { node: SectionNode }) {
  const { mode } = useRenderContext();
  const attributes = useNodeAttributes(node, `rwpb-section rwpb-section-${node.settings.layout === 'full' ? 'full' : 'boxed'}`);
  const requested = String(node.settings.htmlTag || 'section');
  const Tag = (sectionTags.has(requested) ? requested : 'section') as 'section';
  const columns = mode === 'edit' ? node.children : node.children.filter((child) => !child.hidden);
  return (
    <Tag {...attributes}>
      {hasOverlay(node) && <div className="rwpb-overlay" aria-hidden="true" />}
      <div className="rwpb-container" data-rwpb-container={node.id} data-rwpb-accepts="column">
        {columns.map((column) => <NodeView key={column.id} node={column} />)}
      </div>
      <Chrome node={node} />
    </Tag>
  );
}

/** Memoised on the node object: tree updates keep unchanged subtrees, so only edited nodes re-render. */
export const NodeView = memo(function NodeView({ node }: { node: BuilderNode }) {
  const { mode } = useRenderContext();
  if (node.hidden && mode === 'view') return null;
  if (node.kind === 'section') return <SectionView node={node} />;
  if (node.kind === 'column') return <ColumnView node={node} />;
  return <WidgetView node={node} />;
});

/** Plain text a visitor sees, or an inline editor on the canvas. Resolves dynamic tags when viewing. */
export function EditableText({ nodeId, field, value, as = 'span', className, multiline }: EditableTextProps) {
  const { editor, dynamic } = useRenderContext();
  if (editor) return <editor.EditableText nodeId={nodeId} field={field} value={value} as={as} className={className} multiline={multiline} />;
  const Tag = as as 'span';
  const text = resolveText(value, dynamic);
  return <Tag className={className}>{multiline ? withBreaks(text) : text}</Tag>;
}

const withBreaks = (text: string): ReactNode => text.split('\n').flatMap((line, index) => (index ? [<br key={index} />, line] : [line]));
