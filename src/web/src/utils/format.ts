// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
import { MarketData } from '../types/market';
import { Portfolio } from '../types/portfolio';
import { formatTimestamp } from './date';

// Global constants for formatting configuration
const DEFAULT_LOCALE = 'en-US';
const SUPPORTED_LOCALES = ['en-US', 'en-GB', 'ja-JP', 'zh-CN'];
const PRICE_PRECISION = 8;
const VOLUME_PRECISION = 6;
const PERCENTAGE_PRECISION = 2;

// Currency-specific precision mapping
const CURRENCY_PRECISIONS: Record<string, number> = {
    'USD': 2,
    'BTC': 8,
    'SOL': 4,
    'USDC': 2
};

// CSS classes for color-coded values
const COLOR_CLASSES = {
    positive: 'text-green-500',
    negative: 'text-red-500',
    neutral: 'text-gray-500'
};

// Cache for NumberFormat instances
const numberFormatCache = new Map<string, Intl.NumberFormat>();

/**
 * Gets or creates a cached NumberFormat instance
 * @param locale - Formatting locale
 * @param options - NumberFormat options
 * @returns Cached NumberFormat instance
 */
function getNumberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const key = `${locale}-${JSON.stringify(options)}`;
    if (!numberFormatCache.has(key)) {
        numberFormatCache.set(key, new Intl.NumberFormat(locale, options));
    }
    return numberFormatCache.get(key)!;
}

/**
 * Formats a price value with appropriate precision and currency symbol
 * @param price - Price value as Decimal
 * @param currency - Currency code (e.g., 'USD', 'BTC')
 * @param locale - Optional locale for formatting
 * @returns Formatted price string
 */
export function formatPrice(price: Decimal, currency: string, locale: string = DEFAULT_LOCALE): string {
    try {
        if (!(price instanceof Decimal)) {
            throw new Error('Invalid price value');
        }

        const precision = CURRENCY_PRECISIONS[currency] || PRICE_PRECISION;
        const formatter = getNumberFormatter(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: precision,
            maximumFractionDigits: precision
        });

        return formatter.format(price.toNumber());
    } catch (error) {
        console.error('Error formatting price:', error);
        return '—';
    }
}

/**
 * Formats trading volume with appropriate scale and precision
 * @param volume - Volume value as Decimal
 * @param locale - Optional locale for formatting
 * @returns Formatted volume string with scale
 */
export function formatVolume(volume: Decimal, locale: string = DEFAULT_LOCALE): string {
    try {
        if (!(volume instanceof Decimal)) {
            throw new Error('Invalid volume value');
        }

        const formatter = getNumberFormatter(locale, {
            minimumFractionDigits: 0,
            maximumFractionDigits: VOLUME_PRECISION
        });

        let scale = '';
        let scaledVolume = volume;

        if (volume.gte(1_000_000_000)) {
            scaledVolume = volume.div(1_000_000_000);
            scale = 'B';
        } else if (volume.gte(1_000_000)) {
            scaledVolume = volume.div(1_000_000);
            scale = 'M';
        } else if (volume.gte(1_000)) {
            scaledVolume = volume.div(1_000);
            scale = 'K';
        }

        return `${formatter.format(scaledVolume.toNumber())}${scale}`;
    } catch (error) {
        console.error('Error formatting volume:', error);
        return '—';
    }
}

/**
 * Formats decimal values as percentages with sign
 * @param value - Percentage value as Decimal
 * @param locale - Optional locale for formatting
 * @returns Formatted percentage string
 */
export function formatPercentage(value: Decimal, locale: string = DEFAULT_LOCALE): string {
    try {
        if (!(value instanceof Decimal)) {
            throw new Error('Invalid percentage value');
        }

        const formatter = getNumberFormatter(locale, {
            style: 'percent',
            minimumFractionDigits: PERCENTAGE_PRECISION,
            maximumFractionDigits: PERCENTAGE_PRECISION,
            signDisplay: 'exceptZero'
        });

        return formatter.format(value.toNumber());
    } catch (error) {
        console.error('Error formatting percentage:', error);
        return '—';
    }
}

/**
 * Formats profit/loss values with color coding and sign
 * @param value - P/L value as Decimal
 * @param includeSign - Whether to include +/- sign
 * @param locale - Optional locale for formatting
 * @returns Object with formatted value and CSS class
 */
export function formatPnL(value: Decimal, includeSign: boolean = true, locale: string = DEFAULT_LOCALE): { value: string; className: string } {
    try {
        if (!(value instanceof Decimal)) {
            throw new Error('Invalid P/L value');
        }

        const formatter = getNumberFormatter(locale, {
            minimumFractionDigits: PERCENTAGE_PRECISION,
            maximumFractionDigits: PERCENTAGE_PRECISION,
            signDisplay: includeSign ? 'exceptZero' : 'never'
        });

        const formattedValue = formatter.format(value.toNumber());
        let className = COLOR_CLASSES.neutral;

        if (value.isPositive()) {
            className = COLOR_CLASSES.positive;
        } else if (value.isNegative()) {
            className = COLOR_CLASSES.negative;
        }

        return { value: formattedValue, className };
    } catch (error) {
        console.error('Error formatting P/L:', error);
        return { value: '—', className: COLOR_CLASSES.neutral };
    }
}

/**
 * Formats portfolio balance with currency-specific precision
 * @param balance - Balance value as Decimal
 * @param currency - Currency code
 * @param locale - Optional locale for formatting
 * @returns Formatted balance string
 */
export function formatBalance(balance: Decimal, currency: string, locale: string = DEFAULT_LOCALE): string {
    try {
        if (!(balance instanceof Decimal)) {
            throw new Error('Invalid balance value');
        }

        const precision = CURRENCY_PRECISIONS[currency] || PRICE_PRECISION;
        const formatter = getNumberFormatter(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: precision,
            maximumFractionDigits: precision
        });

        return formatter.format(balance.toNumber());
    } catch (error) {
        console.error('Error formatting balance:', error);
        return '—';
    }
}