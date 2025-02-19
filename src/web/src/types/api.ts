// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';

// Internal imports for type definitions
import { MarketData, Exchange } from './market';
import { Portfolio, Position } from './portfolio';
import { BaseStrategyConfig, StrategyType } from './strategy';
import { Order, OrderStatus } from './trading';

/**
 * Standard HTTP status codes used in API responses
 */
export enum HttpStatusCode {
    OK = 200,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    TOO_MANY_REQUESTS = 429,
    INTERNAL_SERVER_ERROR = 500,
    SERVICE_UNAVAILABLE = 503
}

/**
 * Supported API versions
 */
export enum ApiVersion {
    V1 = 'v1'
}

/**
 * Rate limiting information included in API responses
 */
export interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: Date;
    retryAfter?: number;
}

/**
 * Standard API error response structure
 */
export interface ApiError {
    code: HttpStatusCode;
    message: string;
    details: Record<string, unknown>;
    retryAfter: number | null;
    errorId?: string;
    documentationUrl?: string;
}

/**
 * Generic API response wrapper
 * @template T - Type of the response data
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data: T | null;
    error: ApiError | null;
    timestamp: Date;
    version: ApiVersion;
    rateLimit: RateLimitInfo;
}

/**
 * WebSocket message types for real-time updates
 */
export enum WebSocketMessageType {
    AUTH = 'AUTH',
    MARKET_DATA = 'MARKET_DATA',
    ORDER_UPDATE = 'ORDER_UPDATE',
    TRADE_UPDATE = 'TRADE_UPDATE',
    STRATEGY_UPDATE = 'STRATEGY_UPDATE',
    ERROR = 'ERROR',
    HEARTBEAT = 'HEARTBEAT'
}

/**
 * WebSocket authentication message
 */
export interface WebSocketAuthMessage {
    type: 'AUTH';
    token: string;
    timestamp: Date;
}

/**
 * Generic WebSocket message structure
 * @template T - Type of the message data
 */
export interface WebSocketMessage<T = unknown> {
    type: WebSocketMessageType;
    data: T;
    timestamp: Date;
    sequence?: number;
}

/**
 * Pagination parameters for API requests
 */
export interface PaginationParams {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    cursor?: string;
}

/**
 * Paginated API response wrapper
 * @template T - Type of the paginated items
 */
export interface PaginatedResponse<T = unknown> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
}

/**
 * Market data WebSocket message
 */
export interface MarketDataMessage extends WebSocketMessage<MarketData> {
    type: WebSocketMessageType.MARKET_DATA;
}

/**
 * Order update WebSocket message
 */
export interface OrderUpdateMessage extends WebSocketMessage<Order> {
    type: WebSocketMessageType.ORDER_UPDATE;
}

/**
 * Strategy update WebSocket message
 */
export interface StrategyUpdateMessage extends WebSocketMessage<BaseStrategyConfig> {
    type: WebSocketMessageType.STRATEGY_UPDATE;
}

/**
 * WebSocket error message
 */
export interface WebSocketErrorMessage extends WebSocketMessage<ApiError> {
    type: WebSocketMessageType.ERROR;
}

/**
 * API filter parameters
 */
export interface FilterParams {
    startDate?: Date;
    endDate?: Date;
    exchange?: Exchange;
    status?: OrderStatus;
    strategyType?: StrategyType;
    [key: string]: unknown;
}

/**
 * API search parameters
 */
export interface SearchParams {
    query: string;
    fields: string[];
    fuzzy?: boolean;
}

/**
 * Batch operation response
 */
export interface BatchOperationResponse {
    successful: string[];
    failed: Array<{
        id: string;
        error: ApiError;
    }>;
    totalProcessed: number;
}

/**
 * API health check response
 */
export interface HealthCheckResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    timestamp: Date;
    services: Record<string, {
        status: 'up' | 'down';
        latency: number;
    }>;
}

/**
 * Type guard for API response
 */
export function isApiResponse<T>(response: unknown): response is ApiResponse<T> {
    return (
        typeof response === 'object' &&
        response !== null &&
        'success' in response &&
        'timestamp' in response &&
        'version' in response
    );
}

/**
 * Type guard for paginated response
 */
export function isPaginatedResponse<T>(response: unknown): response is PaginatedResponse<T> {
    return (
        typeof response === 'object' &&
        response !== null &&
        'items' in response &&
        'total' in response &&
        'page' in response &&
        'limit' in response
    );
}