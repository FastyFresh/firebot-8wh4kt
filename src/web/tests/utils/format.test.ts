import { describe, it, expect } from '@jest/globals';
import Decimal from 'decimal.js-light';
import { 
    formatPrice, 
    formatVolume, 
    formatPercentage, 
    formatPnL, 
    formatBalance 
} from '../../src/utils/format';

describe('formatPrice', () => {
    it('should format USDC prices with 2 decimal places', () => {
        const price = new Decimal('1234.5678');
        expect(formatPrice(price, 'USDC')).toBe('$1,234.57');
    });

    it('should format SOL prices with 4 decimal places', () => {
        const price = new Decimal('12.3456789');
        expect(formatPrice(price, 'SOL')).toBe('SOL 12.3457');
    });

    it('should format ORCA prices with 6 decimal places', () => {
        const price = new Decimal('0.123456789');
        expect(formatPrice(price, 'ORCA')).toBe('ORCA 0.123457');
    });

    it('should handle small values below 0.00001', () => {
        const price = new Decimal('0.000001234');
        expect(formatPrice(price, 'USDC')).toBe('$0.00');
    });

    it('should handle large values above 1,000,000', () => {
        const price = new Decimal('1234567.89');
        expect(formatPrice(price, 'USDC')).toBe('$1,234,567.89');
    });

    it('should handle negative prices', () => {
        const price = new Decimal('-123.45');
        expect(formatPrice(price, 'USDC')).toBe('-$123.45');
    });

    it('should handle zero price', () => {
        const price = new Decimal('0');
        expect(formatPrice(price, 'USDC')).toBe('$0.00');
    });

    it('should handle invalid input', () => {
        // @ts-expect-error Testing invalid input
        expect(formatPrice(null, 'USDC')).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatPrice(undefined, 'USDC')).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatPrice(NaN, 'USDC')).toBe('—');
    });
});

describe('formatVolume', () => {
    it('should format volumes in thousands with K suffix', () => {
        const volume = new Decimal('1234');
        expect(formatVolume(volume)).toBe('1.23K');
    });

    it('should format volumes in millions with M suffix', () => {
        const volume = new Decimal('1234567');
        expect(formatVolume(volume)).toBe('1.23M');
    });

    it('should format volumes in billions with B suffix', () => {
        const volume = new Decimal('1234567890');
        expect(formatVolume(volume)).toBe('1.23B');
    });

    it('should handle small volumes below 1000', () => {
        const volume = new Decimal('123.456');
        expect(formatVolume(volume)).toBe('123.456');
    });

    it('should handle zero volume', () => {
        const volume = new Decimal('0');
        expect(formatVolume(volume)).toBe('0');
    });

    it('should handle invalid input', () => {
        // @ts-expect-error Testing invalid input
        expect(formatVolume(null)).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatVolume(undefined)).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatVolume(NaN)).toBe('—');
    });
});

describe('formatPercentage', () => {
    it('should format positive percentages with + sign', () => {
        const value = new Decimal('0.1234');
        expect(formatPercentage(value)).toBe('+12.34%');
    });

    it('should format negative percentages with - sign', () => {
        const value = new Decimal('-0.0567');
        expect(formatPercentage(value)).toBe('-5.67%');
    });

    it('should handle zero percentage', () => {
        const value = new Decimal('0');
        expect(formatPercentage(value)).toBe('0.00%');
    });

    it('should handle small percentages below 0.01%', () => {
        const value = new Decimal('0.0001');
        expect(formatPercentage(value)).toBe('+0.01%');
    });

    it('should handle large percentages above 1000%', () => {
        const value = new Decimal('10.5');
        expect(formatPercentage(value)).toBe('+1,050.00%');
    });

    it('should handle invalid input', () => {
        // @ts-expect-error Testing invalid input
        expect(formatPercentage(null)).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatPercentage(undefined)).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatPercentage(NaN)).toBe('—');
    });
});

describe('formatPnL', () => {
    it('should format profits with green color class', () => {
        const value = new Decimal('123.45');
        const result = formatPnL(value);
        expect(result.value).toBe('+123.45');
        expect(result.className).toBe('text-green-500');
    });

    it('should format losses with red color class', () => {
        const value = new Decimal('-67.89');
        const result = formatPnL(value);
        expect(result.value).toBe('-67.89');
        expect(result.className).toBe('text-red-500');
    });

    it('should format zero with neutral color class', () => {
        const value = new Decimal('0');
        const result = formatPnL(value);
        expect(result.value).toBe('0.00');
        expect(result.className).toBe('text-gray-500');
    });

    it('should handle sign display option', () => {
        const value = new Decimal('123.45');
        const result = formatPnL(value, false);
        expect(result.value).toBe('123.45');
        expect(result.className).toBe('text-green-500');
    });

    it('should handle invalid input', () => {
        // @ts-expect-error Testing invalid input
        const result = formatPnL(null);
        expect(result.value).toBe('—');
        expect(result.className).toBe('text-gray-500');
    });
});

describe('formatBalance', () => {
    it('should format USDC balances with 2 decimal places', () => {
        const balance = new Decimal('50000.12345');
        expect(formatBalance(balance, 'USDC')).toBe('$50,000.12');
    });

    it('should format SOL balances with 4 decimal places', () => {
        const balance = new Decimal('123.456789');
        expect(formatBalance(balance, 'SOL')).toBe('SOL 123.4568');
    });

    it('should handle large balances with appropriate grouping', () => {
        const balance = new Decimal('1000000.00');
        expect(formatBalance(balance, 'USDC')).toBe('$1,000,000.00');
    });

    it('should handle small balances below 0.0001', () => {
        const balance = new Decimal('0.00000123');
        expect(formatBalance(balance, 'SOL')).toBe('SOL 0.0000');
    });

    it('should handle zero balance', () => {
        const balance = new Decimal('0');
        expect(formatBalance(balance, 'USDC')).toBe('$0.00');
    });

    it('should handle invalid input', () => {
        // @ts-expect-error Testing invalid input
        expect(formatBalance(null, 'USDC')).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatBalance(undefined, 'USDC')).toBe('—');
        // @ts-expect-error Testing invalid input
        expect(formatBalance(NaN, 'USDC')).toBe('—');
    });
});