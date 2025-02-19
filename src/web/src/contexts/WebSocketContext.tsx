// react v18.0.0 - React core for context creation and hooks
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
// lodash v4.17.21 - Utility functions for performance optimization
import { debounce } from 'lodash';
// react-error-boundary v4.0.11 - Error handling for WebSocket failures
import { ErrorBoundary, useErrorHandler } from 'react-error-boundary';

// Internal imports
import { webSocketClient } from '../services/websocket';
import { WebSocketMessage } from '../types/api';

// Enhanced WebSocket error interface
interface WebSocketError {
    code: number;
    message: string;
    timestamp: Date;
    retryable: boolean;
}

// Enhanced WebSocket context value interface
interface WebSocketContextValue {
    isConnected: boolean;
    isReconnecting: boolean;
    lastMessage: WebSocketMessage | null;
    lastError: WebSocketError | null;
    messageQueueSize: number;
    reconnectAttempts: number;
    subscribe: <T>(channel: string, handler: (data: T) => void, options?: SubscriptionOptions) => () => void;
    unsubscribe: (channel: string) => void;
    clearError: () => void;
    forceReconnect: () => Promise<void>;
}

// Subscription options interface
interface SubscriptionOptions {
    batch?: boolean;
    debounceMs?: number;
    errorHandler?: (error: WebSocketError) => void;
}

// Create WebSocket context with null check
const WebSocketContext = createContext<WebSocketContextValue | null>(null);

// Enhanced WebSocket provider component
export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
    const [lastError, setLastError] = useState<WebSocketError | null>(null);
    const [messageQueueSize, setMessageQueueSize] = useState(0);
    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    
    const handleError = useErrorHandler();
    const subscriptionsRef = useRef<Map<string, Set<Function>>>(new Map());

    // Initialize WebSocket connection
    useEffect(() => {
        const initializeWebSocket = async () => {
            try {
                await webSocketClient.connect();
                setIsConnected(true);
                setReconnectAttempts(0);
            } catch (error) {
                const wsError: WebSocketError = {
                    code: 1000,
                    message: error instanceof Error ? error.message : 'WebSocket connection failed',
                    timestamp: new Date(),
                    retryable: true
                };
                setLastError(wsError);
                handleError(wsError);
            }
        };

        initializeWebSocket();

        return () => {
            webSocketClient.disconnect();
        };
    }, [handleError]);

    // Enhanced subscription handler with debouncing support
    const subscribe = useCallback(<T,>(
        channel: string,
        handler: (data: T) => void,
        options: SubscriptionOptions = {}
    ) => {
        const { batch = false, debounceMs, errorHandler } = options;

        // Create debounced handler if specified
        const processedHandler = debounceMs
            ? debounce(handler, debounceMs)
            : handler;

        // Register subscription with WebSocket client
        const unsubscribe = webSocketClient.subscribe(
            channel,
            async (data: T) => {
                try {
                    await processedHandler(data);
                } catch (error) {
                    const wsError: WebSocketError = {
                        code: 1001,
                        message: error instanceof Error ? error.message : 'Handler execution failed',
                        timestamp: new Date(),
                        retryable: false
                    };
                    setLastError(wsError);
                    errorHandler?.(wsError);
                }
            },
            { batch }
        );

        // Store subscription for cleanup
        if (!subscriptionsRef.current.has(channel)) {
            subscriptionsRef.current.set(channel, new Set());
        }
        subscriptionsRef.current.get(channel)?.add(processedHandler);

        return unsubscribe;
    }, []);

    // Unsubscribe handler
    const unsubscribe = useCallback((channel: string) => {
        const handlers = subscriptionsRef.current.get(channel);
        if (handlers) {
            handlers.clear();
            subscriptionsRef.current.delete(channel);
        }
    }, []);

    // Error clearing handler
    const clearError = useCallback(() => {
        setLastError(null);
    }, []);

    // Force reconnection handler
    const forceReconnect = useCallback(async () => {
        setIsReconnecting(true);
        setReconnectAttempts(prev => prev + 1);
        
        try {
            await webSocketClient.disconnect();
            await webSocketClient.connect();
            setIsConnected(true);
            setIsReconnecting(false);
        } catch (error) {
            const wsError: WebSocketError = {
                code: 1002,
                message: error instanceof Error ? error.message : 'Reconnection failed',
                timestamp: new Date(),
                retryable: true
            };
            setLastError(wsError);
            setIsReconnecting(false);
            handleError(wsError);
        }
    }, [handleError]);

    const contextValue: WebSocketContextValue = {
        isConnected,
        isReconnecting,
        lastMessage,
        lastError,
        messageQueueSize,
        reconnectAttempts,
        subscribe,
        unsubscribe,
        clearError,
        forceReconnect
    };

    return (
        <ErrorBoundary
            fallback={<div>WebSocket Error. Please refresh the page.</div>}
            onError={(error) => {
                setLastError({
                    code: 1003,
                    message: error.message,
                    timestamp: new Date(),
                    retryable: true
                });
            }}
        >
            <WebSocketContext.Provider value={contextValue}>
                {children}
            </WebSocketContext.Provider>
        </ErrorBoundary>
    );
};

// Enhanced WebSocket context hook with error handling
export const useWebSocketContext = () => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocketContext must be used within a WebSocketProvider');
    }
    return context;
};

// Enhanced WebSocket subscription hook
export const useWebSocketSubscription = <T,>(
    channel: string,
    handler: (data: T) => void,
    options: SubscriptionOptions = {}
) => {
    const { subscribe, unsubscribe } = useWebSocketContext();

    useEffect(() => {
        const unsubscribeHandler = subscribe<T>(channel, handler, options);
        return () => {
            unsubscribeHandler();
            unsubscribe(channel);
        };
    }, [channel, handler, options, subscribe, unsubscribe]);

    return true;
};