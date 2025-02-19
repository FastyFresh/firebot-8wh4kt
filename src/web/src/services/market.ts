// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// rxjs v7.8.1
import { BehaviorSubject, Observable, timer, from } from 'rxjs';
import { map, switchMap, retryWhen, delay, tap, catchError } from 'rxjs/operators';
// lru-cache v7.14.1
import LRUCache from 'lru-cache';

import { marketApi } from '../api/market';
import { WebSocketManager } from './websocket';
import { MarketData, OrderBook, MarketDepth, Exchange } from '../types/market';
import { ERROR_CODES, ERROR_CATEGORIES } from '../constants/api';

// Cache configuration for market data optimization
const CACHE_CONFIG = {
    marketData: {
        max: 1000,
        ttl: 100, // 100ms TTL for market data
        updateAgeOnGet: true
    },
    orderBook: {
        max: 100,
        ttl: 50, // 50ms TTL for order book
        updateAgeOnGet: true
    }
};

// WebSocket configuration for real-time updates
const WS_CONFIG = {
    reconnectInterval: 1000,
    maxRetries: 3,
    batchSize: 100,
    batchInterval: 50 // 50ms batching interval
};

/**
 * Service class for managing market data operations with optimized performance
 * and comprehensive error handling
 */
export class MarketService {
    private readonly marketDataSubject: BehaviorSubject<Map<string, MarketData>>;
    private readonly orderBookSubject: BehaviorSubject<Map<string, OrderBook>>;
    private readonly marketDataCache: LRUCache<string, MarketData>;
    private readonly orderBookCache: LRUCache<string, OrderBook>;
    private readonly activeSubscriptions: Map<string, { count: number; unsubscribe: () => void }>;

    constructor(private readonly wsManager: WebSocketManager) {
        // Initialize reactive state containers
        this.marketDataSubject = new BehaviorSubject<Map<string, MarketData>>(new Map());
        this.orderBookSubject = new BehaviorSubject<Map<string, OrderBook>>(new Map());

        // Initialize caches with configured settings
        this.marketDataCache = new LRUCache(CACHE_CONFIG.marketData);
        this.orderBookCache = new LRUCache(CACHE_CONFIG.orderBook);
        this.activeSubscriptions = new Map();

        // Initialize error handling and monitoring
        this.setupErrorHandling();
    }

    /**
     * Subscribes to real-time market data updates with batching optimization
     */
    public subscribeToMarketData(
        tradingPair: string,
        exchange: Exchange,
        options: {
            batchUpdates?: boolean;
            updateInterval?: number;
        } = {}
    ): Observable<MarketData> {
        const key = this.getSubscriptionKey(tradingPair, exchange);
        const subscription = this.activeSubscriptions.get(key);

        if (subscription) {
            subscription.count++;
            return this.getMarketDataStream(key);
        }

        const wsSubscription = this.wsManager.subscribe(
            'MARKET_DATA',
            (data: MarketData) => {
                // Update cache and notify subscribers
                this.marketDataCache.set(key, data);
                const currentData = this.marketDataSubject.value;
                currentData.set(key, data);
                this.marketDataSubject.next(currentData);
            },
            {
                batchSize: options.batchUpdates ? WS_CONFIG.batchSize : 1,
                batchInterval: options.updateInterval || WS_CONFIG.batchInterval
            }
        );

        this.activeSubscriptions.set(key, {
            count: 1,
            unsubscribe: wsSubscription
        });

        return this.getMarketDataStream(key);
    }

    /**
     * Subscribes to real-time order book updates with depth analysis
     */
    public subscribeToOrderBook(
        tradingPair: string,
        exchange: Exchange,
        options: {
            depth?: number;
            updateInterval?: number;
        } = {}
    ): Observable<OrderBook> {
        const key = this.getSubscriptionKey(tradingPair, exchange);
        
        return new Observable<OrderBook>(observer => {
            const wsSubscription = this.wsManager.subscribe(
                'ORDER_BOOK',
                async (data: OrderBook) => {
                    try {
                        // Process and validate order book data
                        const processedData = await this.processOrderBookUpdate(data, options.depth);
                        this.orderBookCache.set(key, processedData);
                        
                        const currentBooks = this.orderBookSubject.value;
                        currentBooks.set(key, processedData);
                        this.orderBookSubject.next(currentBooks);
                        
                        observer.next(processedData);
                    } catch (error) {
                        observer.error(error);
                    }
                }
            );

            // Cleanup on unsubscribe
            return () => {
                wsSubscription();
                this.cleanupSubscription(key);
            };
        }).pipe(
            retryWhen(errors =>
                errors.pipe(
                    delay(WS_CONFIG.reconnectInterval),
                    tap(error => console.error('Order book subscription error:', error))
                )
            )
        );
    }

    /**
     * Retrieves market depth snapshot with advanced analysis
     */
    public async getMarketDepthSnapshot(
        tradingPair: string,
        exchange: Exchange,
        options: {
            depth?: number;
            timeout?: number;
        } = {}
    ): Promise<MarketDepth[]> {
        try {
            const depth = await marketApi.getMarketDepth(tradingPair, {
                exchange,
                depth: options.depth,
                timeout: options.timeout
            });

            return this.analyzeMarketDepth(depth);
        } catch (error) {
            if (error.code === ERROR_CODES.RATE_LIMIT_ERROR) {
                throw new Error('Rate limit exceeded for market depth requests');
            }
            throw new Error(`Failed to fetch market depth: ${error.message}`);
        }
    }

    /**
     * Unsubscribes from market data updates
     */
    public unsubscribe(tradingPair: string, exchange: Exchange): void {
        const key = this.getSubscriptionKey(tradingPair, exchange);
        this.cleanupSubscription(key);
    }

    private getMarketDataStream(key: string): Observable<MarketData> {
        return this.marketDataSubject.pipe(
            map(dataMap => dataMap.get(key)!),
            catchError(error => {
                console.error('Market data stream error:', error);
                throw error;
            })
        );
    }

    private async processOrderBookUpdate(
        orderBook: OrderBook,
        depth?: number
    ): Promise<OrderBook> {
        // Sort and trim order book levels
        const processedBook = {
            ...orderBook,
            bids: orderBook.bids
                .sort((a, b) => b.price.minus(a.price).toNumber())
                .slice(0, depth),
            asks: orderBook.asks
                .sort((a, b) => a.price.minus(b.price).toNumber())
                .slice(0, depth)
        };

        return processedBook;
    }

    private analyzeMarketDepth(depth: MarketDepth[]): MarketDepth[] {
        // Calculate cumulative volumes and price impacts
        let cumulativeVolume = new Decimal(0);
        
        return depth.map(level => ({
            ...level,
            totalSize: cumulativeVolume = cumulativeVolume.plus(level.totalSize)
        }));
    }

    private getSubscriptionKey(tradingPair: string, exchange: Exchange): string {
        return `${exchange}:${tradingPair}`;
    }

    private cleanupSubscription(key: string): void {
        const subscription = this.activeSubscriptions.get(key);
        if (subscription) {
            subscription.count--;
            if (subscription.count === 0) {
                subscription.unsubscribe();
                this.activeSubscriptions.delete(key);
            }
        }
    }

    private setupErrorHandling(): void {
        // Monitor WebSocket connection health
        timer(0, 30000).pipe(
            switchMap(() => from(this.wsManager.connect())),
            retryWhen(errors =>
                errors.pipe(
                    delay(WS_CONFIG.reconnectInterval),
                    tap(error => console.error('WebSocket connection error:', error))
                )
            )
        ).subscribe();
    }
}