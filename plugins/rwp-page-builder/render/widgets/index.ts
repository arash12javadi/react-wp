import { registerWidget } from '../../lib/registry';
import { button, divider, heading, icon, iconBox, image, spacer, text, video } from './basic';
import { featuredImage, postContent, postExcerpt, postMeta, postTitle, posts } from './posts';
import { form } from './form';
import { accordion, cta, html, navMenu, slideshow } from './pro';
import {
  alert, basicGallery, counter, googleMaps, iconList, imageBox, imageCarousel, menuAnchor, progressBar, readMore, shortcode,
  soundcloud, starRating, tabs, testimonial, textPath, toggle,
} from './general';
import {
  animatedHeadline, blockquote, codeHighlight, countdown, flipBox, hotspot, lottie, priceList, priceTable, progressTracker, tableOfContents,
} from './pro-content';
import {
  contentCarousel, gallery, loginForm, mediaCarousel, offCanvas, paypalButton, reviews, search, stripeButton, testimonialCarousel, videoPlaylist,
} from './pro-media';
import { facebookButton, facebookComments, facebookEmbed, facebookPage, shareButtons, socialIcons } from './social';
import { loopCarousel, loopGrid, megaMenu, portfolio, postsSlider, taxonomyFilter, template } from './loop';
import {
  archivePosts, archiveTitle, authorBox, breadcrumbs, pageTitle, postComments, postNavigation, sidebar, siteLogo, siteTitle, sitemap,
} from './site';
import { themeFooter, themeHeader } from './theme';
import { accountForm } from './account';
import { engagementBar, popularContent } from './engagement';
import {
  wpArchives, wpCalendar, wpCategories, wpMeta, wpPages, wpRecentComments, wpRecentPosts, wpSearch, wpTagCloud,
} from './wordpress';

/**
 * Order here is the order in the widget panel (within each category).
 * Shop widgets are registered by the shop plugin itself (plugins/rwp-shop/builder), so they
 * appear only while the shop is active.
 */
export const coreWidgets = [
  // Basic
  heading, text, image, button, divider, spacer, icon, iconBox, imageBox, video, googleMaps, starRating, imageCarousel, basicGallery,
  iconList, counter, progressBar, testimonial, tabs, accordion, toggle, socialIcons, alert, soundcloud, shortcode, html, menuAnchor,
  sidebar, readMore, textPath,
  // Pro
  posts, postsSlider, portfolio, gallery, form, loginForm, slideshow, navMenu, megaMenu, loopGrid, loopCarousel, contentCarousel,
  offCanvas, search, taxonomyFilter, animatedHeadline, priceList, priceTable, flipBox, cta, mediaCarousel, testimonialCarousel,
  reviews, tableOfContents, countdown, shareButtons, blockquote, template, lottie, codeHighlight, videoPlaylist, hotspot,
  paypalButton, stripeButton, progressTracker, facebookButton, facebookComments, facebookEmbed, facebookPage,
  // Post (dynamic content)
  postTitle, postExcerpt, postContent, featuredImage, postMeta, engagementBar,
  // Site
  themeHeader, themeFooter, siteLogo, siteTitle, pageTitle, accountForm, authorBox, postComments, postNavigation, archiveTitle, archivePosts, breadcrumbs, sitemap,
  popularContent,
  // WordPress-style site widgets
  wpPages, wpCalendar, wpArchives, wpCategories, wpRecentPosts, wpSearch, wpTagCloud, wpRecentComments, wpMeta,
];

coreWidgets.forEach((definition) => registerWidget(definition));
