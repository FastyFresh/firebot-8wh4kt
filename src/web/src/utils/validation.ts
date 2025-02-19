import Decimal from 'decimal.js-light'; // v2.5.1
import { OrderParams } from '../types/trading';
import { RiskParameters } from '../types/portfolio';
import { ApiError } from '../types/api';

// Trading pair validation constants
const MIN_TRADING_PAIR_LENGTH = 3;
const MAX_TRADING_PAIR_LENGTH = 10;
const TRADING_PAIR_REGEX = /^[A-Z0-9]{3,10}\/[A-Z0-9]{3,10}$/;

// Order size constants
const MIN_ORDER_SIZE = new Decimal('0.1');
const MAX_ORDER_SIZE = new Decimal('1000000');
const MAX_SLIPPAGE_BPS = 100;

// Risk parameter constants
const MIN_STOP_LOSS_PERCENT = new Decimal('0.1');
const MAX_STOP_LOSS_PERCENT = new Decimal('50');
const MIN_TAKE_PROFIT_PERCENT = new Decimal('0.2');
const MAX_TAKE_PROFIT_PERCENT = new Decimal('1000');
const MAX_POSITION_SIZE_PERCENT = new Decimal('25');

// Validation error codes
const enum ValidationErrorCode {
    INVALID_TRADING_PAIR = 1001,
    INVALID_ORDER_SIZE = 1002,
    INVALID_PRICE = 1003,
    INVALID_SLIPPAGE = 1004,
    INVALID_POSITION_SIZE = 1005,
    INVALID_STOP_LOSS = 1006,
    INVALID_TAKE_PROFIT = 1007,
    INVALID_DECIMAL = 1008
}

/**
 * Enhanced error class for validation failures with detailed reporting
 */
export class ValidationError extends Error implements ApiError {
    public readonly code: number;
    public readonly details: Record<string, unknown>;

    constructor(message: string, code: number, details?: Record<string, unknown>) {
        super(message);
        this.name = 'ValidationError';
        this.code = code;
        this.details = details || {};
        Error.captureStackTrace(this, ValidationError);
    }

    toJSON(): Record<string, unknown> {
        return {
            code: this.code,
            message: this.message,
            details: this.details
        };
    }
}

/**
 * Validates high-precision decimal values within specified range and precision
 */
export function validateDecimal(
    value: string | number | Decimal,
    min: Decimal,
    max: Decimal,
    decimals: number
): boolean {
    try {
        const decimalValue = new Decimal(value);
        
        if (decimalValue.isNaN() || !decimalValue.isFinite()) {
            throw new ValidationError(
                'Invalid decimal value',
                ValidationErrorCode.INVALID_DECIMAL,
                { value, min: min.toString(), max: max.toString() }
            );
        }

        if (decimalValue.lt(min) || decimalValue.gt(max)) {
            throw new ValidationError(
                `Value must be between ${min} and ${max}`,
                ValidationErrorCode.INVALID_DECIMAL,
                { value: decimalValue.toString(), min: min.toString(), max: max.toString() }
            );
        }

        const decimalPlaces = decimalValue.decimalPlaces();
        if (decimalPlaces > decimals) {
            throw new ValidationError(
                `Maximum ${decimals} decimal places allowed`,
                ValidationErrorCode.INVALID_DECIMAL,
                { value: decimalValue.toString(), decimals }
            );
        }

        return true;
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        throw new ValidationError(
            'Decimal validation failed',
            ValidationErrorCode.INVALID_DECIMAL,
            { value }
        );
    }
}

/**
 * Comprehensive validation of order parameters with detailed error reporting
 */
export function validateOrderParams(params: OrderParams): boolean {
    // Validate trading pair format
    if (!TRADING_PAIR_REGEX.test(params.tradingPair)) {
        throw new ValidationError(
            'Invalid trading pair format',
            ValidationErrorCode.INVALID_TRADING_PAIR,
            { tradingPair: params.tradingPair }
        );
    }

    // Validate order amount
    try {
        validateDecimal(
            params.amount,
            MIN_ORDER_SIZE,
            MAX_ORDER_SIZE,
            8
        );
    } catch (error) {
        throw new ValidationError(
            'Invalid order size',
            ValidationErrorCode.INVALID_ORDER_SIZE,
            { amount: params.amount.toString() }
        );
    }

    // Validate price
    if (params.price.lte(new Decimal(0))) {
        throw new ValidationError(
            'Price must be greater than zero',
            ValidationErrorCode.INVALID_PRICE,
            { price: params.price.toString() }
        );
    }

    // Validate slippage
    if (typeof params.maxSlippageBps !== 'number' || 
        params.maxSlippageBps < 0 || 
        params.maxSlippageBps > MAX_SLIPPAGE_BPS) {
        throw new ValidationError(
            'Invalid slippage value',
            ValidationErrorCode.INVALID_SLIPPAGE,
            { maxSlippageBps: params.maxSlippageBps }
        );
    }

    return true;
}

/**
 * Validates risk management parameters with comprehensive checks
 */
export function validateRiskParameters(params: RiskParameters): boolean {
    // Validate position size
    try {
        validateDecimal(
            params.maxPositionSize,
            new Decimal(0),
            MAX_POSITION_SIZE_PERCENT,
            2
        );
    } catch (error) {
        throw new ValidationError(
            'Invalid position size',
            ValidationErrorCode.INVALID_POSITION_SIZE,
            { maxPositionSize: params.maxPositionSize.toString() }
        );
    }

    // Validate stop loss
    try {
        validateDecimal(
            params.stopLossPercent,
            MIN_STOP_LOSS_PERCENT,
            MAX_STOP_LOSS_PERCENT,
            2
        );
    } catch (error) {
        throw new ValidationError(
            'Invalid stop loss percentage',
            ValidationErrorCode.INVALID_STOP_LOSS,
            { stopLossPercent: params.stopLossPercent.toString() }
        );
    }

    // Validate take profit
    try {
        validateDecimal(
            params.takeProfitPercent,
            MIN_TAKE_PROFIT_PERCENT,
            MAX_TAKE_PROFIT_PERCENT,
            2
        );
    } catch (error) {
        throw new ValidationError(
            'Invalid take profit percentage',
            ValidationErrorCode.INVALID_TAKE_PROFIT,
            { takeProfitPercent: params.takeProfitPercent.toString() }
        );
    }

    // Ensure take profit is greater than stop loss
    if (params.takeProfitPercent.lte(params.stopLossPercent)) {
        throw new ValidationError(
            'Take profit must be greater than stop loss',
            ValidationErrorCode.INVALID_TAKE_PROFIT,
            {
                stopLossPercent: params.stopLossPercent.toString(),
                takeProfitPercent: params.takeProfitPercent.toString()
            }
        );
    }

    return true;
}