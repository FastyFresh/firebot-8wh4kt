// React Testing Library and Vitest imports
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, beforeAll, afterAll, describe, it, expect } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';

// Component and hook imports
import OrderBook from '../../../src/components/trading/OrderBook';
import { useMarketData } from '../../../src/hooks/useMarketData';
import { Exchange } from '../../../src/types/market';
import Decimal from 'decimal.js-light';

// Mock WebSocket and hooks
vi.mock('../../../src/hooks/useMarketData');

// Test data generation helper
const generateOrderBookData = (exchange: Exchange, depth: number = 25) => {
    const basePrice = new Decimal('22.50');
    const bids = Array.from({ length: depth }, (_, i) => ({
        price: basePrice.minus(new Decimal(i).div(100)),
        size: new Decimal(Math.random() * 100 + 10).toFixed(6)
    }));

    const asks = Array.from({ length: depth }, (_, i) => ({
        price: basePrice.plus(new Decimal(i).div(100)),
        size: new Decimal(Math.random() * 100 + 10).toFixed(6)
    }));

    return {
        tradingPair: 'SOL/USDC',
        exchange,
        bids,
        asks,
        timestamp: new Date()
    };
};

// Enhanced render helper with accessibility testing
const renderOrderBook = (props: {
    tradingPair: string;
    exchange: Exchange;
    maxRows?: number;
    onOrderSelect?: (price: Decimal) => void;
    depthVisualization?: boolean;
    accessibilityMode?: boolean;
}) => {
    const utils = render(<OrderBook {...props} />);
    return {
        ...utils,
        axe: () => axe(utils.container)
    };
};

describe('OrderBook Component', () => {
    beforeAll(() => {
        expect.extend(toHaveNoViolations);
    });

    describe('Rendering and Updates', () => {
        it('should render loading skeleton initially', () => {
            vi.mocked(useMarketData).mockReturnValue({
                orderBook: null,
                isLoading: true,
                error: null,
                connectionHealth: { latency: 0, messageRate: 0, lastHeartbeat: null }
            });

            renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            expect(screen.getByRole('alert')).toHaveTextContent('Loading order book...');
        });

        it('should render order book with virtualized rows', async () => {
            const orderBook = generateOrderBookData(Exchange.JUPITER);
            vi.mocked(useMarketData).mockReturnValue({
                orderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            await waitFor(() => {
                expect(screen.getByRole('region')).toBeInTheDocument();
                expect(screen.getAllByRole('button')).toHaveLength(50); // 25 bids + 25 asks
            });
        });

        it('should update smoothly on WebSocket messages', async () => {
            const initialOrderBook = generateOrderBookData(Exchange.JUPITER);
            const updatedOrderBook = generateOrderBookData(Exchange.JUPITER);
            
            const mockUseMarketData = vi.mocked(useMarketData);
            mockUseMarketData.mockReturnValueOnce({
                orderBook: initialOrderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            const { rerender } = renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            mockUseMarketData.mockReturnValueOnce({
                orderBook: updatedOrderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            rerender(<OrderBook tradingPair="SOL/USDC" exchange={Exchange.JUPITER} />);

            await waitFor(() => {
                const rows = screen.getAllByRole('button');
                expect(rows[0]).toHaveTextContent(updatedOrderBook.bids[0].price.toString());
            });
        });
    });

    describe('Accessibility', () => {
        it('should meet WCAG 2.1 Level AA requirements', async () => {
            const orderBook = generateOrderBookData(Exchange.JUPITER);
            vi.mocked(useMarketData).mockReturnValue({
                orderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            const { axe } = renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER,
                accessibilityMode: true
            });

            const results = await axe();
            expect(results).toHaveNoViolations();
        });

        it('should support keyboard navigation', async () => {
            const orderBook = generateOrderBookData(Exchange.JUPITER);
            vi.mocked(useMarketData).mockReturnValue({
                orderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            const firstRow = screen.getAllByRole('button')[0];
            firstRow.focus();
            expect(document.activeElement).toBe(firstRow);

            fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
            await waitFor(() => {
                expect(document.activeElement).toBe(screen.getAllByRole('button')[1]);
            });
        });
    });

    describe('Performance', () => {
        it('should render large order books efficiently', async () => {
            const orderBook = generateOrderBookData(Exchange.JUPITER, 100);
            vi.mocked(useMarketData).mockReturnValue({
                orderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            const startTime = performance.now();
            renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER,
                maxRows: 100
            });

            const renderTime = performance.now() - startTime;
            expect(renderTime).toBeLessThan(100); // Render time should be under 100ms
        });

        it('should handle rapid exchange switching', async () => {
            const jupiterOrderBook = generateOrderBookData(Exchange.JUPITER);
            const pumpFunOrderBook = generateOrderBookData(Exchange.PUMP_FUN);

            const { rerender } = renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            vi.mocked(useMarketData).mockReturnValueOnce({
                orderBook: jupiterOrderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            rerender(<OrderBook tradingPair="SOL/USDC" exchange={Exchange.PUMP_FUN} />);

            vi.mocked(useMarketData).mockReturnValueOnce({
                orderBook: pumpFunOrderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            await waitFor(() => {
                expect(screen.getByRole('region')).toHaveAttribute('aria-label', expect.stringContaining('SOL/USDC'));
            });
        });
    });

    describe('Error Handling', () => {
        it('should display connection error states', async () => {
            vi.mocked(useMarketData).mockReturnValue({
                orderBook: null,
                isLoading: false,
                error: new Error('Connection failed'),
                connectionHealth: { latency: 0, messageRate: 0, lastHeartbeat: null }
            });

            renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('should handle data inconsistencies gracefully', async () => {
            const invalidOrderBook = {
                ...generateOrderBookData(Exchange.JUPITER),
                bids: [], // Empty bids array
            };

            vi.mocked(useMarketData).mockReturnValue({
                orderBook: invalidOrderBook,
                isLoading: false,
                error: null,
                connectionHealth: { latency: 50, messageRate: 10, lastHeartbeat: new Date() }
            });

            renderOrderBook({
                tradingPair: 'SOL/USDC',
                exchange: Exchange.JUPITER
            });

            await waitFor(() => {
                expect(screen.getByRole('region')).toBeInTheDocument();
            });
        });
    });
});