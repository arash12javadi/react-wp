import type { ShopSettings } from './settings';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

export const currencies: Currency[] = [
  { code: 'USD', name: 'US dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'Pound sterling', symbol: '£', decimals: 2 },
  { code: 'CAD', name: 'Canadian dollar', symbol: 'CA$', decimals: 2 },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$', decimals: 2 },
  { code: 'NZD', name: 'New Zealand dollar', symbol: 'NZ$', decimals: 2 },
  { code: 'CHF', name: 'Swiss franc', symbol: 'CHF', decimals: 2 },
  { code: 'SEK', name: 'Swedish krona', symbol: 'kr', decimals: 2 },
  { code: 'NOK', name: 'Norwegian krone', symbol: 'kr', decimals: 2 },
  { code: 'DKK', name: 'Danish krone', symbol: 'kr.', decimals: 2 },
  { code: 'PLN', name: 'Polish złoty', symbol: 'zł', decimals: 2 },
  { code: 'CZK', name: 'Czech koruna', symbol: 'Kč', decimals: 2 },
  { code: 'HUF', name: 'Hungarian forint', symbol: 'Ft', decimals: 2 },
  { code: 'RON', name: 'Romanian leu', symbol: 'lei', decimals: 2 },
  { code: 'BGN', name: 'Bulgarian lev', symbol: 'лв.', decimals: 2 },
  { code: 'TRY', name: 'Turkish lira', symbol: '₺', decimals: 2 },
  { code: 'RUB', name: 'Russian ruble', symbol: '₽', decimals: 2 },
  { code: 'UAH', name: 'Ukrainian hryvnia', symbol: '₴', decimals: 2 },
  { code: 'IRR', name: 'Iranian rial', symbol: '﷼', decimals: 0 },
  { code: 'IRT', name: 'Iranian toman', symbol: 'تومان', decimals: 0 },
  { code: 'AED', name: 'UAE dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'SAR', name: 'Saudi riyal', symbol: '﷼', decimals: 2 },
  { code: 'QAR', name: 'Qatari riyal', symbol: 'ر.ق', decimals: 2 },
  { code: 'KWD', name: 'Kuwaiti dinar', symbol: 'د.ك', decimals: 3 },
  { code: 'BHD', name: 'Bahraini dinar', symbol: '.د.ب', decimals: 3 },
  { code: 'OMR', name: 'Omani rial', symbol: 'ر.ع.', decimals: 3 },
  { code: 'ILS', name: 'Israeli new shekel', symbol: '₪', decimals: 2 },
  { code: 'EGP', name: 'Egyptian pound', symbol: 'E£', decimals: 2 },
  { code: 'ZAR', name: 'South African rand', symbol: 'R', decimals: 2 },
  { code: 'NGN', name: 'Nigerian naira', symbol: '₦', decimals: 2 },
  { code: 'KES', name: 'Kenyan shilling', symbol: 'KSh', decimals: 2 },
  { code: 'MAD', name: 'Moroccan dirham', symbol: 'MAD', decimals: 2 },
  { code: 'INR', name: 'Indian rupee', symbol: '₹', decimals: 2 },
  { code: 'PKR', name: 'Pakistani rupee', symbol: '₨', decimals: 2 },
  { code: 'BDT', name: 'Bangladeshi taka', symbol: '৳', decimals: 2 },
  { code: 'LKR', name: 'Sri Lankan rupee', symbol: 'Rs', decimals: 2 },
  { code: 'CNY', name: 'Chinese yuan', symbol: '¥', decimals: 2 },
  { code: 'HKD', name: 'Hong Kong dollar', symbol: 'HK$', decimals: 2 },
  { code: 'TWD', name: 'New Taiwan dollar', symbol: 'NT$', decimals: 2 },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥', decimals: 0 },
  { code: 'KRW', name: 'South Korean won', symbol: '₩', decimals: 0 },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$', decimals: 2 },
  { code: 'MYR', name: 'Malaysian ringgit', symbol: 'RM', decimals: 2 },
  { code: 'THB', name: 'Thai baht', symbol: '฿', decimals: 2 },
  { code: 'IDR', name: 'Indonesian rupiah', symbol: 'Rp', decimals: 2 },
  { code: 'PHP', name: 'Philippine peso', symbol: '₱', decimals: 2 },
  { code: 'VND', name: 'Vietnamese đồng', symbol: '₫', decimals: 0 },
  { code: 'MXN', name: 'Mexican peso', symbol: 'MX$', decimals: 2 },
  { code: 'BRL', name: 'Brazilian real', symbol: 'R$', decimals: 2 },
  { code: 'ARS', name: 'Argentine peso', symbol: 'AR$', decimals: 2 },
  { code: 'CLP', name: 'Chilean peso', symbol: 'CLP$', decimals: 0 },
  { code: 'COP', name: 'Colombian peso', symbol: 'COL$', decimals: 2 },
  { code: 'PEN', name: 'Peruvian sol', symbol: 'S/', decimals: 2 },
];

export const findCurrency = (code: string): Currency =>
  currencies.find((currency) => currency.code === code) || { code, name: code, symbol: code, decimals: 2 };

/** Formats an amount using the shop's currency, position and separators. */
export const formatPrice = (amount: number | string | null | undefined, settings: ShopSettings, currencyCode?: string): string => {
  const value = Number(amount ?? 0);
  const currency = findCurrency(currencyCode || settings.currency);
  const decimals = Number.isFinite(settings.decimals) ? settings.decimals : currency.decimals;
  const negative = value < 0;
  const [whole, fraction] = Math.abs(value).toFixed(Math.max(decimals, 0)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, settings.thousand_separator);
  const number = fraction ? `${grouped}${settings.decimal_separator}${fraction}` : grouped;
  const symbol = currency.symbol;
  const formatted = {
    left: `${symbol}${number}`,
    right: `${number}${symbol}`,
    left_space: `${symbol} ${number}`,
    right_space: `${number} ${symbol}`,
  }[settings.currency_position] || `${symbol}${number}`;
  return negative ? `-${formatted}` : formatted;
};
