// reconnecting-websocket v4.4.0 - Reliable WebSocket client with automatic reconnection
import ReconnectingWebSocket from 'reconnecting-websocket';
// opossum v6.0.0 - Circuit breaker for handling connection failures
import CircuitBreaker from 'opossum';
// @monitoring/metrics-collector v1.0.0 - Performance and error metrics collection
import { MetricsCollector } from '@monitoring/metrics-collector';

import { WebSocketMessage, WebSocketMessageType } from '../types/api';
import { WS_CONFIG } from '../config/api';

// Global instances
let wsInstance: null | ReconnectingWebSocket = null;
const messageHandlers = new Map<WebSocketMessageType, ((data: unknown) => void)[]>();
const messageQueue = new Array<WebSocketMessage>();
const metricsCollector = new MetricsCollector('websocket');

// Circuit breaker configuration
const circuitBreaker = new CircuitBreaker(async (message: WebSocketMessage) => {
    if (!wsInstance || wsInstance.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
    }
    wsInstance.send(JSON.stringify(message));
}, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
});

/**
 * Creates and initializes a WebSocket client with enhanced reliability features
 */
export const createWebSocketClient = (): ReconnectingWebSocket => {
    if (wsInstance) {
        return wsInstance;
    }

    // Initialize WebSocket with reconnection options
    wsInstance = new ReconnectingWebSocket(WS_CONFIG.url, [], {
        maxRetries: WS_CONFIG.maxRetries,
        reconnectionDelayGrowFactor: 1.5,
        maxReconnectionDelay: 5000,
        minReconnectionDelay: WS_CONFIG.reconnectInterval
    });

    // Connection lifecycle handlers
    wsInstance.addEventListener('open', () => {
        metricsCollector.incrementCounter('websocket_connections');
        processMessageQueue();
    });

    wsInstance.addEventListener('close', () => {
        metricsCollector.incrementCounter('websocket_disconnections');
    });

    wsInstance.addEventListener('error', (error) => {
        metricsCollector.incrementCounter('websocket_errors');
        console.error('WebSocket error:', error);
    });

    // Message handling
    wsInstance.addEventListener('message', handleWebSocketMessage);

    return wsInstance;
};

/**
 * Enhanced message processor with validation and error handling
 */
const handleWebSocketMessage = async (event: MessageEvent): Promise<void> => {
    const startTime = performance.now();

    try {
        // Parse and validate message
        const message = JSON.parse(event.data) as WebSocketMessage;
        
        if (!message.type || !Object.values(WebSocketMessageType).includes(message.type)) {
            throw new Error('Invalid message type');
        }

        // Get registered handlers for message type
        const handlers = messageHandlers.get(message.type) || [];
        
        // Execute handlers with performance tracking
        await Promise.all(handlers.map(async (handler) => {
            try {
                await handler(message.data);
            } catch (error) {
                metricsCollector.incrementCounter('handler_errors');
                console.error(`Handler error for ${message.type}:`, error);
            }
        }));

        // Record successful processing
        const processingTime = performance.now() - startTime;
        metricsCollector.recordTiming('message_processing', processingTime);

    } catch (error) {
        metricsCollector.incrementCounter('message_errors');
        console.error('Message processing error:', error);
    }
};

/**
 * Processes queued messages after reconnection
 */
const processMessageQueue = async (): Promise<void> => {
    while (messageQueue.length > 0 && wsInstance?.readyState === WebSocket.OPEN) {
        const message = messageQueue.shift();
        if (message) {
            try {
                await circuitBreaker.fire(message);
            } catch (error) {
                metricsCollector.incrementCounter('queue_processing_errors');
                console.error('Queue processing error:', error);
            }
        }
    }
};

/**
 * Subscribes to market data updates with reliability features
 */
export const subscribeToMarketData = (handler: (data: unknown) => void): void => {
    const handlers = messageHandlers.get(WebSocketMessageType.MARKET_DATA) || [];
    messageHandlers.set(WebSocketMessageType.MARKET_DATA, [...handlers, handler]);
};

/**
 * Subscribes to order updates with reliability features
 */
export const subscribeToOrderUpdates = (handler: (data: unknown) => void): void => {
    const handlers = messageHandlers.get(WebSocketMessageType.ORDER_UPDATE) || [];
    messageHandlers.set(WebSocketMessageType.ORDER_UPDATE, [...handlers, handler]);
};

/**
 * Adds message handler with validation
 */
export const addMessageHandler = (type: WebSocketMessageType, handler: (data: unknown) => void): void => {
    const handlers = messageHandlers.get(type) || [];
    messageHandlers.set(type, [...handlers, handler]);
};

/**
 * Clean connection termination with resource cleanup
 */
export const disconnect = (): void => {
    if (wsInstance) {
        wsInstance.close();
        wsInstance = null;
        messageHandlers.clear();
        messageQueue.length = 0;
        metricsCollector.incrementCounter('websocket_disconnections');
    }
};