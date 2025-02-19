// decimal.js-light v2.5.1 - High-precision decimal calculations
import Decimal from 'decimal.js-light';
import { Exchange } from '../types/market';

// Global order size limits
export const MIN_ORDER_SIZE = new Decimal('0.1');
export const MAX_ORDER_SIZE = new Decimal('1000000');
export const MAX_SLIPPAGE_BPS = 100;

// Real-time data refresh intervals (in milliseconds)
export const ORDER_REFRESH_INTERVAL = 1000;
export const MARKET_DATA_REFRESH_INTERVAL = 500;

/**
 * Supported trading pairs for each DEX
 * Mapping of exchange to their supported trading pairs
 */
export const SUPPORTED_TRADING_PAIRS: Record<Exchange, string[]> = {
    [Exchange.JUPITER]: [
        'SOL/USDC',
        'ORCA/USDC',
        'RAY/USDC',
        'SRM/USDC',
        'MNGO/USDC'
    ],
    [Exchange.PUMP_FUN]: [
        'SOL/USDC',
        'ORCA/USDC',
        'RAY/USDC'
    ],
    [Exchange.DRIFT]: [
        'SOL-PERP',
        'BTC-PERP',
        'ETH-PERP'
    ]
};

/**
 * Trading pair specific order size limits with high-precision decimal values
 */
export const ORDER_SIZE_LIMITS: Record<string, { min: Decimal; max: Decimal }> = {
    'SOL/USDC': {
        min: new Decimal('0.1'),
        max: new Decimal('10000')
    },
    'ORCA/USDC': {
        min: new Decimal('1'),
        max: new Decimal('100000')
    },
    'RAY/USDC': {
        min: new Decimal('1'),
        max: new Decimal('50000')
    },
    'SOL-PERP': {
        min: new Decimal('0.1'),
        max: new Decimal('5000')
    }
};

/**
 * Execution timeout configurations for different phases of order processing
 */
export const EXECUTION_TIMEOUTS: Record<string, number> = {
    orderTimeout: 30000,        // 30 seconds for order placement
    confirmationTimeout: 45000, // 45 seconds for transaction confirmation
    networkRetryDelay: 1000,   // 1 second between retries
    maxRetryAttempts: 3        // Maximum number of retry attempts
};

/**
 * DEX-specific configuration interface
 */
interface DexConfig {
    baseUrl: string;
    websocketUrl: string;
    rateLimit: {
        requests: number;
        interval: number;
    };
    connectionTimeout: number;
    maxBatchSize: number;
}

/**
 * DEX-specific constants and configuration parameters
 */
export const DEX_SPECIFIC_CONSTANTS: Record<Exchange, DexConfig> = {
    [Exchange.JUPITER]: {
        baseUrl: 'https://api.jup.ag/v4',
        websocketUrl: 'wss://api.jup.ag/v4/ws',
        rateLimit: {
            requests: 100,
            interval: 10000 // 10 seconds
        },
        connectionTimeout: 5000,
        maxBatchSize: 100
    },
    [Exchange.PUMP_FUN]: {
        baseUrl: 'https://api.pump.fun/v1',
        websocketUrl: 'wss://api.pump.fun/v1/ws',
        rateLimit: {
            requests: 50,
            interval: 10000
        },
        connectionTimeout: 3000,
        maxBatchSize: 50
    },
    [Exchange.DRIFT]: {
        baseUrl: 'https://api.drift.trade/v2',
        websocketUrl: 'wss://api.drift.trade/v2/ws',
        rateLimit: {
            requests: 80,
            interval: 10000
        },
        connectionTimeout: 4000,
        maxBatchSize: 75
    }
};

/**
 * Optimized refresh intervals for different data types (in milliseconds)
 */
export const REFRESH_INTERVALS: Record<string, number> = {
    orderBook: 500,      // 500ms for order book updates
    marketData: 500,     // 500ms for market data
    portfolio: 1000,     // 1s for portfolio updates
    performance: 5000,   // 5s for performance metrics
    riskMetrics: 1000,   // 1s for risk metrics
    systemStatus: 10000  // 10s for system status
};

/**
 * Risk management constants
 */
export const RISK_CONSTANTS = {
    maxPositionSizePercent: 5,    // Maximum 5% of portfolio per position
    maxLeverageRatio: 5,          // Maximum 5x leverage
    stopLossMinDistance: 1,       // Minimum 1% stop loss distance
    takeProfitMinDistance: 2,     // Minimum 2% take profit distance
    maxDrawdownPercent: 25,       // Maximum 25% drawdown allowed
    emergencyClosureThreshold: 50 // 50% loss triggers emergency closure
};

/**
 * Performance monitoring thresholds
 */
export const PERFORMANCE_THRESHOLDS = {
    executionLatencyWarning: 500,    // Warning at 500ms execution time
    executionLatencyError: 2000,     // Error at 2s execution time
    orderBookDepthMinimum: 100,      // Minimum order book depth
    priceImpactWarning: 100,         // 1% price impact warning
    liquidityScoreMinimum: 0.8,      // Minimum liquidity score
    stalePriceThreshold: 5000        // 5s stale price threshold
};