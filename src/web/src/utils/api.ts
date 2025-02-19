// axios v1.4.0 - HTTP client for API requests
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
// retry-axios v3.0.0 - Advanced retry mechanism
import rax from 'retry-axios';
// cache-manager v5.2.0 - Response caching
import { caching } from 'cache-manager';
// circuit-breaker-js v0.5.0 - Circuit breaker pattern
import CircuitBreaker from 'circuit-breaker-js';

import { ApiResponse, HttpStatusCode, WebSocketMessage, WebSocketMessageType } from '../types/api';
import { API_ENDPOINTS, API_RATE_LIMITS, ERROR_CODES, ERROR_CATEGORIES } from '../constants/api';

// Cache configuration
const cache = caching({
    store: 'memory',
    max: 1000,
    ttl: 30 // seconds
});

// Circuit breaker configuration
const circuitBreaker = new CircuitBreaker({
    windowDuration: 10000, // 10 seconds
    numBuckets: 10,
    errorThreshold: 50, // 50% error rate
    volumeThreshold: 10,
    timeout: 30000 // 30 seconds
});

// Request configuration interface
interface RequestConfig extends AxiosRequestConfig {
    cache?: boolean;
    retry?: boolean;
    circuitBreaker?: boolean;
    timeout?: number;
}

// WebSocket configuration interface
interface WebSocketConfig {
    reconnectAttempts?: number;
    reconnectInterval?: number;
    heartbeatInterval?: number;
}

// Request context for error handling
interface RequestContext {
    endpoint: string;
    method: string;
    startTime: number;
    retryCount: number;
}

/**
 * Enhanced error handler with circuit breaker integration
 */
export const handleApiError = (error: AxiosError | Error, context: RequestContext): ApiResponse => {
    const errorResponse: ApiResponse = {
        success: false,
        data: null,
        error: {
            code: HttpStatusCode.INTERNAL_SERVER_ERROR,
            message: error.message,
            details: {},
            retryAfter: null,
            errorId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        },
        timestamp: new Date(),
        version: 'v1',
        rateLimit: {
            limit: 0,
            remaining: 0,
            reset: new Date()
        }
    };

    if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorCode = error.response?.data?.code;

        // Update circuit breaker state
        if (ERROR_CATEGORIES.RETRYABLE.includes(errorCode)) {
            circuitBreaker.recordFailure();
        }

        // Handle rate limiting
        if (statusCode === HttpStatusCode.TOO_MANY_REQUESTS) {
            errorResponse.error.retryAfter = parseInt(error.response?.headers['retry-after'] || '60', 10);
            errorResponse.error.code = HttpStatusCode.TOO_MANY_REQUESTS;
        }

        // Add detailed error information
        errorResponse.error.details = {
            endpoint: context.endpoint,
            method: context.method,
            duration: Date.now() - context.startTime,
            retryCount: context.retryCount,
            errorCode
        };
    }

    return errorResponse;
};

/**
 * Advanced API request utility with performance monitoring
 */
export const makeApiRequest = async <T>(
    method: string,
    url: string,
    data?: unknown,
    config: RequestConfig = {}
): Promise<ApiResponse<T>> => {
    const context: RequestContext = {
        endpoint: url,
        method,
        startTime: Date.now(),
        retryCount: 0
    };

    // Check circuit breaker state
    if (config.circuitBreaker && !circuitBreaker.isOpen()) {
        return {
            success: false,
            data: null,
            error: {
                code: HttpStatusCode.SERVICE_UNAVAILABLE,
                message: 'Circuit breaker is open',
                details: {},
                retryAfter: circuitBreaker.getRemainingTime()
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

    // Check cache for GET requests
    if (method === 'GET' && config.cache) {
        const cachedResponse = await cache.get<ApiResponse<T>>(url);
        if (cachedResponse) {
            return cachedResponse;
        }
    }

    try {
        const axiosConfig: AxiosRequestConfig = {
            ...config,
            method,
            url,
            data,
            timeout: config.timeout || 5000,
            headers: {
                'Content-Type': 'application/json',
                ...config.headers
            }
        };

        // Configure retry mechanism
        if (config.retry) {
            axiosConfig.raxConfig = {
                retry: 3,
                retryDelay: 1000,
                statusCodesToRetry: [[500, 599]],
                onRetryAttempt: (err: AxiosError) => {
                    context.retryCount++;
                    console.warn(`Retry attempt ${context.retryCount} for ${url}`, err);
                }
            };
        }

        const response: AxiosResponse<ApiResponse<T>> = await axios(axiosConfig);

        // Cache successful GET responses
        if (method === 'GET' && config.cache && response.data.success) {
            await cache.set(url, response.data);
        }

        // Record successful request
        circuitBreaker.recordSuccess();

        return response.data;
    } catch (error) {
        return handleApiError(error as AxiosError, context);
    }
};

/**
 * WebSocket connection manager with automatic reconnection
 */
export const initializeWebSocket = (
    endpoint: string,
    config: WebSocketConfig = {}
): WebSocket => {
    const {
        reconnectAttempts = 5,
        reconnectInterval = 1000,
        heartbeatInterval = 30000
    } = config;

    let ws: WebSocket;
    let reconnectCount = 0;
    let heartbeatTimer: NodeJS.Timeout;

    const connect = () => {
        ws = new WebSocket(endpoint);

        ws.onopen = () => {
            console.log('WebSocket connected');
            reconnectCount = 0;
            startHeartbeat();
        };

        ws.onclose = () => {
            console.log('WebSocket closed');
            clearInterval(heartbeatTimer);
            handleReconnect();
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onmessage = (event) => {
            const message: WebSocketMessage = JSON.parse(event.data);
            handleWebSocketMessage(message);
        };
    };

    const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: WebSocketMessageType.HEARTBEAT,
                    timestamp: new Date()
                }));
            }
        }, heartbeatInterval);
    };

    const handleReconnect = () => {
        if (reconnectCount < reconnectAttempts) {
            reconnectCount++;
            console.log(`Reconnecting... Attempt ${reconnectCount}`);
            setTimeout(connect, reconnectInterval * reconnectCount);
        } else {
            console.error('Max reconnection attempts reached');
        }
    };

    const handleWebSocketMessage = (message: WebSocketMessage) => {
        switch (message.type) {
            case WebSocketMessageType.MARKET_DATA:
            case WebSocketMessageType.ORDER_UPDATE:
            case WebSocketMessageType.TRADE_UPDATE:
            case WebSocketMessageType.STRATEGY_UPDATE:
                // Handle specific message types
                break;
            case WebSocketMessageType.ERROR:
                console.error('WebSocket error message:', message.data);
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    };

    connect();
    return ws;
};