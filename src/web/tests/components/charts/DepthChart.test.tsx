import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import Decimal from 'decimal.js-light'; // v2.5.1
import { act } from 'react-dom/test-utils';

import DepthChart from '../../src/components/charts/DepthChart';
import { ChartTheme } from '../../src/types/chart';
import { OrderBook, OrderBookLevel } from '../../src/types/market';

// Add jest-axe matchers
expect.extend(toHaveNoViolations);

// Mock WebGL context
const mockWebGLContext = {
    canvas: document.createElement('canvas'),
    getContext: jest.fn(),
    drawArrays: jest.fn(),
    viewport: jest.fn(),
    createShader: jest.fn(),
    createProgram: jest.fn(),
    useProgram: jest.fn(),
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
        this.observe = jest.fn();
        this.unobserve = jest.fn();
        this.disconnect = jest.fn();
    }
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
};

/**
 * Generates mock order book data with high precision
 */
const generateMockOrderBook = (precision: number = 6, dataPoints: number = 50): OrderBook => {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    const basePrice = new Decimal('22.50');
    
    // Generate bid orders
    for (let i = 0; i < dataPoints; i++) {
        const price = basePrice.minus(new Decimal(i).div(Math.pow(10, precision)));
        bids.push({
            price,
            size: new Decimal(Math.random() * 100).toDecimalPlaces(precision)
        });
    }
    
    // Generate ask orders
    for (let i = 0; i < dataPoints; i++) {
        const price = basePrice.plus(new Decimal(i).div(Math.pow(10, precision)));
        asks.push({
            price,
            size: new Decimal(Math.random() * 100).toDecimalPlaces(precision)
        });
    }
    
    return {
        tradingPair: 'SOL/USDC',
        exchange: 'JUPITER',
        bids: bids.sort((a, b) => b.price.minus(a.price).toNumber()),
        asks: asks.sort((a, b) => a.price.minus(b.price).toNumber()),
        timestamp: new Date()
    };
};

/**
 * Sets up test environment with required mocks and configurations
 */
const setupChartTest = async (theme: ChartTheme = ChartTheme.DARK, size = { width: 800, height: 400 }) => {
    const orderBook = generateMockOrderBook();
    const onHover = jest.fn();
    const onResize = jest.fn();
    
    // Mock canvas and WebGL context
    HTMLCanvasElement.prototype.getContext = jest.fn(() => mockWebGLContext);
    
    const { container, rerender } = render(
        <DepthChart
            orderBook={orderBook}
            width={size.width}
            height={size.height}
            theme={theme}
            precision={6}
            onHover={onHover}
            onResize={onResize}
            accessibilityLabel="Market Depth Chart"
        />
    );
    
    // Wait for chart initialization
    await waitFor(() => {
        expect(container.querySelector('div[role="img"]')).toBeInTheDocument();
    });
    
    return {
        container,
        orderBook,
        onHover,
        onResize,
        rerender
    };
};

describe('DepthChart Component', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    describe('Accessibility', () => {
        it('should meet WCAG 2.1 Level AA standards', async () => {
            const { container } = await setupChartTest();
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
        
        it('should provide proper ARIA labels', async () => {
            await setupChartTest();
            expect(screen.getByRole('img', { name: 'Market Depth Chart' })).toBeInTheDocument();
        });
        
        it('should support keyboard navigation', async () => {
            const { container, onHover } = await setupChartTest();
            const chart = container.querySelector('div[role="img"]');
            
            fireEvent.keyDown(chart!, { key: 'ArrowRight' });
            await waitFor(() => {
                expect(onHover).toHaveBeenCalled();
            });
        });
    });
    
    describe('Performance', () => {
        it('should efficiently handle large order books', async () => {
            const orderBook = generateMockOrderBook(6, 1000);
            const startTime = performance.now();
            
            await setupChartTest(ChartTheme.DARK, { width: 1920, height: 1080 });
            const renderTime = performance.now() - startTime;
            
            expect(renderTime).toBeLessThan(500); // Max 500ms render time
        });
        
        it('should optimize WebGL rendering', async () => {
            const { container } = await setupChartTest();
            
            // Trigger multiple updates
            for (let i = 0; i < 10; i++) {
                const newOrderBook = generateMockOrderBook();
                await act(async () => {
                    render(
                        <DepthChart
                            orderBook={newOrderBook}
                            width={800}
                            height={400}
                            theme={ChartTheme.DARK}
                            precision={6}
                        />,
                        { container }
                    );
                });
            }
            
            expect(mockWebGLContext.drawArrays).toHaveBeenCalled();
        });
        
        it('should debounce resize events', async () => {
            const { onResize } = await setupChartTest();
            
            // Trigger multiple resize events
            for (let i = 0; i < 5; i++) {
                fireEvent(window, new Event('resize'));
            }
            
            await waitFor(() => {
                expect(onResize).toHaveBeenCalledTimes(1);
            }, { timeout: 200 });
        });
    });
    
    describe('Responsive Behavior', () => {
        const breakpoints = [
            { width: 2560, height: 1440 }, // Ultra-wide
            { width: 1920, height: 1080 }, // Full HD
            { width: 1440, height: 900 },  // Standard Desktop
        ];
        
        test.each(breakpoints)('should render properly at %px width', async ({ width, height }) => {
            const { container } = await setupChartTest(ChartTheme.DARK, { width, height });
            const chart = container.querySelector('div[role="img"]');
            
            expect(chart).toHaveStyle({
                width: `${width}px`,
                height: `${height}px`,
            });
        });
        
        it('should maintain aspect ratio on resize', async () => {
            const { container, onResize } = await setupChartTest();
            
            // Simulate window resize
            act(() => {
                window.innerWidth = 1920;
                window.innerHeight = 1080;
                fireEvent(window, new Event('resize'));
            });
            
            await waitFor(() => {
                expect(onResize).toHaveBeenCalledWith(
                    expect.objectContaining({
                        width: expect.any(Number),
                        height: expect.any(Number),
                    })
                );
            });
        });
    });
    
    describe('Theme Support', () => {
        it('should apply dark theme correctly', async () => {
            const { container } = await setupChartTest(ChartTheme.DARK);
            const chart = container.querySelector('div[role="img"]');
            
            expect(chart).toHaveStyle({
                backgroundColor: '#121212',
            });
        });
        
        it('should apply light theme correctly', async () => {
            const { container } = await setupChartTest(ChartTheme.LIGHT);
            const chart = container.querySelector('div[role="img"]');
            
            expect(chart).toHaveStyle({
                backgroundColor: '#FFFFFF',
            });
        });
    });
    
    describe('Data Visualization', () => {
        it('should render bid and ask sides correctly', async () => {
            const { container } = await setupChartTest();
            const chart = container.querySelector('div[role="img"]');
            
            expect(mockWebGLContext.drawArrays).toHaveBeenCalledTimes(2); // One call per side
        });
        
        it('should handle empty order book gracefully', async () => {
            const emptyOrderBook: OrderBook = {
                tradingPair: 'SOL/USDC',
                exchange: 'JUPITER',
                bids: [],
                asks: [],
                timestamp: new Date()
            };
            
            const { container } = render(
                <DepthChart
                    orderBook={emptyOrderBook}
                    width={800}
                    height={400}
                    theme={ChartTheme.DARK}
                    precision={6}
                />
            );
            
            expect(container.querySelector('div[role="img"]')).toBeInTheDocument();
        });
    });
});