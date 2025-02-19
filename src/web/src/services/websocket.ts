// reconnecting-websocket v4.4.0 - Enterprise-grade WebSocket client with automatic reconnection
import ReconnectingWebSocket from 'reconnecting-websocket';
// ws-compression v1.0.0 - Message compression for optimized network usage
import { compress, decompress } from 'ws-compression';
// winston v3.8.2 - Logging utility for WebSocket events and errors
import winston from 'winston';

// Internal imports
import { WebSocketMessage, WebSocketMessageType } from '../types/api';
import { WS_MESSAGE_TYPES } from '../constants/api';

// WebSocket configuration with environment-specific settings
const WS_CONFIG = {
    url: process.env.REACT_APP_WS_URL || 'wss://api.trading-bot.com/ws/v1',
    reconnectInterval: 1000,
    maxRetries: 5,
    connectionTimeout: 5000,
    batchSize: 100,
    batchInterval: 100,
    compressionLevel: 'BEST_SPEED',
    debug: process.env.NODE_ENV === 'development'
};

// Configure Winston logger for WebSocket events
const logger = winston.createLogger({
    level: WS_CONFIG.debug ? 'debug' : 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'websocket.log' })
    ]
});

/**
 * Enterprise-grade WebSocket client with comprehensive connection management,
 * message handling, and error recovery
 */
class WebSocketClient {
    private ws: ReconnectingWebSocket;
    private messageHandlers: Map<WebSocketMessageType, Set<Function>>;
    private isConnected: boolean;
    private retryCount: number;
    private messageQueue: WebSocketMessage[];
    private batchTimeout: NodeJS.Timeout | null;
    private metrics: {
        messagesSent: number;
        messagesReceived: number;
        errors: number;
        reconnections: number;
    };

    constructor() {
        this.messageHandlers = new Map();
        this.isConnected = false;
        this.retryCount = 0;
        this.messageQueue = [];
        this.batchTimeout = null;
        this.metrics = {
            messagesSent: 0,
            messagesReceived: 0,
            errors: 0,
            reconnections: 0
        };

        // Initialize WebSocket with enhanced configuration
        this.ws = new ReconnectingWebSocket(WS_CONFIG.url, [], {
            maxRetries: WS_CONFIG.maxRetries,
            reconnectionDelayGrowFactor: 1.5,
            maxReconnectionDelay: 5000,
            minReconnectionDelay: WS_CONFIG.reconnectInterval,
            connectionTimeout: WS_CONFIG.connectionTimeout
        });

        this.setupEventHandlers();
    }

    /**
     * Establishes WebSocket connection with comprehensive error handling
     */
    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, WS_CONFIG.connectionTimeout);

            this.ws.addEventListener('open', () => {
                clearTimeout(timeout);
                this.isConnected = true;
                this.retryCount = 0;
                logger.info('WebSocket connection established');
                resolve();
            });

            this.ws.addEventListener('error', (error) => {
                clearTimeout(timeout);
                this.metrics.errors++;
                logger.error('WebSocket connection error', { error });
                reject(error);
            });
        });
    }

    /**
     * Gracefully closes WebSocket connection with cleanup
     */
    public async disconnect(): Promise<void> {
        this.isConnected = false;
        this.clearMessageQueue();
        this.messageHandlers.clear();
        await this.ws.close();
        logger.info('WebSocket connection closed');
    }

    /**
     * Subscribes to message types with validation and error handling
     */
    public subscribe<T>(
        messageType: WebSocketMessageType,
        handler: (data: T) => void,
        options: { batch?: boolean } = {}
    ): () => void {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, new Set());
        }

        const handlers = this.messageHandlers.get(messageType)!;
        handlers.add(handler);

        logger.debug('Subscribed to message type', { messageType });

        // Return unsubscribe function
        return () => {
            handlers.delete(handler);
            logger.debug('Unsubscribed from message type', { messageType });
        };
    }

    private setupEventHandlers(): void {
        this.ws.addEventListener('message', async (event) => {
            try {
                const message = JSON.parse(event.data) as WebSocketMessage;
                this.metrics.messagesReceived++;

                // Decompress message if needed
                const decompressedData = await decompress(message.data);
                message.data = decompressedData;

                await this.handleMessage(message);
            } catch (error) {
                this.metrics.errors++;
                logger.error('Error processing message', { error });
            }
        });

        this.ws.addEventListener('close', () => {
            this.isConnected = false;
            this.metrics.reconnections++;
            logger.warn('WebSocket connection closed, attempting reconnection');
        });

        this.ws.addEventListener('error', (error) => {
            this.metrics.errors++;
            logger.error('WebSocket error', { error });
        });
    }

    private async handleMessage(message: WebSocketMessage): Promise<void> {
        const handlers = this.messageHandlers.get(message.type);
        
        if (!handlers) {
            return;
        }

        // Add message to batch queue if batching is enabled
        if (this.shouldBatchMessage(message.type)) {
            this.messageQueue.push(message);
            this.scheduleBatchProcessing();
            return;
        }

        // Process message immediately if batching is disabled
        for (const handler of handlers) {
            try {
                await handler(message.data);
            } catch (error) {
                logger.error('Error in message handler', { error, messageType: message.type });
            }
        }
    }

    private shouldBatchMessage(messageType: WebSocketMessageType): boolean {
        return messageType === WS_MESSAGE_TYPES.MARKET_DATA;
    }

    private scheduleBatchProcessing(): void {
        if (this.batchTimeout) {
            return;
        }

        this.batchTimeout = setTimeout(() => {
            this.processBatch();
        }, WS_CONFIG.batchInterval);
    }

    private async processBatch(): Promise<void> {
        if (this.messageQueue.length === 0) {
            this.batchTimeout = null;
            return;
        }

        const batch = this.messageQueue.splice(0, WS_CONFIG.batchSize);
        const handlers = this.messageHandlers.get(WS_MESSAGE_TYPES.MARKET_DATA);

        if (handlers) {
            for (const handler of handlers) {
                try {
                    await handler(batch.map(message => message.data));
                } catch (error) {
                    logger.error('Error processing batch', { error });
                }
            }
        }

        this.batchTimeout = null;

        // Schedule next batch if there are remaining messages
        if (this.messageQueue.length > 0) {
            this.scheduleBatchProcessing();
        }
    }

    private clearMessageQueue(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        this.messageQueue = [];
    }
}

// Export singleton instance
export const webSocketClient = new WebSocketClient();