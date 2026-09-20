import type { TranslationDictionary } from '../i18n';

/** Persian (RTL). Any key left out falls back to the English string in en.ts. */
const fa: TranslationDictionary = {
  'header.skipToContent': 'پرش به محتوا',
  'header.toggleNavigation': 'باز و بسته کردن منو',
  'header.primaryNavigation': 'ناوبری اصلی',
  'header.login': 'ورود',
  'header.logout': 'خروج',
  'header.register': 'ثبت‌نام',
  'header.dashboard': 'پیشخوان',
  'header.search': 'جستجو',
  'header.searchPosts': 'جستجوی نوشته‌ها…',

  'language.label': 'زبان',
  'language.change': 'تغییر زبان',
  'language.current': 'زبان فعلی: {language}',
  'language.chooseLanguage': 'یک زبان انتخاب کنید',

  'content.readMore': 'ادامهٔ مطلب',
  'content.published': 'منتشر شده در {date}',
  'content.by': 'نوشتهٔ {author}',
  'content.noPosts': 'هنوز نوشته‌ای وجود ندارد.',
  'content.notFound': 'صفحه پیدا نشد',
  'content.notFoundBody': 'صفحه‌ای که خواستید وجود ندارد یا منتشر نشده است.',
  'content.backHome': 'بازگشت به صفحهٔ اصلی',
  'content.loading': 'در حال بارگذاری…',

  'archive.searchResults': 'نتایج جستجو برای «{term}»',
  'archive.category': 'دسته: {name}',
  'archive.author': 'نوشته‌های {name}',
  'archive.nothingFound': 'چیزی پیدا نشد.',
  'archive.previous': 'قبلی',
  'archive.next': 'بعدی',

  'comments.title': 'دیدگاه‌ها',
  'comments.count': '{count} دیدگاه',
  'comments.none': 'هنوز دیدگاهی ثبت نشده است.',
  'comments.leaveReply': 'دیدگاه خود را بنویسید',
  'comments.reply': 'پاسخ',
  'comments.cancelReply': 'انصراف از پاسخ',
  'comments.yourComment': 'دیدگاه شما',
  'comments.submit': 'ثبت دیدگاه',
  'comments.submitting': 'در حال ثبت…',
  'comments.moderation': 'دیدگاه شما در انتظار تأیید است.',
  'comments.closed': 'دیدگاه‌ها بسته است.',
  'comments.signInToComment': 'برای ثبت دیدگاه وارد شوید.',

  'common.save': 'ذخیره',
  'common.saving': 'در حال ذخیره…',
  'common.cancel': 'انصراف',
  'common.delete': 'حذف',
  'common.edit': 'ویرایش',
  'common.close': 'بستن',
  'common.email': 'ایمیل',
  'common.password': 'گذرواژه',
  'common.name': 'نام',
  'common.required': 'الزامی',
  'common.error': 'مشکلی پیش آمد.',

  'admin.dashboard': 'پیشخوان',
  'admin.viewSite': 'مشاهدهٔ سایت',
  'admin.settings': 'تنظیمات',
  'admin.languages': 'زبان‌ها',
  'admin.profile': 'نمایه',
};

export default fa;
