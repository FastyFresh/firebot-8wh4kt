import { WebSocketMessageType } from '../types/api';

// API version and base paths
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;
export const WS_BASE_PATH = `/ws/${API_VERSION}`;

/**
 * Comprehensive API endpoints for all services
 */
export const API_ENDPOINTS = {
    AUTH: {
        LOGIN: `${API_BASE_PATH}/auth/login`,
        LOGOUT: `${API_BASE_PATH}/auth/logout`,
        REFRESH: `${API_BASE_PATH}/auth/refresh`,
        VERIFY: `${API_BASE_PATH}/auth/verify`,
    },
    MARKET: {
        PRICE: `${API_BASE_PATH}/market/price`,
        ORDERBOOK: `${API_BASE_PATH}/market/orderbook`,
        DEPTH: `${API_BASE_PATH}/market/depth`,
        OHLCV: `${API_BASE_PATH}/market/ohlcv`,
        PAIRS: `${API_BASE_PATH}/market/pairs`,
    },
    PORTFOLIO: {
        OVERVIEW: `${API_BASE_PATH}/portfolio/overview`,
        POSITIONS: `${API_BASE_PATH}/portfolio/positions`,
        PERFORMANCE: `${API_BASE_PATH}/portfolio/performance`,
        RISK_METRICS: `${API_BASE_PATH}/portfolio/risk-metrics`,
        ALLOCATIONS: `${API_BASE_PATH}/portfolio/allocations`,
    },
    TRADING: {
        CREATE_ORDER: `${API_BASE_PATH}/trading/orders`,
        CANCEL_ORDER: `${API_BASE_PATH}/trading/orders/:orderId/cancel`,
        ORDER_STATUS: `${API_BASE_PATH}/trading/orders/:orderId`,
        TRADE_HISTORY: `${API_BASE_PATH}/trading/history`,
        ACTIVE_ORDERS: `${API_BASE_PATH}/trading/orders/active`,
    },
    STRATEGY: {
        LIST: `${API_BASE_PATH}/strategy/list`,
        CREATE: `${API_BASE_PATH}/strategy/create`,
        UPDATE: `${API_BASE_PATH}/strategy/update/:strategyId`,
        DELETE: `${API_BASE_PATH}/strategy/delete/:strategyId`,
        PERFORMANCE: `${API_BASE_PATH}/strategy/performance/:strategyId`,
        OPTIMIZE: `${API_BASE_PATH}/strategy/optimize/:strategyId`,
    },
} as const;

/**
 * API rate limit configurations per endpoint category
 */
export const API_RATE_LIMITS = {
    MARKET_DATA: {
        requestsPerMinute: 1000,
        burstSize: 100,
        resetPeriod: 60, // seconds
    },
    TRADING: {
        requestsPerMinute: 100,
        burstSize: 20,
        resetPeriod: 60,
    },
    PORTFOLIO: {
        requestsPerMinute: 300,
        burstSize: 50,
        resetPeriod: 60,
    },
} as const;

/**
 * WebSocket message types for real-time updates
 */
export const WS_MESSAGE_TYPES = {
    MARKET_DATA: WebSocketMessageType.MARKET_DATA,
    ORDER_UPDATE: WebSocketMessageType.ORDER_UPDATE,
    TRADE_UPDATE: WebSocketMessageType.TRADE_UPDATE,
    STRATEGY_UPDATE: WebSocketMessageType.STRATEGY_UPDATE,
} as const;

/**
 * Standard HTTP status codes used across the application
 */
export const HTTP_STATUS_CODES = {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Application-specific error codes with corresponding retry strategies
 */
export const ERROR_CODES = {
    // Validation errors (4000-4099)
    VALIDATION_ERROR: 4000,
    INVALID_PARAMETERS: 4001,
    INVALID_ORDER_SIZE: 4002,
    INVALID_PRICE: 4003,
    
    // Authentication errors (4100-4199)
    AUTHENTICATION_ERROR: 4100,
    INVALID_TOKEN: 4101,
    TOKEN_EXPIRED: 4102,
    INSUFFICIENT_PERMISSIONS: 4103,
    
    // Rate limit errors (4200-4299)
    RATE_LIMIT_ERROR: 4200,
    BURST_LIMIT_EXCEEDED: 4201,
    
    // Trading errors (4300-4399)
    TRADING_ERROR: 4300,
    INSUFFICIENT_BALANCE: 4301,
    ORDER_NOT_FOUND: 4302,
    MARKET_CLOSED: 4303,
    PRICE_SLIPPAGE: 4304,
    
    // Strategy errors (4400-4499)
    STRATEGY_ERROR: 4400,
    INVALID_STRATEGY: 4401,
    STRATEGY_OPTIMIZATION_FAILED: 4402,
    
    // Network errors (5000-5099)
    NETWORK_ERROR: 5000,
    DEX_CONNECTION_ERROR: 5001,
    BLOCKCHAIN_ERROR: 5002,
    
    // System errors (5100-5199)
    SYSTEM_ERROR: 5100,
    DATABASE_ERROR: 5101,
    CACHE_ERROR: 5102,
} as const;

/**
 * Error categories with retry strategies
 */
export const ERROR_CATEGORIES = {
    RETRYABLE: [
        ERROR_CODES.NETWORK_ERROR,
        ERROR_CODES.DEX_CONNECTION_ERROR,
        ERROR_CODES.BLOCKCHAIN_ERROR,
        ERROR_CODES.SYSTEM_ERROR,
        ERROR_CODES.DATABASE_ERROR,
        ERROR_CODES.CACHE_ERROR,
    ],
    NON_RETRYABLE: [
        ERROR_CODES.VALIDATION_ERROR,
        ERROR_CODES.AUTHENTICATION_ERROR,
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        ERROR_CODES.INSUFFICIENT_BALANCE,
    ],
    RATE_LIMIT: [
        ERROR_CODES.RATE_LIMIT_ERROR,
        ERROR_CODES.BURST_LIMIT_EXCEEDED,
    ],
} as const;