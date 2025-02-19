import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import rax from 'retry-axios';
import CircuitBreaker from 'circuit-breaker-js';
import { ApiResponse, WebSocketMessageType, HttpStatusCode, ApiError } from '../types/api';
import { API_ENDPOINTS, API_RATE_LIMITS, ERROR_CODES, ERROR_CATEGORIES } from '../constants/api';

// API configuration constants
const API_CONFIG = {
    baseURL: process.env.REACT_APP_API_BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': process.env.REACT_APP_VERSION
    }
} as const;

// WebSocket configuration
const WS_CONFIG = {
    reconnectInterval: 1000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 30000
} as const;

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
    windowDuration: 60000,
    numBuckets: 10,
    timeoutDuration: 30000,
    errorThreshold: 50,
    volumeThreshold: 10
} as const;

/**
 * Enhanced API service class with reliability features
 */
class ApiService {
    private readonly httpClient: AxiosInstance;
    private readonly wsClient: WebSocket | null = null;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly messageQueue: Map<string, Function[]>;
    private reconnectAttempts = 0;

    constructor() {
        this.circuitBreaker = this.initializeCircuitBreaker();
        this.httpClient = this.createHttpClient();
        this.messageQueue = new Map();
        this.initializeWebSocket();
    }

    /**
     * Initialize circuit breaker with configured settings
     */
    private initializeCircuitBreaker(): CircuitBreaker {
        return new CircuitBreaker({
            windowDuration: CIRCUIT_BREAKER_CONFIG.windowDuration,
            numBuckets: CIRCUIT_BREAKER_CONFIG.numBuckets,
            timeoutDuration: CIRCUIT_BREAKER_CONFIG.timeoutDuration,
            errorThreshold: CIRCUIT_BREAKER_CONFIG.errorThreshold,
            volumeThreshold: CIRCUIT_BREAKER_CONFIG.volumeThreshold,
            onCircuitOpen: (metrics) => {
                console.error('Circuit breaker opened', metrics);
                // Implement circuit breaker metrics tracking
            }
        });
    }

    /**
     * Create and configure HTTP client with enhanced features
     */
    private createHttpClient(): AxiosInstance {
        const client = axios.create(API_CONFIG);

        // Configure retry-axios
        const raxConfig = {
            retry: 3,
            noResponseRetries: 2,
            retryDelay: this.getExponentialBackoff,
            httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS'],
            statusCodesToRetry: [[408, 429, 500, 502, 503, 504]]
        };

        client.defaults.raxConfig = raxConfig;
        rax.attach(client);

        // Request interceptor
        client.interceptors.request.use(
            (config) => {
                const token = localStorage.getItem('auth_token');
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
                return config;
            },
            (error) => Promise.reject(error)
        );

        // Response interceptor
        client.interceptors.response.use(
            (response) => response,
            (error) => this.handleApiError(error)
        );

        return client;
    }

    /**
     * Initialize WebSocket connection with reliability features
     */
    private initializeWebSocket(): void {
        if (!process.env.REACT_APP_WS_URL) return;

        this.wsClient = new WebSocket(process.env.REACT_APP_WS_URL);
        
        this.wsClient.onopen = () => {
            this.reconnectAttempts = 0;
            this.processMessageQueue();
            this.startHeartbeat();
        };

        this.wsClient.onclose = () => {
            this.handleWebSocketClose();
        };

        this.wsClient.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.handleWebSocketError(error);
        };

        this.wsClient.onmessage = (event) => {
            this.handleWebSocketMessage(event);
        };
    }

    /**
     * Make HTTP request with enhanced error handling and reliability
     */
    public async request<T>(
        method: string,
        url: string,
        data?: unknown,
        config?: AxiosRequestConfig
    ): Promise<ApiResponse<T>> {
        return this.circuitBreaker.run(async () => {
            try {
                const response = await this.httpClient.request({
                    method,
                    url,
                    data,
                    ...config
                });
                return response.data;
            } catch (error) {
                throw await this.handleApiError(error);
            }
        });
    }

    /**
     * Subscribe to WebSocket updates with reliability features
     */
    public subscribe(messageType: WebSocketMessageType, callback: Function): void {
        if (!this.wsClient) {
            this.queueMessage(messageType, callback);
            return;
        }

        if (this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(JSON.stringify({ type: messageType }));
            this.messageQueue.set(messageType, [...(this.messageQueue.get(messageType) || []), callback]);
        } else {
            this.queueMessage(messageType, callback);
        }
    }

    /**
     * Enhanced error handling with detailed categorization
     */
    private async handleApiError(error: AxiosError): Promise<ApiError> {
        const errorResponse: ApiError = {
            code: error.response?.status || HttpStatusCode.INTERNAL_SERVER_ERROR,
            message: error.message,
            details: error.response?.data || {},
            retryAfter: null,
            errorId: Date.now().toString()
        };

        if (ERROR_CATEGORIES.RETRYABLE.includes(errorResponse.code)) {
            errorResponse.retryAfter = this.calculateRetryAfter(error);
        }

        // Log error with context
        console.error('API Error:', {
            ...errorResponse,
            stack: error.stack,
            config: error.config
        });

        return errorResponse;
    }

    /**
     * Calculate retry delay using exponential backoff
     */
    private getExponentialBackoff(retryCount: number): number {
        return Math.min(1000 * Math.pow(2, retryCount), 30000);
    }

    /**
     * Process queued messages after reconnection
     */
    private processMessageQueue(): void {
        this.messageQueue.forEach((callbacks, messageType) => {
            callbacks.forEach(callback => {
                this.subscribe(messageType as WebSocketMessageType, callback);
            });
        });
    }

    /**
     * Handle WebSocket connection close
     */
    private handleWebSocketClose(): void {
        if (this.reconnectAttempts < WS_CONFIG.maxReconnectAttempts) {
            setTimeout(() => {
                this.reconnectAttempts++;
                this.initializeWebSocket();
            }, this.getExponentialBackoff(this.reconnectAttempts));
        }
    }

    /**
     * Queue message for later processing
     */
    private queueMessage(messageType: WebSocketMessageType, callback: Function): void {
        const callbacks = this.messageQueue.get(messageType) || [];
        this.messageQueue.set(messageType, [...callbacks, callback]);
    }

    /**
     * Start WebSocket heartbeat mechanism
     */
    private startHeartbeat(): void {
        setInterval(() => {
            if (this.wsClient?.readyState === WebSocket.OPEN) {
                this.wsClient.send(JSON.stringify({ type: WebSocketMessageType.HEARTBEAT }));
            }
        }, WS_CONFIG.heartbeatInterval);
    }

    /**
     * Calculate retry after period based on error type
     */
    private calculateRetryAfter(error: AxiosError): number {
        if (error.response?.status === HttpStatusCode.TOO_MANY_REQUESTS) {
            return parseInt(error.response.headers['retry-after'] || '60', 10);
        }
        return this.getExponentialBackoff(this.reconnectAttempts);
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleWebSocketMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data);
            const callbacks = this.messageQueue.get(message.type) || [];
            callbacks.forEach(callback => callback(message.data));
        } catch (error) {
            console.error('WebSocket message handling error:', error);
        }
    }

    /**
     * Handle WebSocket errors
     */
    private handleWebSocketError(error: Event): void {
        console.error('WebSocket error:', error);
        if (this.wsClient) {
            this.wsClient.close();
        }
    }
}

// Export singleton instance
export const apiService = new ApiService();