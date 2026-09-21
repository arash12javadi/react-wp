/**
 * The reference dictionary. Keys are flat and namespaced by area; every other locale is a subset
 * of this one, and anything missing there falls back to the English string.
 */
const en = {
  // Header, navigation and the language switcher
  'header.skipToContent': 'Skip to content',
  'header.toggleNavigation': 'Toggle navigation',
  'header.primaryNavigation': 'Primary navigation',
  'header.login': 'Log in',
  'header.logout': 'Log out',
  'header.register': 'Register',
  'header.dashboard': 'Dashboard',
  'header.search': 'Search',
  'header.searchPosts': 'Search posts…',

  'language.label': 'Language',
  'language.change': 'Change language',
  'language.current': 'Current language: {language}',
  'language.chooseLanguage': 'Choose a language',
  // A language's name in the interface language (the switcher's hover hint). One per bundled locale.
  'language.name.en': 'English',
  'language.name.fa': 'Persian',
  'language.name.ar': 'Arabic',

  // Public content
  'content.readMore': 'Read more',
  'content.published': 'Published {date}',
  'content.by': 'By {author}',
  'content.noPosts': 'No posts yet.',
  'content.notFound': 'Page not found',
  'content.notFoundBody': 'The page you asked for does not exist, or it is not published.',
  'content.backHome': 'Back to the home page',
  'content.loading': 'Loading…',

  // Archives and search
  'archive.searchResults': 'Search results for “{term}”',
  'archive.category': 'Category: {name}',
  'archive.author': 'Posts by {name}',
  'archive.nothingFound': 'Nothing was found.',
  'archive.previous': 'Previous',
  'archive.next': 'Next',
  'archive.thisAuthor': 'this author',

  // Sidebar widgets
  'widgets.noCategories': 'No categories yet.',

  // Comments
  'comments.title': 'Comments',
  'comments.count': '{count} comments',
  'comments.none': 'No comments yet.',
  'comments.leaveReply': 'Leave a reply',
  'comments.reply': 'Reply',
  'comments.cancelReply': 'Cancel reply',
  'comments.yourComment': 'Your comment',
  'comments.submit': 'Post comment',
  'comments.submitting': 'Posting…',
  'comments.moderation': 'Your comment is waiting to be approved.',
  'comments.closed': 'Comments are closed.',
  'comments.signInToComment': 'Sign in to leave a comment.',

  // Forms and shared UI
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.close': 'Close',
  'common.email': 'Email',
  'common.password': 'Password',
  'common.name': 'Name',
  'common.required': 'Required',
  'common.error': 'Something went wrong.',

  // Admin shell
  'admin.dashboard': 'Dashboard',
  'admin.viewSite': 'View site',
  'admin.settings': 'Settings',
  'admin.languages': 'Languages',
  'admin.profile': 'Profile',
} satisfies Record<string, string>;

export default en;
