import type { TranslationDictionary } from '../i18n';

/** Arabic (RTL). Any key left out falls back to the English string in en.ts. */
const ar: TranslationDictionary = {
  'header.skipToContent': 'تخطَّ إلى المحتوى',
  'header.toggleNavigation': 'إظهار القائمة أو إخفاؤها',
  'header.primaryNavigation': 'التنقل الرئيسي',
  'header.login': 'تسجيل الدخول',
  'header.logout': 'تسجيل الخروج',
  'header.register': 'إنشاء حساب',
  'header.dashboard': 'لوحة التحكم',
  'header.search': 'بحث',
  'header.searchPosts': 'ابحث في المقالات…',

  'language.label': 'اللغة',
  'language.change': 'تغيير اللغة',
  'language.current': 'اللغة الحالية: {language}',
  'language.chooseLanguage': 'اختر لغة',

  'content.readMore': 'اقرأ المزيد',
  'content.published': 'نُشر في {date}',
  'content.by': 'بقلم {author}',
  'content.noPosts': 'لا توجد مقالات بعد.',
  'content.notFound': 'الصفحة غير موجودة',
  'content.notFoundBody': 'الصفحة التي طلبتها غير موجودة أو غير منشورة.',
  'content.backHome': 'العودة إلى الصفحة الرئيسية',
  'content.loading': 'جارٍ التحميل…',

  'archive.searchResults': 'نتائج البحث عن «{term}»',
  'archive.category': 'التصنيف: {name}',
  'archive.author': 'مقالات {name}',
  'archive.nothingFound': 'لم يُعثر على شيء.',
  'archive.previous': 'السابق',
  'archive.next': 'التالي',

  'comments.title': 'التعليقات',
  'comments.count': '{count} تعليقات',
  'comments.none': 'لا توجد تعليقات بعد.',
  'comments.leaveReply': 'اترك تعليقًا',
  'comments.reply': 'رد',
  'comments.cancelReply': 'إلغاء الرد',
  'comments.yourComment': 'تعليقك',
  'comments.submit': 'نشر التعليق',
  'comments.submitting': 'جارٍ النشر…',
  'comments.moderation': 'تعليقك في انتظار الموافقة.',
  'comments.closed': 'التعليقات مغلقة.',
  'comments.signInToComment': 'سجّل الدخول لكتابة تعليق.',

  'common.save': 'حفظ',
  'common.saving': 'جارٍ الحفظ…',
  'common.cancel': 'إلغاء',
  'common.delete': 'حذف',
  'common.edit': 'تعديل',
  'common.close': 'إغلاق',
  'common.email': 'البريد الإلكتروني',
  'common.password': 'كلمة المرور',
  'common.name': 'الاسم',
  'common.required': 'مطلوب',
  'common.error': 'حدث خطأ ما.',

  'admin.dashboard': 'لوحة التحكم',
  'admin.viewSite': 'عرض الموقع',
  'admin.settings': 'الإعدادات',
  'admin.languages': 'اللغات',
  'admin.profile': 'الملف الشخصي',
};

export default ar;
