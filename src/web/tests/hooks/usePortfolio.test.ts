// @testing-library/react-hooks v8.0.1 - React hooks testing utility
import { renderHook, act } from '@testing-library/react-hooks';
// jest v29.0.0 - Testing framework
import { jest } from '@jest/globals';
// decimal.js v10.4.3 - High-precision decimal calculations
import Decimal from 'decimal.js';

// Internal imports
import { usePortfolio } from '../../src/hooks/usePortfolio';
import { PortfolioService } from '../../src/services/portfolio';
import { WebSocketService } from '../../src/services/websocket';
import { Portfolio, Position, ConnectionStatus } from '../../src/types/portfolio';
import { WebSocketMessageType } from '../../src/types/api';

// Mock services
jest.mock('../../src/services/portfolio');
jest.mock('../../src/services/websocket');

describe('usePortfolio Hook', () => {
    // Test data setup
    const mockPortfolio: Portfolio = {
        id: 'portfolio-123',
        walletAddress: 'wallet-xyz',
        balance: new Decimal('1000.50'),
        positions: [
            {
                id: 'pos-1',
                portfolioId: 'portfolio-123',
                tradingPair: 'SOL/USDC',
                exchange: 'JUPITER',
                size: new Decimal('10'),
                entryPrice: new Decimal('22.50'),
                currentPrice: new Decimal('23.10'),
                unrealizedPnL: new Decimal('6'),
                realizedPnL: new Decimal('0'),
                stopLossPrice: new Decimal('21.50'),
                takeProfitPrice: new Decimal('25.00')
            }
        ],
        riskParameters: {
            maxPositionSize: new Decimal('25'),
            stopLossPercent: new Decimal('5'),
            takeProfitPercent: new Decimal('10'),
            maxDrawdownPercent: new Decimal('30'),
            riskLevel: 5,
            maxLeverage: new Decimal('2'),
            marginCallLevel: new Decimal('80')
        },
        metrics: {
            totalValue: new Decimal('1000.50'),
            dailyPnL: new Decimal('6'),
            dailyPnLPercent: new Decimal('0.6'),
            totalPnL: new Decimal('100'),
            totalPnLPercent: new Decimal('10'),
            sharpeRatio: new Decimal('1.5'),
            maxDrawdown: new Decimal('15'),
            volatility: new Decimal('0.2'),
            beta: new Decimal('1.1'),
            winRate: new Decimal('0.65')
        },
        assetAllocations: [
            {
                asset: 'SOL',
                amount: new Decimal('10'),
                value: new Decimal('231'),
                percentage: new Decimal('23.1'),
                targetPercentage: new Decimal('25'),
                rebalanceThreshold: new Decimal('5')
            }
        ],
        lastUpdated: new Date()
    };

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Setup PortfolioService mocks
        (PortfolioService.getPortfolioState as jest.Mock).mockResolvedValue(mockPortfolio);
        (PortfolioService.updatePosition as jest.Mock).mockResolvedValue({ success: true });
        
        // Setup WebSocket mocks
        (WebSocketService.connect as jest.Mock).mockResolvedValue(undefined);
        (WebSocketService.disconnect as jest.Mock).mockResolvedValue(undefined);
    });

    afterEach(() => {
        act(() => {
            // Cleanup WebSocket connections
            WebSocketService.disconnect();
        });
    });

    it('should initialize portfolio state correctly', async () => {
        const { result, waitForNextUpdate } = renderHook(() => usePortfolio());
        
        // Initial state should be null
        expect(result.current.portfolio).toBeNull();
        expect(result.current.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
        
        await waitForNextUpdate();
        
        // After initialization
        expect(result.current.portfolio).toEqual(mockPortfolio);
        expect(result.current.connectionStatus).toBe(ConnectionStatus.CONNECTED);
        expect(PortfolioService.getPortfolioState).toHaveBeenCalledTimes(1);
    });

    it('should handle WebSocket updates correctly', async () => {
        const { result, waitForNextUpdate } = renderHook(() => usePortfolio());
        await waitForNextUpdate();

        const updatedPosition: Partial<Position> = {
            currentPrice: new Decimal('24.00'),
            unrealizedPnL: new Decimal('15')
        };

        act(() => {
            // Simulate WebSocket message
            const wsMessage = {
                type: WebSocketMessageType.TRADE_UPDATE,
                data: {
                    positionId: 'pos-1',
                    changes: updatedPosition
                }
            };
            WebSocketService.onMessage(new MessageEvent('message', { data: JSON.stringify(wsMessage) }));
        });

        // Verify position update
        expect(result.current.portfolio?.positions[0].currentPrice).toEqual(updatedPosition.currentPrice);
        expect(result.current.portfolio?.positions[0].unrealizedPnL).toEqual(updatedPosition.unrealizedPnL);
    });

    it('should handle connection errors and reconnection', async () => {
        const { result, waitForNextUpdate } = renderHook(() => usePortfolio());
        await waitForNextUpdate();

        act(() => {
            // Simulate WebSocket error
            WebSocketService.onError(new Event('error'));
        });

        expect(result.current.connectionStatus).toBe(ConnectionStatus.ERROR);
        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.code).toBe(5001);

        act(() => {
            // Simulate successful reconnection
            WebSocketService.onOpen();
        });

        expect(result.current.connectionStatus).toBe(ConnectionStatus.CONNECTED);
        expect(result.current.error).toBeNull();
    });

    it('should update position with validation', async () => {
        const { result, waitForNextUpdate } = renderHook(() => usePortfolio());
        await waitForNextUpdate();

        const positionUpdate: Partial<Position> = {
            stopLossPrice: new Decimal('21.00'),
            takeProfitPrice: new Decimal('26.00')
        };

        await act(async () => {
            await result.current.updatePosition('pos-1', positionUpdate);
        });

        expect(PortfolioService.updatePosition).toHaveBeenCalledWith('pos-1', positionUpdate);
        expect(result.current.portfolio?.positions[0].stopLossPrice).toEqual(positionUpdate.stopLossPrice);
        expect(result.current.portfolio?.positions[0].takeProfitPrice).toEqual(positionUpdate.takeProfitPrice);
    });

    it('should handle position update errors', async () => {
        const { result, waitForNextUpdate } = renderHook(() => usePortfolio());
        await waitForNextUpdate();

        // Mock update failure
        (PortfolioService.updatePosition as jest.Mock).mockRejectedValue(new Error('Update failed'));

        await act(async () => {
            await result.current.updatePosition('pos-1', { stopLossPrice: new Decimal('21.00') });
        });

        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.code).toBe(4300);
        expect(result.current.error?.message).toContain('Failed to update position');
    });

    it('should cleanup resources on unmount', () => {
        const { unmount } = renderHook(() => usePortfolio());
        
        unmount();
        
        expect(WebSocketService.disconnect).toHaveBeenCalled();
    });
});