// React Testing Library v14.0.0
import { render, fireEvent, waitFor, within, screen } from '@testing-library/react';
// Jest v29.0.0
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
// React v18.0.0
import React from 'react';
// Axe Core v4.7.0
import { axe, toHaveNoViolations } from '@axe-core/react';
// Decimal.js v2.5.1
import Decimal from 'decimal.js-light';

// Internal imports
import TradingPage from '../../src/pages/Trading';
import { TradingContext } from '../../src/contexts/TradingContext';
import { validateOrderParams } from '../../src/utils/validation';
import { OrderType, OrderStatus } from '../../src/types/trading';
import { Exchange } from '../../src/types/market';

// Add axe accessibility matcher
expect.extend(toHaveNoViolations);

// Mock WebSocket
const mockWebSocket = {
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
};

// Mock TradingContext values
const mockTradingContext = {
    activeOrders: [],
    isLoading: false,
    error: null,
    riskMetrics: {
        portfolioValue: new Decimal(50000),
        exposureRatio: 0.15,
        riskScore: 25,
    },
    performanceStats: {
        averageExecutionTime: 150,
        successRate: 98.5,
        mevProfitTotal: new Decimal(1500),
    },
    placeOrder: jest.fn(),
    cancelOrder: jest.fn(),
    refreshOrders: jest.fn(),
};

describe('TradingPage Component', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Mock WebSocket global
        global.WebSocket = jest.fn(() => mockWebSocket) as any;
        
        // Mock market data stream
        jest.mock('../../src/hooks/useMarketData', () => ({
            useMarketData: () => ({
                marketData: {
                    price: new Decimal(23.45),
                    volume: new Decimal(100000),
                },
                orderBook: {
                    bids: [{ price: new Decimal(23.44), size: new Decimal(100) }],
                    asks: [{ price: new Decimal(23.46), size: new Decimal(100) }],
                },
                isLoading: false,
                connectionHealth: { latency: 50 },
            }),
        }));
    });

    afterEach(() => {
        // Cleanup WebSocket connections
        mockWebSocket.close();
    });

    describe('UI Rendering', () => {
        test('renders trading interface with all required components', async () => {
            const { container } = render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Verify main layout sections
            expect(screen.getByRole('main')).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /Trading SOL\/USDC/i })).toBeInTheDocument();
            
            // Verify order form elements
            const orderForm = screen.getByRole('form', { name: /Order Form/i });
            expect(orderForm).toBeInTheDocument();
            expect(within(orderForm).getByLabelText(/Order Type/i)).toBeInTheDocument();
            expect(within(orderForm).getByLabelText(/Side/i)).toBeInTheDocument();
            expect(within(orderForm).getByLabelText(/Price/i)).toBeInTheDocument();
            expect(within(orderForm).getByLabelText(/Amount/i)).toBeInTheDocument();
            
            // Verify order book
            expect(screen.getByRole('region', { name: /Order Book/i })).toBeInTheDocument();
            
            // Run accessibility audit
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });

        test('handles loading states correctly', async () => {
            mockTradingContext.isLoading = true;
            
            render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Verify loading indicators
            expect(screen.getByRole('button', { name: /Processing/i })).toBeDisabled();
            expect(screen.getByRole('status')).toHaveTextContent(/Connection Status/i);
        });
    });

    describe('Real-time Updates', () => {
        test('handles WebSocket market data updates', async () => {
            render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Simulate market data update
            const mockMarketData = {
                type: 'MARKET_DATA',
                data: {
                    price: new Decimal(24.50),
                    volume: new Decimal(150000),
                    timestamp: new Date(),
                },
            };

            // Get WebSocket message handler
            const messageHandler = mockWebSocket.addEventListener.mock.calls.find(
                call => call[0] === 'message'
            )[1];

            // Trigger market data update
            messageHandler({ data: JSON.stringify(mockMarketData) });

            // Verify UI updates
            await waitFor(() => {
                expect(screen.getByText(/24.50/)).toBeInTheDocument();
            });
        });

        test('handles WebSocket connection failures', async () => {
            render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Simulate connection error
            const errorHandler = mockWebSocket.addEventListener.mock.calls.find(
                call => call[0] === 'error'
            )[1];

            errorHandler(new Error('Connection failed'));

            // Verify error handling
            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
        });
    });

    describe('Order Management', () => {
        test('validates and submits orders correctly', async () => {
            render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Fill order form
            const orderForm = screen.getByRole('form', { name: /Order Form/i });
            fireEvent.change(within(orderForm).getByLabelText(/Price/i), { target: { value: '23.45' } });
            fireEvent.change(within(orderForm).getByLabelText(/Amount/i), { target: { value: '10' } });
            
            // Submit order
            fireEvent.click(screen.getByRole('button', { name: /Place Order/i }));

            // Verify order submission
            await waitFor(() => {
                expect(mockTradingContext.placeOrder).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tradingPair: 'SOL/USDC',
                        type: OrderType.LIMIT,
                        price: new Decimal('23.45'),
                        amount: new Decimal('10'),
                    })
                );
            });
        });

        test('handles order validation errors', async () => {
            render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Submit invalid order
            const orderForm = screen.getByRole('form', { name: /Order Form/i });
            fireEvent.change(within(orderForm).getByLabelText(/Price/i), { target: { value: '-1' } });
            fireEvent.change(within(orderForm).getByLabelText(/Amount/i), { target: { value: '0' } });
            
            fireEvent.click(screen.getByRole('button', { name: /Place Order/i }));

            // Verify error handling
            await waitFor(() => {
                expect(screen.getByRole('alert')).toHaveTextContent(/Invalid order parameters/i);
            });
        });
    });

    describe('Accessibility', () => {
        test('supports keyboard navigation', async () => {
            render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            const orderForm = screen.getByRole('form', { name: /Order Form/i });
            const inputs = within(orderForm).getAllByRole('spinbutton');

            // Tab through form elements
            inputs.forEach(input => {
                input.focus();
                expect(document.activeElement).toBe(input);
            });
        });

        test('provides appropriate ARIA attributes', async () => {
            const { container } = render(
                <TradingContext.Provider value={mockTradingContext}>
                    <TradingPage defaultPair="SOL/USDC" defaultExchange={Exchange.JUPITER} />
                </TradingContext.Provider>
            );

            // Verify ARIA roles and labels
            expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Trading Interface');
            expect(screen.getByRole('region', { name: /Order Book/i })).toHaveAttribute('aria-live', 'polite');
            
            // Run full accessibility audit
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });
});