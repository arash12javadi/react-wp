import { registerWidget } from '../../lib/registry';
import { button, divider, heading, icon, iconBox, image, spacer, text, video } from './basic';
import { featuredImage, postContent, postExcerpt, postMeta, postTitle, posts } from './posts';
import { form } from './form';
import { accordion, cta, html, navMenu, slideshow } from './pro';

/** Order here is the order in the widget panel. */
export const coreWidgets = [
  heading, text, image, button, divider, spacer, icon, iconBox, video,
  posts, form, slideshow, cta, accordion, navMenu, html,
  postTitle, postExcerpt, postContent, featuredImage, postMeta,
];

coreWidgets.forEach((definition) => registerWidget(definition));
