// decimal.js-light v2.5.1 - High-precision decimal calculations
import Decimal from 'decimal.js-light';
import { Exchange, MarketData } from './market';

// Global constants for order validation
export const MIN_ORDER_SIZE = 0.1;
export const MAX_ORDER_SIZE = 1000000;
export const MAX_SLIPPAGE_BPS = 100;

/**
 * Supported order types in the trading system
 */
export enum OrderType {
    MARKET = 'MARKET',
    LIMIT = 'LIMIT'
}

/**
 * Possible states of an order during its lifecycle
 */
export enum OrderStatus {
    PENDING = 'PENDING',    // Initial state when order is submitted
    OPEN = 'OPEN',         // Active on the order book (limit orders)
    FILLED = 'FILLED',     // Completely executed
    CANCELLED = 'CANCELLED', // Cancelled by user or system
    FAILED = 'FAILED'      // Failed due to error
}

/**
 * Comprehensive order details with execution tracking
 */
export interface Order {
    id: string;
    tradingPair: string;
    exchange: Exchange;
    type: OrderType;
    side: 'buy' | 'sell';
    price: Decimal;
    amount: Decimal;
    status: OrderStatus;
    filledAmount: Decimal;
    remainingAmount: Decimal;
    createdAt: Date;
    updatedAt: Date;
    transactionHash: string;
    executionRoute: string[];  // DEX routing path for order execution
    gasCost: Decimal;         // Transaction gas cost in SOL
    slippageLimit: number;    // Maximum allowed slippage in basis points
}

/**
 * Detailed trade execution record with MEV optimization tracking
 */
export interface Trade {
    id: string;
    orderId: string;
    tradingPair: string;
    exchange: Exchange;
    price: Decimal;
    amount: Decimal;
    side: 'buy' | 'sell';
    fee: Decimal;
    timestamp: Date;
    mevStrategy: string;     // Applied MEV optimization strategy
    mevProfit: Decimal;      // Additional profit from MEV optimization
    executionLatency: number; // Execution time in milliseconds
}

/**
 * Extended order parameters with MEV and routing preferences
 */
export interface OrderParams {
    tradingPair: string;
    exchange: Exchange;
    type: OrderType;
    side: 'buy' | 'sell';
    price: Decimal;
    amount: Decimal;
    maxSlippageBps: number;   // Maximum allowed slippage in basis points
    mevEnabled: boolean;      // Whether to enable MEV optimization
    preferredRoute: string[]; // Preferred DEX routing path
    validationRules: Record<string, unknown>; // Custom validation rules
}