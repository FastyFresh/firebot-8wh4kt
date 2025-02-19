import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { axe, toHaveNoViolations } from '@axe-core/react';
import { PerformanceChart } from '../../../../src/components/charts/PerformanceChart';
import { ChartTimeframe, ChartTheme } from '../../../../src/types/chart';
import { CHART_DIMENSIONS, CHART_COLORS } from '../../../../src/constants/chart';

// Add axe accessibility matcher
expect.extend(toHaveNoViolations);

// Mock lightweight-charts
jest.mock('lightweight-charts', () => {
    const mockLineSeries = {
        setData: jest.fn(),
        applyOptions: jest.fn()
    };

    const mockChart = {
        addLineSeries: jest.fn(() => mockLineSeries),
        applyOptions: jest.fn(),
        remove: jest.fn(),
        timeScale: jest.fn(),
        priceScale: jest.fn()
    };

    return {
        createChart: jest.fn(() => mockChart),
        ColorType: { Solid: 'solid' },
        LineStyle: { Dotted: 1 }
    };
});

// Mock WebGL context
const mockWebGLContext = {
    getParameter: jest.fn(() => true),
    getExtension: jest.fn(() => true)
};

// Generate mock performance data
const generateMockPerformanceData = (
    dataPoints: number = 100,
    timeframe: ChartTimeframe = ChartTimeframe.FIFTEEN_MINUTES,
    withVolatility: boolean = false
): Array<{ timestamp: number; value: number }> => {
    const now = Date.now();
    const intervalMap = {
        [ChartTimeframe.ONE_MINUTE]: 60 * 1000,
        [ChartTimeframe.FIVE_MINUTES]: 5 * 60 * 1000,
        [ChartTimeframe.FIFTEEN_MINUTES]: 15 * 60 * 1000,
        [ChartTimeframe.ONE_HOUR]: 60 * 60 * 1000,
        [ChartTimeframe.FOUR_HOURS]: 4 * 60 * 60 * 1000,
        [ChartTimeframe.ONE_DAY]: 24 * 60 * 60 * 1000
    };

    const interval = intervalMap[timeframe];
    let baseValue = 1000;

    return Array.from({ length: dataPoints }, (_, i) => {
        if (withVolatility) {
            baseValue += (Math.random() - 0.5) * 10;
        }
        return {
            timestamp: now - (dataPoints - i) * interval,
            value: baseValue
        };
    });
};

// Setup ResizeObserver mock
const setupResizeObserverMock = () => {
    const mockObserve = jest.fn();
    const mockUnobserve = jest.fn();
    const mockDisconnect = jest.fn();

    class ResizeObserverMock {
        callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
            this.callback = callback;
        }
        observe = mockObserve;
        unobserve = mockUnobserve;
        disconnect = mockDisconnect;

        // Helper to trigger resize
        triggerResize(width: number, height: number) {
            this.callback([
                {
                    contentRect: {
                        width,
                        height,
                        top: 0,
                        left: 0,
                        right: width,
                        bottom: height,
                        x: 0,
                        y: 0
                    },
                    target: document.createElement('div')
                }
            ] as any, this);
        }
    }

    window.ResizeObserver = ResizeObserverMock;
    return { mockObserve, mockUnobserve, mockDisconnect };
};

describe('PerformanceChart Component', () => {
    beforeEach(() => {
        // Setup WebGL mock
        HTMLCanvasElement.prototype.getContext = jest.fn(() => mockWebGLContext);
        setupResizeObserverMock();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('renders with WebGL acceleration enabled', async () => {
        const mockData = generateMockPerformanceData();
        const { container } = render(
            <PerformanceChart
                data={mockData}
                timeframe={ChartTimeframe.FIFTEEN_MINUTES}
                theme={ChartTheme.DARK}
                enableWebGL={true}
            />
        );

        expect(container.querySelector('[data-testid="performance-chart"]')).toBeInTheDocument();
        expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('webgl2');
    });

    test('handles real-time data updates efficiently', async () => {
        const initialData = generateMockPerformanceData(50);
        const { rerender } = render(
            <PerformanceChart
                data={initialData}
                timeframe={ChartTimeframe.ONE_MINUTE}
                theme={ChartTheme.DARK}
            />
        );

        // Simulate real-time updates
        const updatedData = [
            ...initialData,
            ...generateMockPerformanceData(10, ChartTimeframe.ONE_MINUTE, true)
        ];

        const startTime = performance.now();
        rerender(
            <PerformanceChart
                data={updatedData}
                timeframe={ChartTimeframe.ONE_MINUTE}
                theme={ChartTheme.DARK}
            />
        );
        const updateTime = performance.now() - startTime;

        // Verify update performance
        expect(updateTime).toBeLessThan(100); // Updates should be under 100ms
    });

    test('maintains accessibility standards', async () => {
        const mockData = generateMockPerformanceData();
        const { container } = render(
            <PerformanceChart
                data={mockData}
                timeframe={ChartTimeframe.FIFTEEN_MINUTES}
                theme={ChartTheme.DARK}
                enableAccessibility={true}
            />
        );

        // Run accessibility checks
        const results = await axe(container);
        expect(results).toHaveNoViolations();

        // Verify ARIA attributes
        const chart = screen.getByTestId('performance-chart');
        expect(chart).toHaveAttribute('role', 'img');
        expect(chart).toHaveAttribute('aria-label', 'Portfolio Performance Chart');
        expect(chart).toHaveAttribute('tabIndex', '0');
    });

    test('adapts to container resizing', async () => {
        const mockData = generateMockPerformanceData();
        const { container } = render(
            <PerformanceChart
                data={mockData}
                timeframe={ChartTimeframe.FIFTEEN_MINUTES}
                theme={ChartTheme.DARK}
            />
        );

        const resizeObserver = new window.ResizeObserver(() => {});
        const chart = screen.getByTestId('performance-chart');

        // Test large breakpoint
        resizeObserver.triggerResize(
            CHART_DIMENSIONS.RESPONSIVE_BREAKPOINTS.LARGE,
            CHART_DIMENSIONS.MIN_HEIGHT
        );
        await waitFor(() => {
            expect(chart.style.width).toBe('100%');
            expect(chart.style.minWidth).toBe(`${CHART_DIMENSIONS.MIN_WIDTH}px`);
        });

        // Test medium breakpoint
        resizeObserver.triggerResize(
            CHART_DIMENSIONS.RESPONSIVE_BREAKPOINTS.MEDIUM,
            CHART_DIMENSIONS.MIN_HEIGHT
        );
        await waitFor(() => {
            expect(chart.style.width).toBe('100%');
        });
    });

    test('applies theme changes correctly', async () => {
        const mockData = generateMockPerformanceData();
        const { rerender } = render(
            <PerformanceChart
                data={mockData}
                timeframe={ChartTimeframe.FIFTEEN_MINUTES}
                theme={ChartTheme.DARK}
            />
        );

        // Switch to light theme
        rerender(
            <PerformanceChart
                data={mockData}
                timeframe={ChartTimeframe.FIFTEEN_MINUTES}
                theme={ChartTheme.LIGHT}
            />
        );

        // Verify theme application
        expect(screen.getByTestId('performance-chart')).toBeInTheDocument();
    });
});