import { describe, it, expect } from 'jest'; // v29.0.0
import Decimal from 'decimal.js-light'; // v2.5.1
import {
    validateOrderParams,
    validateRiskParameters,
    validateDecimal,
    ValidationError
} from '../../src/utils/validation';
import { OrderParams } from '../../src/types/trading';
import { RiskParameters } from '../../src/types/portfolio';

describe('Decimal Validation', () => {
    it('should validate correct decimal values', () => {
        expect(() => validateDecimal('10.5', new Decimal('0'), new Decimal('100'), 2)).not.toThrow();
        expect(() => validateDecimal(50, new Decimal('0'), new Decimal('100'), 0)).not.toThrow();
        expect(() => validateDecimal(new Decimal('0.001'), new Decimal('0'), new Decimal('1'), 3)).not.toThrow();
    });

    it('should throw ValidationError for invalid decimal format', () => {
        expect(() => validateDecimal('abc', new Decimal('0'), new Decimal('100'), 2))
            .toThrow(ValidationError);
        expect(() => validateDecimal('1.234e5', new Decimal('0'), new Decimal('100'), 2))
            .toThrow(ValidationError);
        expect(() => validateDecimal(NaN, new Decimal('0'), new Decimal('100'), 2))
            .toThrow(ValidationError);
    });

    it('should throw ValidationError for out of range values', () => {
        expect(() => validateDecimal('-1', new Decimal('0'), new Decimal('100'), 2))
            .toThrow(ValidationError);
        expect(() => validateDecimal('101', new Decimal('0'), new Decimal('100'), 2))
            .toThrow(ValidationError);
    });

    it('should throw ValidationError for excessive decimal places', () => {
        expect(() => validateDecimal('10.123', new Decimal('0'), new Decimal('100'), 2))
            .toThrow(ValidationError);
        expect(() => validateDecimal('0.0001', new Decimal('0'), new Decimal('1'), 3))
            .toThrow(ValidationError);
    });
});

describe('Order Parameter Validation', () => {
    const validOrderParams: OrderParams = {
        tradingPair: 'SOL/USDC',
        price: new Decimal('22.50'),
        amount: new Decimal('10'),
        maxSlippageBps: 50,
        type: 'MARKET',
        side: 'buy',
        exchange: 'JUPITER',
        mevEnabled: true,
        preferredRoute: [],
        validationRules: {}
    };

    it('should validate correct order parameters', () => {
        expect(() => validateOrderParams(validOrderParams)).not.toThrow();
    });

    it('should throw ValidationError for invalid trading pair format', () => {
        const invalidPairs = ['SOLUSDC', 'SOL-USDC', 'sol/usdc', 'SOL/USD/C'];
        
        invalidPairs.forEach(pair => {
            expect(() => validateOrderParams({
                ...validOrderParams,
                tradingPair: pair
            })).toThrow(ValidationError);
        });
    });

    it('should throw ValidationError for invalid order size', () => {
        expect(() => validateOrderParams({
            ...validOrderParams,
            amount: new Decimal('0')
        })).toThrow(ValidationError);

        expect(() => validateOrderParams({
            ...validOrderParams,
            amount: new Decimal('1000001')
        })).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid price', () => {
        expect(() => validateOrderParams({
            ...validOrderParams,
            price: new Decimal('0')
        })).toThrow(ValidationError);

        expect(() => validateOrderParams({
            ...validOrderParams,
            price: new Decimal('-1')
        })).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid slippage', () => {
        expect(() => validateOrderParams({
            ...validOrderParams,
            maxSlippageBps: -1
        })).toThrow(ValidationError);

        expect(() => validateOrderParams({
            ...validOrderParams,
            maxSlippageBps: 101
        })).toThrow(ValidationError);
    });
});

describe('Risk Parameter Validation', () => {
    const validRiskParams: RiskParameters = {
        maxPositionSize: new Decimal('10'),
        stopLossPercent: new Decimal('2'),
        takeProfitPercent: new Decimal('5'),
        maxDrawdownPercent: new Decimal('20'),
        riskLevel: 10,
        maxLeverage: new Decimal('1'),
        marginCallLevel: new Decimal('80')
    };

    it('should validate correct risk parameters', () => {
        expect(() => validateRiskParameters(validRiskParams)).not.toThrow();
    });

    it('should throw ValidationError for invalid position size', () => {
        expect(() => validateRiskParameters({
            ...validRiskParams,
            maxPositionSize: new Decimal('26')
        })).toThrow(ValidationError);

        expect(() => validateRiskParameters({
            ...validRiskParams,
            maxPositionSize: new Decimal('0')
        })).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid stop loss', () => {
        expect(() => validateRiskParameters({
            ...validRiskParams,
            stopLossPercent: new Decimal('0')
        })).toThrow(ValidationError);

        expect(() => validateRiskParameters({
            ...validRiskParams,
            stopLossPercent: new Decimal('51')
        })).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid take profit', () => {
        expect(() => validateRiskParameters({
            ...validRiskParams,
            takeProfitPercent: new Decimal('0.1')
        })).toThrow(ValidationError);

        expect(() => validateRiskParameters({
            ...validRiskParams,
            takeProfitPercent: new Decimal('1001')
        })).toThrow(ValidationError);
    });

    it('should throw ValidationError when take profit is less than stop loss', () => {
        expect(() => validateRiskParameters({
            ...validRiskParams,
            stopLossPercent: new Decimal('5'),
            takeProfitPercent: new Decimal('4')
        })).toThrow(ValidationError);
    });

    it('should validate decimal precision for percentage values', () => {
        expect(() => validateRiskParameters({
            ...validRiskParams,
            stopLossPercent: new Decimal('2.123'),
            takeProfitPercent: new Decimal('5.123')
        })).toThrow(ValidationError);
    });
});