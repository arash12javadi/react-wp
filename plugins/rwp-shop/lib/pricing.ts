interface Priced {
  regular_price: number | null;
  sale_price: number | null;
  sale_from: string | null;
  sale_to: string | null;
}

/**
 * Display-only mirror of public.shop_effective_price(). The database recomputes the price at
 * checkout; this only decides what to show before then.
 */
export const effectivePrice = (item: Priced): number | null => {
  const now = Date.now();
  const regular = item.regular_price === null ? null : Number(item.regular_price);
  const sale = item.sale_price === null ? null : Number(item.sale_price);
  const started = !item.sale_from || new Date(item.sale_from).getTime() <= now;
  const notEnded = !item.sale_to || new Date(item.sale_to).getTime() > now;
  if (sale !== null && started && notEnded && (regular === null || sale < regular)) return sale;
  return regular;
};

export const isOnSale = (item: Priced) => {
  const price = effectivePrice(item);
  return price !== null && item.regular_price !== null && price < Number(item.regular_price);
};
