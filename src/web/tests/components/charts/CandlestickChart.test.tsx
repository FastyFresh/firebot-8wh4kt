// @testing-library/react v14.0.0
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @jest/globals v29.0.0
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
// resize-observer-polyfill v1.5.1
import ResizeObserver from 'resize-observer-polyfill';
// lightweight-charts v4.0.0
import { createChart } from 'lightweight-charts';

// Internal imports
import CandlestickChart from '../../../src/components/charts/CandlestickChart';
import { ChartTimeframe, ChartTheme, ChartOptions } from '../../../src/types/chart';
import { Exchange } from '../../../src/types/market';
import { CHART_DIMENSIONS, CHART_COLORS } from '../../../src/constants/chart';

// Mock lightweight-charts
jest.mock('lightweight-charts', () => ({
    createChart: jest.fn(() => ({
        applyOptions: jest.fn(),
        resize: jest.fn(),
        remove: jest.fn(),
        addCandlestickSeries: jest.fn(() => ({
            setData: jest.fn(),
            applyOptions: jest.fn()
        })),
        addHistogramSeries: jest.fn(() => ({
            setData: jest.fn(),
            applyOptions: jest.fn()
        })),
        timeScale: jest.fn(() => ({
            fitContent: jest.fn()
        })),
        options: jest.fn(() => ({}))
    }))
}));

describe('CandlestickChart Component', () => {
    // Default test props
    const defaultProps = {
        tradingPair: 'SOL/USDC',
        exchange: Exchange.JUPITER,
        timeframe: ChartTimeframe.FIFTEEN_MINUTES,
        options: {
            theme: ChartTheme.DARK,
            showVolume: true,
            showGrid: true,
            autoScale: true
        } as ChartOptions
    };

    beforeEach(() => {
        // Mock ResizeObserver
        global.ResizeObserver = ResizeObserver;
        
        // Mock WebGL context
        const mockContext = {
            getContext: jest.fn(() => ({
                canvas: {},
                drawingBufferWidth: 1920,
                drawingBufferHeight: 1080
            }))
        };
        jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
            if (tagName === 'canvas') {
                return mockContext as any;
            }
            return document.createElement(tagName);
        });

        // Mock performance measurement
        jest.spyOn(window.performance, 'now').mockImplementation(() => Date.now());
        jest.spyOn(window.performance, 'measure').mockImplementation();
        jest.spyOn(window.performance, 'mark').mockImplementation();
    });

    afterEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '';
    });

    test('renders without errors and initializes chart', async () => {
        const { container } = render(<CandlestickChart {...defaultProps} />);
        
        // Verify chart container
        const chartContainer = container.querySelector('.candlestick-chart');
        expect(chartContainer).toBeInTheDocument();
        expect(chartContainer).toHaveAttribute('role', 'img');
        expect(chartContainer).toHaveAttribute('aria-label', 'Candlestick chart for SOL/USDC');

        // Verify chart initialization
        expect(createChart).toHaveBeenCalledWith(
            expect.any(HTMLDivElement),
            expect.objectContaining({
                width: expect.any(Number),
                height: expect.any(Number),
                layout: expect.objectContaining({
                    background: {
                        type: 'solid',
                        color: CHART_COLORS.BACKGROUND
                    }
                })
            })
        );
    });

    test('handles data updates with performance optimization', async () => {
        const mockMarketData = mockChartData(100, ChartTimeframe.FIFTEEN_MINUTES);
        const { rerender } = render(<CandlestickChart {...defaultProps} />);

        // Measure update performance
        const startTime = performance.now();
        rerender(<CandlestickChart {...defaultProps} data={mockMarketData} />);
        const endTime = performance.now();

        // Verify update latency is within requirements (<500ms)
        expect(endTime - startTime).toBeLessThan(500);

        // Verify data update was batched and animated
        await waitFor(() => {
            expect(screen.queryByText('Loading chart data...')).not.toBeInTheDocument();
        });
    });

    test('handles theme changes correctly', async () => {
        const { rerender } = render(<CandlestickChart {...defaultProps} />);

        // Change theme to light
        const lightThemeProps = {
            ...defaultProps,
            options: { ...defaultProps.options, theme: ChartTheme.LIGHT }
        };
        rerender(<CandlestickChart {...lightThemeProps} />);

        // Verify theme update
        expect(createChart).toHaveBeenLastCalledWith(
            expect.any(HTMLDivElement),
            expect.objectContaining({
                layout: expect.objectContaining({
                    background: {
                        type: 'solid',
                        color: '#FFFFFF'
                    }
                })
            })
        );
    });

    test('handles responsive behavior correctly', async () => {
        const { container } = render(<CandlestickChart {...defaultProps} />);
        const chartContainer = container.querySelector('.candlestick-chart');

        // Simulate resize
        fireEvent(chartContainer!, new Event('resize'));

        // Verify minimum dimensions
        expect(chartContainer).toHaveStyle({
            minHeight: `${CHART_DIMENSIONS.MIN_HEIGHT}px`
        });

        // Verify chart resize was called
        await waitFor(() => {
            expect(createChart).toHaveBeenLastCalledWith(
                expect.any(HTMLDivElement),
                expect.objectContaining({
                    width: expect.any(Number),
                    height: expect.any(Number)
                })
            );
        });
    });

    test('meets accessibility requirements', () => {
        const { container } = render(<CandlestickChart {...defaultProps} />);
        
        // Verify ARIA attributes
        expect(container.querySelector('.candlestick-chart')).toHaveAttribute(
            'role',
            'img'
        );
        expect(container.querySelector('.candlestick-chart')).toHaveAttribute(
            'aria-label',
            'Candlestick chart for SOL/USDC'
        );

        // Verify loading state accessibility
        const loadingElement = screen.queryByText('Loading chart data...');
        if (loadingElement) {
            expect(loadingElement).toHaveAttribute('role', 'status');
            expect(loadingElement).toHaveAttribute('aria-live', 'polite');
        }
    });

    test('handles errors gracefully', async () => {
        // Mock chart creation error
        (createChart as jest.Mock).mockImplementationOnce(() => {
            throw new Error('Chart initialization failed');
        });

        render(<CandlestickChart {...defaultProps} />);

        // Verify error message
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Failed to load chart: Chart initialization failed'
            );
        });
    });
});

// Helper function to generate mock chart data
function mockChartData(count: number, timeframe: ChartTimeframe) {
    const data = [];
    let timestamp = Date.now();
    let lastPrice = 100;

    const timeframeMinutes = {
        [ChartTimeframe.ONE_MINUTE]: 1,
        [ChartTimeframe.FIVE_MINUTES]: 5,
        [ChartTimeframe.FIFTEEN_MINUTES]: 15,
        [ChartTimeframe.ONE_HOUR]: 60,
        [ChartTimeframe.FOUR_HOURS]: 240,
        [ChartTimeframe.ONE_DAY]: 1440
    };

    for (let i = 0; i < count; i++) {
        const priceChange = (Math.random() - 0.5) * 2;
        const open = lastPrice;
        const close = lastPrice + priceChange;
        const high = Math.max(open, close) + Math.random();
        const low = Math.min(open, close) - Math.random();
        const volume = Math.random() * 1000 + 100;

        data.push({
            time: timestamp,
            open,
            high,
            low,
            close,
            volume
        });

        lastPrice = close;
        timestamp -= timeframeMinutes[timeframe] * 60 * 1000;
    }

    return data.reverse();
}