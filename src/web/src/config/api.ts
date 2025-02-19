// axios v1.4.0 - Promise based HTTP client
import axios, { AxiosInstance, AxiosError } from 'axios';
// axios-retry v3.5.0 - Axios plugin that intercepts failed requests and retries them
import axiosRetry from 'axios-retry';
// circuit-breaker-js v0.5.0 - Circuit breaker implementation
import CircuitBreaker from 'circuit-breaker-js';

// Internal imports
import { ApiResponse, HttpStatusCode, WebSocketMessageType } from '../types/api';
import { API_ENDPOINTS, ERROR_CODES, ERROR_CATEGORIES } from '../constants/api';

/**
 * API Configuration with environment-specific settings
 */
const API_CONFIG = {
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8080',
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
    retryConfig: {
        retries: 3,
        retryDelay: 1000,
        retryCondition: (error: AxiosError) => {
            const errorCode = error.response?.status;
            return ERROR_CATEGORIES.RETRYABLE.includes(errorCode as number);
        }
    },
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 30000
    }
} as const;

/**
 * WebSocket Configuration for real-time data
 */
const WS_CONFIG = {
    url: process.env.REACT_APP_WS_URL || 'ws://localhost:8080/ws',
    reconnectInterval: 1000,
    maxRetries: 5,
    heartbeatInterval: 30000,
    messageQueueSize: 1000
} as const;

/**
 * Creates and configures an Axios instance with enhanced reliability features
 */
const createApiClient = (): AxiosInstance => {
    const client = axios.create(API_CONFIG);

    // Configure retry mechanism
    axiosRetry(client, {
        retries: API_CONFIG.retryConfig.retries,
        retryDelay: (retryCount) => {
            return retryCount * API_CONFIG.retryConfig.retryDelay;
        },
        retryCondition: API_CONFIG.retryConfig.retryCondition
    });

    // Initialize circuit breaker
    const breaker = new CircuitBreaker({
        failureThreshold: API_CONFIG.circuitBreaker.failureThreshold,
        resetTimeout: API_CONFIG.circuitBreaker.resetTimeout
    });

    // Request interceptor for authentication and metrics
    client.interceptors.request.use(
        (config) => {
            const token = localStorage.getItem('auth_token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            config.metadata = { startTime: Date.now() };
            return config;
        },
        (error) => Promise.reject(error)
    );

    // Response interceptor for error handling and monitoring
    client.interceptors.response.use(
        (response) => {
            const duration = Date.now() - (response.config.metadata?.startTime || 0);
            monitorApiHealth(client, duration, true);
            return response;
        },
        (error) => {
            const duration = Date.now() - (error.config.metadata?.startTime || 0);
            monitorApiHealth(client, duration, false);
            return Promise.reject(error);
        }
    );

    return client;
};

/**
 * Creates and configures a WebSocket connection with reliability features
 */
const createWebSocketClient = (): WebSocket => {
    let reconnectAttempts = 0;
    let messageQueue: any[] = [];
    
    const ws = new WebSocket(WS_CONFIG.url);
    
    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: WebSocketMessageType.HEARTBEAT }));
        }
    }, WS_CONFIG.heartbeatInterval);

    ws.onopen = () => {
        reconnectAttempts = 0;
        // Replay queued messages
        while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            ws.send(JSON.stringify(message));
        }
    };

    ws.onclose = () => {
        if (reconnectAttempts < WS_CONFIG.maxRetries) {
            setTimeout(() => {
                reconnectAttempts++;
                createWebSocketClient();
            }, reconnectAttempts * WS_CONFIG.reconnectInterval);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    return ws;
};

/**
 * Monitors API health and performance metrics
 */
const monitorApiHealth = (client: AxiosInstance, duration: number, success: boolean): void => {
    // Track request latency
    if (window.performance && window.performance.mark) {
        window.performance.mark(`api-request-${Date.now()}`);
    }

    // Monitor error rates and success ratios
    const metrics = {
        latency: duration,
        success: success,
        timestamp: Date.now()
    };

    // Send metrics to monitoring system
    console.debug('API Metrics:', metrics);
};

// Create singleton instances
export const apiClient = createApiClient();
export const wsClient = createWebSocketClient();

// Export configured clients and utilities
export {
    API_CONFIG,
    WS_CONFIG,
    createApiClient,
    createWebSocketClient,
    monitorApiHealth
};