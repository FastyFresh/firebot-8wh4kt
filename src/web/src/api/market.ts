// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// retry-ts v1.0.0
import { retry } from 'retry-ts';
// ws v8.13.0
import WebSocket from 'ws';

import { apiClient } from '../config/api';
import { MarketData, OrderBook, OrderBookLevel, Exchange } from '../types/market';
import { API_ENDPOINTS, ERROR_CODES, ERROR_CATEGORIES } from '../constants/api';
import { ApiResponse, WebSocketMessageType } from '../types/api';

// Cache TTL constants
const MARKET_DATA_CACHE_TTL = 100; // milliseconds
const ORDER_BOOK_CACHE_TTL = 50; // milliseconds

// WebSocket configuration
const WS_RECONNECT_DELAY = 1000;
const WS_MAX_RETRIES = 3;

// Validation constants
const TRADING_PAIR_REGEX = /^[A-Z0-9]+\/[A-Z0-9]+$/;
const MAX_BATCH_SIZE = 50;
const REQUEST_TIMEOUT = 5000;

// Local cache implementation
const cache = new Map<string, { data: any; timestamp: number }>();

/**
 * Retrieves current market data for specified trading pairs with batching and concurrent requests
 */
export async function getMarketData(
    tradingPairs: string[],
    options: {
        pageSize?: number;
        timeout?: number;
        maxRetries?: number;
    } = {}
): Promise<MarketData[]> {
    // Validate trading pairs
    const validPairs = tradingPairs.filter(pair => TRADING_PAIR_REGEX.test(pair));
    if (validPairs.length === 0) {
        throw new Error(`Invalid trading pairs format. Expected format: BASE/QUOTE`);
    }

    const {
        pageSize = MAX_BATCH_SIZE,
        timeout = REQUEST_TIMEOUT,
        maxRetries = WS_MAX_RETRIES
    } = options;

    // Check cache first
    const cachedData = getCachedMarketData(validPairs);
    if (cachedData.length === validPairs.length) {
        return cachedData;
    }

    // Split into batches for concurrent requests
    const batches = chunk(validPairs, pageSize);
    
    try {
        const results = await Promise.all(
            batches.map(batch =>
                retry(
                    async () => {
                        const response = await apiClient.get<ApiResponse<MarketData[]>>(
                            API_ENDPOINTS.MARKET.PRICE,
                            {
                                params: { pairs: batch.join(',') },
                                timeout
                            }
                        );
                        return response.data.data || [];
                    },
                    {
                        retries: maxRetries,
                        factor: 2,
                        minTimeout: 1000,
                        maxTimeout: 5000,
                        randomize: true,
                        onRetry: (error) => {
                            console.warn(`Market data retry for ${batch.join(',')}: ${error.message}`);
                        }
                    }
                )
            )
        );

        // Process and normalize results
        const marketData = results
            .flat()
            .map(normalizeMarketData)
            .filter(Boolean) as MarketData[];

        // Update cache
        marketData.forEach(data => {
            cache.set(
                getCacheKey('market', data.tradingPair),
                { data, timestamp: Date.now() }
            );
        });

        return marketData;
    } catch (error) {
        if (error.code === ERROR_CODES.RATE_LIMIT_ERROR) {
            throw new Error(`Rate limit exceeded. Please try again later.`);
        }
        throw new Error(`Failed to fetch market data: ${error.message}`);
    }
}

/**
 * Establishes WebSocket connection for real-time market updates with automatic recovery
 */
export async function subscribeToMarketData(
    tradingPairs: string[],
    onUpdate: (data: MarketData) => void,
    options: {
        reconnectInterval?: number;
        maxRetries?: number;
    } = {}
): Promise<{ unsubscribe: () => void }> {
    const {
        reconnectInterval = WS_RECONNECT_DELAY,
        maxRetries = WS_MAX_RETRIES
    } = options;

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let messageQueue: MarketData[] = [];
    let connected = false;

    const connect = () => {
        ws = new WebSocket(API_ENDPOINTS.MARKET.PRICE.replace('http', 'ws'));

        ws.onopen = () => {
            connected = true;
            reconnectAttempts = 0;
            
            // Subscribe to trading pairs
            ws.send(JSON.stringify({
                type: WebSocketMessageType.MARKET_DATA,
                pairs: tradingPairs
            }));

            // Process queued messages
            while (messageQueue.length > 0) {
                const data = messageQueue.shift();
                onUpdate(data!);
            }
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data.toString());
                if (message.type === WebSocketMessageType.MARKET_DATA) {
                    const marketData = normalizeMarketData(message.data);
                    if (marketData) {
                        if (connected) {
                            onUpdate(marketData);
                        } else {
                            messageQueue.push(marketData);
                        }
                    }
                }
            } catch (error) {
                console.error('WebSocket message parsing error:', error);
            }
        };

        ws.onclose = () => {
            connected = false;
            if (reconnectAttempts < maxRetries) {
                setTimeout(() => {
                    reconnectAttempts++;
                    connect();
                }, reconnectAttempts * reconnectInterval);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            ws?.close();
        };
    };

    connect();

    return {
        unsubscribe: () => {
            connected = false;
            if (ws) {
                ws.close();
                ws = null;
            }
        }
    };
}

/**
 * Retrieves current order book for a trading pair with depth management
 */
export async function getOrderBook(
    tradingPair: string,
    options: {
        depth?: number;
        timeout?: number;
        maxRetries?: number;
    } = {}
): Promise<OrderBook> {
    if (!TRADING_PAIR_REGEX.test(tradingPair)) {
        throw new Error(`Invalid trading pair format: ${tradingPair}`);
    }

    const {
        depth = 100,
        timeout = REQUEST_TIMEOUT,
        maxRetries = WS_MAX_RETRIES
    } = options;

    // Check cache
    const cacheKey = getCacheKey('orderbook', tradingPair);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ORDER_BOOK_CACHE_TTL) {
        return cached.data as OrderBook;
    }

    try {
        const response = await retry(
            async () => {
                return await apiClient.get<ApiResponse<OrderBook>>(
                    API_ENDPOINTS.MARKET.ORDERBOOK,
                    {
                        params: { pair: tradingPair, depth },
                        timeout
                    }
                );
            },
            {
                retries: maxRetries,
                factor: 2,
                minTimeout: 1000,
                maxTimeout: 5000
            }
        );

        const orderBook = normalizeOrderBook(response.data.data!);

        // Update cache
        cache.set(cacheKey, { data: orderBook, timestamp: Date.now() });

        return orderBook;
    } catch (error) {
        throw new Error(`Failed to fetch order book: ${error.message}`);
    }
}

// Helper functions
function normalizeMarketData(data: any): MarketData | null {
    if (!data || !data.tradingPair || !data.price) return null;
    
    return {
        id: data.id,
        tradingPair: data.tradingPair,
        exchange: data.exchange as Exchange,
        price: new Decimal(data.price),
        volume: new Decimal(data.volume || 0),
        timestamp: new Date(data.timestamp)
    };
}

function normalizeOrderBook(data: any): OrderBook {
    return {
        tradingPair: data.tradingPair,
        exchange: data.exchange as Exchange,
        bids: data.bids.map(normalizeOrderBookLevel),
        asks: data.asks.map(normalizeOrderBookLevel),
        timestamp: new Date(data.timestamp)
    };
}

function normalizeOrderBookLevel(level: any): OrderBookLevel {
    return {
        price: new Decimal(level.price),
        size: new Decimal(level.size)
    };
}

function getCacheKey(type: string, key: string): string {
    return `${type}:${key}`;
}

function chunk<T>(array: T[], size: number): T[][] {
    return Array.from(
        { length: Math.ceil(array.length / size) },
        (_, index) => array.slice(index * size, (index + 1) * size)
    );
}