// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
import { OrderType } from '../types/trading';
import { Exchange } from '../types/market';

// Global configuration constants
export const DEFAULT_SLIPPAGE_BPS = 50;
export const DEFAULT_ORDER_TIMEOUT_MS = 30000;
export const DEFAULT_CONFIRMATION_BLOCKS = 2;

/**
 * Returns dynamic order size limits based on current liquidity conditions
 */
export const getOrderSizeLimits = (tradingPair: string, exchange: Exchange) => {
    return {
        min: new Decimal('0.1'),
        max: new Decimal('1000000'),
        recommended: {
            min: new Decimal('1'),
            max: new Decimal('10000')
        },
        liquidityAdjusted: {
            threshold: new Decimal('0.1'), // 10% of available liquidity
            timeWindow: 3600000 // 1 hour in milliseconds
        },
        validation: {
            enabled: true,
            checkLiquidity: true,
            checkVolatility: true
        }
    };
};

/**
 * Returns DEX-specific execution configuration including MEV parameters
 */
export const getDexExecutionConfig = (exchange: Exchange) => {
    const baseConfig = {
        connection: {
            timeout: 5000,
            retries: 3,
            backoff: {
                initial: 1000,
                max: 10000,
                factor: 1.5
            }
        },
        rateLimit: {
            requests: 100,
            period: 60000 // 1 minute
        }
    };

    const exchangeConfigs = {
        [Exchange.JUPITER]: {
            ...baseConfig,
            routeOptimization: {
                enabled: true,
                maxRoutes: 3,
                maxSplits: 5,
                minSizePerRoute: new Decimal('0.1')
            },
            mev: {
                enabled: true,
                jitoIntegration: {
                    enabled: true,
                    bundlePriority: 'high',
                    maxTipRate: new Decimal('0.01') // 1% max tip
                }
            }
        },
        [Exchange.PUMP_FUN]: {
            ...baseConfig,
            routeOptimization: {
                enabled: false
            },
            mev: {
                enabled: false
            }
        },
        [Exchange.DRIFT]: {
            ...baseConfig,
            perpetual: {
                enabled: true,
                maxLeverage: new Decimal('10'),
                marginType: 'cross'
            },
            mev: {
                enabled: true,
                jitoIntegration: {
                    enabled: true,
                    bundlePriority: 'medium',
                    maxTipRate: new Decimal('0.005') // 0.5% max tip
                }
            }
        }
    };

    return exchangeConfigs[exchange];
};

/**
 * Comprehensive trading configuration
 */
export const tradingConfig = {
    orderSizeLimits: {
        getOrderSizeLimits,
        globalLimits: {
            minSize: new Decimal('0.1'),
            maxSize: new Decimal('1000000'),
            maxSlippageBps: 100
        }
    },
    executionParameters: {
        timeout: DEFAULT_ORDER_TIMEOUT_MS,
        confirmationBlocks: DEFAULT_CONFIRMATION_BLOCKS,
        defaultSlippageBps: DEFAULT_SLIPPAGE_BPS,
        retryPolicy: {
            maxAttempts: 3,
            backoffMs: 1000
        },
        priorityLevels: {
            high: {
                maxTipRate: new Decimal('0.01'),
                timeoutMs: 10000
            },
            medium: {
                maxTipRate: new Decimal('0.005'),
                timeoutMs: 20000
            },
            low: {
                maxTipRate: new Decimal('0.001'),
                timeoutMs: 30000
            }
        }
    },
    dexConfig: {
        getDexExecutionConfig,
        globalSettings: {
            maxRoutes: 5,
            maxSplits: 10,
            minSizePerRoute: new Decimal('0.1'),
            routeTimeout: 5000
        }
    },
    refreshIntervals: {
        orderBook: 1000,    // 1 second
        marketData: 5000,   // 5 seconds
        positions: 10000,   // 10 seconds
        portfolio: 30000    // 30 seconds
    },
    mevParameters: {
        enabled: true,
        jitoLabs: {
            enabled: true,
            bundleBuilder: {
                maxSize: 3,
                maxTimeout: 2000,
                priorityFee: new Decimal('0.005')
            },
            searcherConfig: {
                enabled: true,
                strategies: ['backrun', 'sandwich'],
                minProfitThreshold: new Decimal('0.001')
            }
        },
        optimization: {
            routeSelection: true,
            timingOptimization: true,
            gasPriceAdjustment: true,
            slippageProtection: true
        }
    }
};

export default tradingConfig;