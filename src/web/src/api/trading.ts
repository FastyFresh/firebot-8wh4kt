// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// opossum v6.0.1
import CircuitBreaker from 'opossum';

import { Order, OrderParams, OrderStatus } from '../types/trading';
import { makeApiRequest } from '../utils/api';
import { API_ENDPOINTS, ERROR_CODES } from '../constants/api';
import { ApiResponse, PaginatedResponse, FilterParams } from '../types/api';
import { Exchange } from '../types/market';

// Constants for order validation and MEV optimization
const MIN_ORDER_SIZE = new Decimal(0.1);
const MAX_ORDER_SIZE = new Decimal(1000000);
const MAX_SLIPPAGE_BPS = 100;
const MEV_OPTIMIZATION_TIMEOUT = 2000; // 2 seconds
const ORDER_EXECUTION_TIMEOUT = 5000; // 5 seconds

// Circuit breaker configuration for trading operations
const tradingCircuitBreaker = new CircuitBreaker(async (operation: () => Promise<any>) => {
    return await operation();
}, {
    timeout: ORDER_EXECUTION_TIMEOUT,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 10
});

/**
 * Interface for trade execution route optimization
 */
interface ExecutionRoute {
    path: Exchange[];
    expectedPrice: Decimal;
    expectedSlippage: number;
    mevOptimization: boolean;
    gasCost: Decimal;
}

/**
 * Interface for trade analytics with MEV performance
 */
interface TradeAnalytics {
    trades: Order[];
    totalVolume: Decimal;
    averageSlippage: number;
    mevProfits: Decimal;
    executionLatency: number;
}

/**
 * Places a new order with MEV optimization across multiple DEXs
 * @param orderParams Order parameters including trading pair, size, and MEV preferences
 * @returns Created order details with execution route
 */
export const placeOrder = async (
    orderParams: OrderParams
): Promise<ApiResponse<Order>> => {
    try {
        // Validate order parameters
        const amount = new Decimal(orderParams.amount);
        if (amount.lessThan(MIN_ORDER_SIZE) || amount.greaterThan(MAX_ORDER_SIZE)) {
            throw new Error(`Order size must be between ${MIN_ORDER_SIZE} and ${MAX_ORDER_SIZE}`);
        }

        if (orderParams.maxSlippageBps > MAX_SLIPPAGE_BPS) {
            throw new Error(`Maximum slippage cannot exceed ${MAX_SLIPPAGE_BPS} basis points`);
        }

        // Calculate optimal execution route with MEV optimization
        const executionRoute = await calculateExecutionRoute(orderParams);

        // Prepare order with execution route
        const orderRequest = {
            ...orderParams,
            executionRoute: executionRoute.path,
            expectedPrice: executionRoute.expectedPrice,
            mevOptimization: executionRoute.mevOptimization,
            gasCost: executionRoute.gasCost
        };

        // Execute order with circuit breaker protection
        return await tradingCircuitBreaker.fire(async () => {
            const response = await makeApiRequest<Order>(
                'POST',
                API_ENDPOINTS.TRADING.CREATE_ORDER,
                orderRequest,
                {
                    timeout: ORDER_EXECUTION_TIMEOUT,
                    retry: true,
                    circuitBreaker: true
                }
            );

            return response;
        });
    } catch (error) {
        console.error('Order placement failed:', error);
        return {
            success: false,
            data: null,
            error: {
                code: ERROR_CODES.TRADING_ERROR,
                message: error.message,
                details: {},
                retryAfter: null
            },
            timestamp: new Date(),
            version: 'v1',
            rateLimit: {
                limit: 0,
                remaining: 0,
                reset: new Date()
            }
        };
    }
};

/**
 * Retrieves orders with enhanced filtering and pagination
 * @param filter Filter parameters for order retrieval
 * @param pagination Pagination parameters
 * @returns Paginated list of orders with execution details
 */
export const getOrders = async (
    filter: FilterParams,
    pagination: { page: number; limit: number }
): Promise<ApiResponse<PaginatedResponse<Order>>> => {
    try {
        const queryParams = new URLSearchParams({
            ...filter,
            page: pagination.page.toString(),
            limit: pagination.limit.toString()
        });

        return await makeApiRequest<PaginatedResponse<Order>>(
            'GET',
            `${API_ENDPOINTS.TRADING.ACTIVE_ORDERS}?${queryParams}`,
            undefined,
            {
                cache: true,
                retry: true
            }
        );
    } catch (error) {
        console.error('Order retrieval failed:', error);
        return {
            success: false,
            data: null,
            error: {
                code: ERROR_CODES.SYSTEM_ERROR,
                message: error.message,
                details: {},
                retryAfter: null
            },
            timestamp: new Date(),
            version: 'v1',
            rateLimit: {
                limit: 0,
                remaining: 0,
                reset: new Date()
            }
        };
    }
};

/**
 * Retrieves trade history with MEV analytics
 * @param filter Filter parameters for trade history
 * @returns Trade history with MEV performance metrics
 */
export const getTrades = async (
    filter: FilterParams
): Promise<ApiResponse<TradeAnalytics>> => {
    try {
        const queryParams = new URLSearchParams(filter as Record<string, string>);

        return await makeApiRequest<TradeAnalytics>(
            'GET',
            `${API_ENDPOINTS.TRADING.TRADE_HISTORY}?${queryParams}`,
            undefined,
            {
                cache: true,
                retry: true
            }
        );
    } catch (error) {
        console.error('Trade history retrieval failed:', error);
        return {
            success: false,
            data: null,
            error: {
                code: ERROR_CODES.SYSTEM_ERROR,
                message: error.message,
                details: {},
                retryAfter: null
            },
            timestamp: new Date(),
            version: 'v1',
            rateLimit: {
                limit: 0,
                remaining: 0,
                reset: new Date()
            }
        };
    }
};

/**
 * Calculates optimal execution route across DEXs with MEV optimization
 * @param orderParams Order parameters for route calculation
 * @returns Optimized execution route with expected pricing
 */
async function calculateExecutionRoute(
    orderParams: OrderParams
): Promise<ExecutionRoute> {
    const route: ExecutionRoute = {
        path: [],
        expectedPrice: new Decimal(0),
        expectedSlippage: 0,
        mevOptimization: false,
        gasCost: new Decimal(0)
    };

    try {
        // Request optimal route from API with timeout for MEV optimization
        const response = await Promise.race([
            makeApiRequest<ExecutionRoute>(
                'POST',
                `${API_ENDPOINTS.TRADING.OPTIMIZE_ROUTE}`,
                orderParams
            ),
            new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('MEV optimization timeout')), MEV_OPTIMIZATION_TIMEOUT)
            )
        ]);

        if (response.success && response.data) {
            return response.data;
        }

        // Fallback to default route if optimization fails
        route.path = [orderParams.exchange];
        route.expectedPrice = orderParams.price;
        route.expectedSlippage = 0;
        route.mevOptimization = false;
        route.gasCost = new Decimal(0);
    } catch (error) {
        console.warn('Route optimization failed, using default route:', error);
        route.path = [orderParams.exchange];
        route.expectedPrice = orderParams.price;
    }

    return route;
}