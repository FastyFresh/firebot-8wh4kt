// @testing-library/react-hooks v8.0.1
import { renderHook, act } from '@testing-library/react-hooks';
// jest v29.0.0
import { jest } from '@testing-library/jest-utils';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';

// Internal imports
import { useMarketData } from '../../src/hooks/useMarketData';
import { MarketService } from '../../src/services/market';
import { Exchange } from '../../src/types/market';

// Mock MarketService
jest.mock('../../src/services/market');

describe('useMarketData', () => {
    // Test data constants
    const TEST_TRADING_PAIR = 'SOL/USDC';
    const TEST_EXCHANGE = Exchange.JUPITER;
    const TEST_PRICE = new Decimal('22.50');
    const TEST_VOLUME = new Decimal('100000');

    // Mock data
    const mockMarketData = {
        id: '1',
        tradingPair: TEST_TRADING_PAIR,
        exchange: TEST_EXCHANGE,
        price: TEST_PRICE,
        volume: TEST_VOLUME,
        timestamp: new Date()
    };

    const mockOrderBook = {
        tradingPair: TEST_TRADING_PAIR,
        exchange: TEST_EXCHANGE,
        bids: [
            { price: new Decimal('22.45'), size: new Decimal('100') },
            { price: new Decimal('22.40'), size: new Decimal('200') }
        ],
        asks: [
            { price: new Decimal('22.55'), size: new Decimal('150') },
            { price: new Decimal('22.60'), size: new Decimal('250') }
        ],
        timestamp: new Date()
    };

    // Mock implementations
    let mockSubscribeToMarketData: jest.Mock;
    let mockSubscribeToOrderBook: jest.Mock;
    let mockGetMarketDepthSnapshot: jest.Mock;

    beforeAll(() => {
        // Enable fake timers
        jest.useFakeTimers();
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup mock implementations
        mockSubscribeToMarketData = jest.fn().mockReturnValue({
            subscribe: (callback: Function) => {
                callback(mockMarketData);
                return () => {};
            }
        });

        mockSubscribeToOrderBook = jest.fn().mockReturnValue({
            subscribe: (callback: Function) => {
                callback(mockOrderBook);
                return () => {};
            }
        });

        mockGetMarketDepthSnapshot = jest.fn().mockResolvedValue([
            { price: new Decimal('22.50'), totalSize: new Decimal('1000') }
        ]);

        // Apply mocks to MarketService
        (MarketService as jest.Mock).mockImplementation(() => ({
            subscribeToMarketData: mockSubscribeToMarketData,
            subscribeToOrderBook: mockSubscribeToOrderBook,
            getMarketDepthSnapshot: mockGetMarketDepthSnapshot
        }));
    });

    afterEach(() => {
        jest.clearAllTimers();
    });

    it('should initialize with loading state', () => {
        const { result } = renderHook(() => useMarketData(TEST_TRADING_PAIR, TEST_EXCHANGE));

        expect(result.current.isLoading).toBe(true);
        expect(result.current.marketData).toBeNull();
        expect(result.current.orderBook).toBeNull();
        expect(result.current.marketDepth).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('should handle market data updates', async () => {
        const { result, waitForNextUpdate } = renderHook(() => 
            useMarketData(TEST_TRADING_PAIR, TEST_EXCHANGE)
        );

        await waitForNextUpdate();

        expect(result.current.marketData).toEqual(mockMarketData);
        expect(result.current.isLoading).toBe(false);
        expect(mockSubscribeToMarketData).toHaveBeenCalledWith(
            TEST_TRADING_PAIR,
            TEST_EXCHANGE,
            expect.any(Object)
        );
    });

    it('should handle order book updates', async () => {
        const { result, waitForNextUpdate } = renderHook(() => 
            useMarketData(TEST_TRADING_PAIR, TEST_EXCHANGE)
        );

        await waitForNextUpdate();

        expect(result.current.orderBook).toEqual(mockOrderBook);
        expect(mockSubscribeToOrderBook).toHaveBeenCalledWith(
            TEST_TRADING_PAIR,
            TEST_EXCHANGE,
            expect.any(Object)
        );
    });

    it('should handle multi-DEX data integration', async () => {
        const exchanges = [Exchange.JUPITER, Exchange.PUMP_FUN, Exchange.DRIFT];
        const multiDexData = exchanges.map(exchange => ({
            ...mockMarketData,
            exchange,
            price: new Decimal(Math.random() * 100)
        }));

        mockSubscribeToMarketData.mockImplementation(() => ({
            subscribe: (callback: Function) => {
                multiDexData.forEach(data => callback(data));
                return () => {};
            }
        }));

        const { result, waitForNextUpdate } = renderHook(() => 
            useMarketData(TEST_TRADING_PAIR, Exchange.JUPITER, {
                validateData: true,
                batchUpdates: true
            })
        );

        await waitForNextUpdate();

        expect(result.current.marketData).toBeTruthy();
        expect(result.current.marketData?.exchange).toBe(Exchange.JUPITER);
    });

    it('should maintain performance requirements', async () => {
        const startTime = Date.now();
        const { result, waitForNextUpdate } = renderHook(() => 
            useMarketData(TEST_TRADING_PAIR, TEST_EXCHANGE, {
                updateInterval: 100,
                batchUpdates: true
            })
        );

        // Simulate high-frequency updates
        for (let i = 0; i < 100; i++) {
            act(() => {
                mockSubscribeToMarketData.mock.calls[0][0].onData({
                    ...mockMarketData,
                    price: new Decimal(Math.random() * 100),
                    timestamp: new Date()
                });
            });
            jest.advanceTimersByTime(10); // Advance 10ms
        }

        await waitForNextUpdate();

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        expect(processingTime).toBeLessThan(500); // 500ms latency requirement
        expect(result.current.error).toBeNull();
    });

    it('should handle error states gracefully', async () => {
        const testError = new Error('Market data subscription failed');
        mockSubscribeToMarketData.mockImplementation(() => {
            throw testError;
        });

        const { result, waitForNextUpdate } = renderHook(() => 
            useMarketData(TEST_TRADING_PAIR, TEST_EXCHANGE)
        );

        await waitForNextUpdate();

        expect(result.current.error).toBeTruthy();
        expect(result.current.isLoading).toBe(false);
    });

    it('should cleanup subscriptions on unmount', () => {
        const unsubscribeMock = jest.fn();
        mockSubscribeToMarketData.mockReturnValue({
            subscribe: () => unsubscribeMock
        });

        const { unmount } = renderHook(() => 
            useMarketData(TEST_TRADING_PAIR, TEST_EXCHANGE)
        );

        unmount();

        expect(unsubscribeMock).toHaveBeenCalled();
    });
});