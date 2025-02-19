// react v18.0.0 - React hooks for state and lifecycle management
import { useState, useEffect, useCallback, useRef } from 'react';

// Internal imports for WebSocket client and types
import { webSocketClient } from '../services/websocket';
import { WebSocketMessage, WebSocketMessageType } from '../types/api';

// Configuration interface for the WebSocket hook
interface WebSocketConfig {
    autoConnect?: boolean;
    reconnectAttempts?: number;
    reconnectInterval?: number;
    messageValidation?: boolean;
    batchMessages?: boolean;
    healthCheckInterval?: number;
}

// WebSocket connection state interface
interface WebSocketState {
    isConnected: boolean;
    isLoading: boolean;
    error: WebSocketError | null;
    lastMessage: WebSocketMessage | null;
    connectionHealth: ConnectionHealth;
}

// WebSocket error interface with detailed information
interface WebSocketError {
    code: number;
    message: string;
    timestamp: Date;
    retryable: boolean;
}

// Connection health monitoring interface
interface ConnectionHealth {
    latency: number;
    messageRate: number;
    lastHeartbeat: Date | null;
}

// Default configuration values
const DEFAULT_CONFIG: Required<WebSocketConfig> = {
    autoConnect: true,
    reconnectAttempts: 5,
    reconnectInterval: 1000,
    messageValidation: true,
    batchMessages: true,
    healthCheckInterval: 30000,
};

/**
 * Enhanced WebSocket hook for managing real-time connections in the trading dashboard
 * Features automatic reconnection, message validation, and health monitoring
 */
export const useWebSocket = (config: WebSocketConfig = {}) => {
    // Merge provided config with defaults
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    // Connection state management
    const [state, setState] = useState<WebSocketState>({
        isConnected: false,
        isLoading: false,
        error: null,
        lastMessage: null,
        connectionHealth: {
            latency: 0,
            messageRate: 0,
            lastHeartbeat: null,
        },
    });

    // Refs for managing reconnection and message handling
    const reconnectAttempts = useRef(0);
    const reconnectTimeout = useRef<NodeJS.Timeout>();
    const healthCheckInterval = useRef<NodeJS.Timeout>();
    const messageCache = useRef(new Map<string, WebSocketMessage>());
    const subscriptions = useRef(new Map<WebSocketMessageType, Set<Function>>());

    /**
     * Establishes WebSocket connection with automatic reconnection
     */
    const connect = useCallback(async () => {
        if (state.isConnected || state.isLoading) return;

        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            await webSocketClient.connect();
            
            reconnectAttempts.current = 0;
            setState(prev => ({
                ...prev,
                isConnected: true,
                isLoading: false,
                error: null,
            }));

            // Initialize health monitoring
            startHealthCheck();
        } catch (error) {
            const wsError: WebSocketError = {
                code: error.code || 500,
                message: error.message || 'Connection failed',
                timestamp: new Date(),
                retryable: reconnectAttempts.current < finalConfig.reconnectAttempts,
            };

            setState(prev => ({
                ...prev,
                isLoading: false,
                error: wsError,
            }));

            // Attempt reconnection if within retry limits
            if (wsError.retryable) {
                const delay = Math.min(
                    finalConfig.reconnectInterval * Math.pow(1.5, reconnectAttempts.current),
                    30000
                );
                reconnectTimeout.current = setTimeout(() => {
                    reconnectAttempts.current++;
                    connect();
                }, delay);
            }
        }
    }, [finalConfig.reconnectAttempts, finalConfig.reconnectInterval, state.isConnected, state.isLoading]);

    /**
     * Gracefully closes WebSocket connection with cleanup
     */
    const disconnect = useCallback(async () => {
        // Clear all intervals and timeouts
        if (healthCheckInterval.current) {
            clearInterval(healthCheckInterval.current);
        }
        if (reconnectTimeout.current) {
            clearTimeout(reconnectTimeout.current);
        }

        // Clear message cache and subscriptions
        messageCache.current.clear();
        subscriptions.current.clear();

        // Disconnect WebSocket client
        await webSocketClient.disconnect();

        setState(prev => ({
            ...prev,
            isConnected: false,
            isLoading: false,
            error: null,
            lastMessage: null,
        }));
    }, []);

    /**
     * Subscribes to specific WebSocket message types with validation
     */
    const subscribe = useCallback(<T>(
        messageType: WebSocketMessageType,
        handler: (data: T) => void,
        options: { batch?: boolean; validate?: boolean } = {}
    ) => {
        if (!subscriptions.current.has(messageType)) {
            subscriptions.current.set(messageType, new Set());
        }

        const handlers = subscriptions.current.get(messageType)!;
        const wrappedHandler = async (message: WebSocketMessage<T>) => {
            // Message validation
            if (options.validate && finalConfig.messageValidation) {
                if (!message.timestamp || !message.type || message.type !== messageType) {
                    console.error('Invalid message format:', message);
                    return;
                }
            }

            // Message deduplication
            const messageId = `${message.type}-${message.timestamp}`;
            if (messageCache.current.has(messageId)) {
                return;
            }
            messageCache.current.set(messageId, message);

            // Handle message
            try {
                await handler(message.data);
                setState(prev => ({ ...prev, lastMessage: message }));
            } catch (error) {
                console.error('Error handling message:', error);
            }
        };

        handlers.add(wrappedHandler);

        // Return unsubscribe function
        return () => {
            handlers.delete(wrappedHandler);
            if (handlers.size === 0) {
                subscriptions.current.delete(messageType);
            }
        };
    }, [finalConfig.messageValidation]);

    /**
     * Initializes health monitoring for the WebSocket connection
     */
    const startHealthCheck = useCallback(() => {
        if (healthCheckInterval.current) {
            clearInterval(healthCheckInterval.current);
        }

        healthCheckInterval.current = setInterval(async () => {
            try {
                const health = await webSocketClient.getConnectionHealth();
                setState(prev => ({
                    ...prev,
                    connectionHealth: {
                        latency: health.latency,
                        messageRate: health.messageRate,
                        lastHeartbeat: new Date(),
                    },
                }));
            } catch (error) {
                console.error('Health check failed:', error);
            }
        }, finalConfig.healthCheckInterval);
    }, [finalConfig.healthCheckInterval]);

    // Auto-connect on mount if enabled
    useEffect(() => {
        if (finalConfig.autoConnect) {
            connect();
        }

        // Cleanup on unmount
        return () => {
            disconnect();
        };
    }, [connect, disconnect, finalConfig.autoConnect]);

    return {
        ...state,
        connect,
        disconnect,
        subscribe,
    };
};