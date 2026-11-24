/**
 * The service's public offer, `GET ${VITE_SERVICE_API}/public/offer`, as
 * docs/service-offer-contract.md defines it: fetched, checked and formatted
 * for /mcp-server-development (src/components/ServicePageView.tsx). Only that
 * page's chunk imports this file.
 */

export const offerUrl = (serviceApi: string): string => `${serviceApi}/public/offer`;

/** How a confirmed quote is paid: by invoice (the default) or online through Polar. */
export type PaymentMethod = 'invoice' | 'polar';

export interface ServiceOfferItem {
  id: string;
  name: string;
  /** Minor units of the offer's currency. */
  fromPrice: number;
  deliveryDays: number | null;
}

export interface ServiceOffer {
  ordersOpen: boolean;
  currency: string;
  offers: ServiceOfferItem[];
  /** Minor units per month, or null when maintenance is not offered. */
  maintenanceMonthlyPrice: number | null;
  /** `invoice` when the field is missing or has another value. */
  paymentMethod: PaymentMethod;
  updatedAt: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isAmount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * The offer from the endpoint's JSON, or null when it does not match the
 * contract. Unknown fields are ignored; a malformed entry in `offers` is
 * dropped rather than failing the whole offer.
 */
export const parseServiceOffer = (json: unknown): ServiceOffer | null => {
  if (!isRecord(json) || typeof json.ordersOpen !== 'boolean' || !Array.isArray(json.offers)) return null;
  const currency = typeof json.currency === 'string' ? json.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency });
  } catch {
    return null;
  }
  const offers = json.offers.flatMap((entry): ServiceOfferItem[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string' || !isAmount(entry.fromPrice)) return [];
    const id = entry.id.trim();
    const name = entry.name.trim();
    if (!id || !name) return [];
    const deliveryDays = Number.isSafeInteger(entry.deliveryDays) && (entry.deliveryDays as number) > 0 ? entry.deliveryDays as number : null;
    return [{ id, name, fromPrice: entry.fromPrice, deliveryDays }];
  });
  let maintenanceMonthlyPrice: number | null = null;
  if (isRecord(json.maintenance) && isAmount(json.maintenance.monthlyPrice)) maintenanceMonthlyPrice = json.maintenance.monthlyPrice;
  else if (json.maintenance !== null && json.maintenance !== undefined) return null;
  return {
    ordersOpen: json.ordersOpen,
    currency,
    offers,
    maintenanceMonthlyPrice,
    paymentMethod: json.paymentMethod === 'polar' ? 'polar' : 'invoice',
    updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
  };
};

/** `amount` minor units of `currency` for display: `$499`, `$499.50`, `¥5,000`. */
export const formatPrice = (amount: number, currency: string): string => {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const major = amount / 10 ** digits;
  const whole = amount % 10 ** digits === 0;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(major);
};

const OFFER_TIMEOUT_MS = 8000;

/**
 * Fetches and parses the public offer. Null on any failure (no service API,
 * network error, timeout, non-2xx, invalid JSON or shape): the page then shows
 * its neutral copy. No cookies are sent.
 */
export const fetchServiceOffer = async (
  serviceApi: string | null,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ServiceOffer | null> => {
  if (!serviceApi) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? OFFER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(offerUrl(serviceApi), {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseServiceOffer(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
};
