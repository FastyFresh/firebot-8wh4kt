// react v18.0.0
import { useState, useEffect, useCallback, useRef } from 'react';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';

// Internal imports
import { MarketData, OrderBook, Exchange } from '../types/market';
import { MarketService } from '../services/market';
import { useWebSocket } from './useWebSocket';

// Configuration interface for market data subscriptions
interface MarketDataConfig {
    batchUpdates?: boolean;
    updateInterval?: number;
    depth?: number;
    cacheTimeout?: number;
    retryAttempts?: number;
    validateData?: boolean;
}

// Default configuration values
const DEFAULT_CONFIG: Required<MarketDataConfig> = {
    batchUpdates: true,
    updateInterval: 100, // 100ms update interval
    depth: 10, // Default order book depth
    cacheTimeout: 1000, // 1 second cache timeout
    retryAttempts: 3,
    validateData: true,
};

// Market data state interface
interface MarketDataState {
    marketData: MarketData | null;
    orderBook: OrderBook | null;
    marketDepth: Array<{ price: Decimal; totalSize: Decimal }> | null;
    isLoading: boolean;
    error: Error | null;
    lastUpdateTime: number;
}

/**
 * Enhanced custom hook for managing real-time market data subscriptions
 * Features optimized performance, error handling, and DEX failover support
 */
export const useMarketData = (
    tradingPair: string,
    exchange: Exchange,
    config: MarketDataConfig = {}
) => {
    // Merge provided config with defaults
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    // Initialize WebSocket connection with health monitoring
    const { isConnected, connectionHealth, subscribe } = useWebSocket({
        autoConnect: true,
        messageValidation: finalConfig.validateData,
        batchMessages: finalConfig.batchUpdates,
    });

    // State management
    const [state, setState] = useState<MarketDataState>({
        marketData: null,
        orderBook: null,
        marketDepth: null,
        isLoading: true,
        error: null,
        lastUpdateTime: 0,
    });

    // Refs for message batching and caching
    const messageQueue = useRef<MarketData[]>([]);
    const batchTimeout = useRef<NodeJS.Timeout>();
    const marketService = useRef(new MarketService());
    const lastProcessedSequence = useRef<number>(0);

    /**
     * Handles market data updates with message batching and validation
     */
    const handleMarketDataUpdate = useCallback((data: MarketData) => {
        if (finalConfig.validateData) {
            // Validate data integrity
            if (!data.price || !data.volume || !data.timestamp) {
                console.error('Invalid market data received:', data);
                return;
            }

            // Ensure message ordering
            if (data.timestamp < state.lastUpdateTime) {
                return;
            }
        }

        if (finalConfig.batchUpdates) {
            // Add to message queue
            messageQueue.current.push(data);

            // Schedule batch processing
            if (!batchTimeout.current) {
                batchTimeout.current = setTimeout(() => {
                    const batch = messageQueue.current;
                    messageQueue.current = [];
                    batchTimeout.current = undefined;

                    // Process batch
                    const latestData = batch.reduce((latest, current) => {
                        return !latest || current.timestamp > latest.timestamp ? current : latest;
                    });

                    setState(prev => ({
                        ...prev,
                        marketData: latestData,
                        lastUpdateTime: latestData.timestamp.getTime(),
                    }));
                }, finalConfig.updateInterval);
            }
        } else {
            // Immediate update
            setState(prev => ({
                ...prev,
                marketData: data,
                lastUpdateTime: data.timestamp.getTime(),
            }));
        }
    }, [finalConfig.batchUpdates, finalConfig.updateInterval, finalConfig.validateData, state.lastUpdateTime]);

    /**
     * Handles order book updates with optimized processing
     */
    const handleOrderBookUpdate = useCallback((data: OrderBook) => {
        if (finalConfig.validateData) {
            // Validate order book integrity
            if (!data.bids || !data.asks || !data.timestamp) {
                console.error('Invalid order book data received:', data);
                return;
            }
        }

        setState(prev => ({
            ...prev,
            orderBook: data,
            marketDepth: calculateMarketDepth(data, finalConfig.depth),
            lastUpdateTime: data.timestamp.getTime(),
        }));
    }, [finalConfig.depth, finalConfig.validateData]);

    /**
     * Calculates market depth from order book data
     */
    const calculateMarketDepth = (
        orderBook: OrderBook,
        depth: number
    ): Array<{ price: Decimal; totalSize: Decimal }> => {
        const depthMap = new Map<string, Decimal>();

        // Process bids
        orderBook.bids.slice(0, depth).forEach(level => {
            depthMap.set(level.price.toString(), level.size);
        });

        // Process asks
        orderBook.asks.slice(0, depth).forEach(level => {
            depthMap.set(level.price.toString(), level.size);
        });

        // Calculate cumulative sizes
        let cumulativeSize = new Decimal(0);
        return Array.from(depthMap.entries())
            .sort((a, b) => new Decimal(a[0]).comparedTo(new Decimal(b[0])))
            .map(([price, size]) => ({
                price: new Decimal(price),
                totalSize: cumulativeSize = cumulativeSize.plus(size),
            }));
    };

    // Initialize subscriptions and cleanup
    useEffect(() => {
        if (!isConnected || !tradingPair || !exchange) return;

        setState(prev => ({ ...prev, isLoading: true, error: null }));

        // Subscribe to market data updates
        const marketDataUnsubscribe = marketService.current.subscribeToMarketData(
            tradingPair,
            exchange,
            {
                batchUpdates: finalConfig.batchUpdates,
                updateInterval: finalConfig.updateInterval,
            }
        ).subscribe(handleMarketDataUpdate);

        // Subscribe to order book updates
        const orderBookUnsubscribe = marketService.current.subscribeToOrderBook(
            tradingPair,
            exchange,
            {
                depth: finalConfig.depth,
                updateInterval: finalConfig.updateInterval,
            }
        ).subscribe(handleOrderBookUpdate);

        setState(prev => ({ ...prev, isLoading: false }));

        // Cleanup subscriptions
        return () => {
            marketDataUnsubscribe();
            orderBookUnsubscribe();
            if (batchTimeout.current) {
                clearTimeout(batchTimeout.current);
            }
            messageQueue.current = [];
        };
    }, [
        isConnected,
        tradingPair,
        exchange,
        finalConfig.batchUpdates,
        finalConfig.updateInterval,
        finalConfig.depth,
        handleMarketDataUpdate,
        handleOrderBookUpdate,
    ]);

    return {
        ...state,
        connectionHealth,
    };
};