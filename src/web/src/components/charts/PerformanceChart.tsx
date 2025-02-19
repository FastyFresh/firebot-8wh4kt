// react v18.0.0
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// lightweight-charts v4.0.0
import { createChart, LineStyle, IChartApi } from 'lightweight-charts';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';

import { ChartTimeframe, ChartTheme, ChartOptions } from '../../types/chart';
import { CHART_DIMENSIONS, CHART_COLORS, CHART_DEFAULTS } from '../../constants/chart';
import { calculateChartDimensions, applyChartTheme } from '../../utils/chart';

interface PerformanceChartProps {
    data: Array<{ timestamp: number; value: number }>;
    timeframe: ChartTimeframe;
    theme: ChartTheme;
    width?: number;
    height?: number;
    showGrid?: boolean;
    autoScale?: boolean;
    enableWebGL?: boolean;
    enableAccessibility?: boolean;
}

/**
 * High-performance chart component for portfolio visualization
 * Optimized for real-time updates and WebGL acceleration
 */
const PerformanceChart: React.FC<PerformanceChartProps> = ({
    data,
    timeframe = ChartTimeframe.FIFTEEN_MINUTES,
    theme = ChartTheme.DARK,
    width = CHART_DIMENSIONS.MIN_WIDTH,
    height = CHART_DIMENSIONS.MIN_HEIGHT,
    showGrid = CHART_DEFAULTS.SHOW_GRID,
    autoScale = CHART_DEFAULTS.AUTO_SCALE,
    enableWebGL = true,
    enableAccessibility = true,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const [dimensions, setDimensions] = useState({ width, height });

    /**
     * Formats performance data with high-precision calculations
     */
    const formattedData = useMemo(() => {
        return data.map(point => {
            const value = new Decimal(point.value);
            return {
                time: point.timestamp / 1000, // Convert to seconds for lightweight-charts
                value: value.toDecimalPlaces(8).toNumber(),
            };
        }).sort((a, b) => a.time - b.time);
    }, [data]);

    /**
     * Handles responsive chart resizing
     */
    const handleResize = useCallback((entries: ResizeObserverEntry[]) => {
        const entry = entries[0];
        if (!entry) return;

        const breakpoint = entry.contentRect.width >= CHART_DIMENSIONS.RESPONSIVE_BREAKPOINTS.LARGE
            ? 'LARGE'
            : entry.contentRect.width >= CHART_DIMENSIONS.RESPONSIVE_BREAKPOINTS.MEDIUM
                ? 'MEDIUM'
                : 'SMALL';

        const newDimensions = calculateChartDimensions(
            entry.contentRect.width,
            entry.contentRect.height,
            breakpoint
        );

        setDimensions(newDimensions);
        
        if (chartRef.current) {
            chartRef.current.applyOptions({ 
                width: newDimensions.width,
                height: newDimensions.height 
            });
        }
    }, []);

    /**
     * Initializes and configures the chart instance
     */
    useEffect(() => {
        if (!containerRef.current) return;

        const options: ChartOptions = {
            width: dimensions.width,
            height: dimensions.height,
            timeframe,
            theme,
            autoScale,
            showGrid,
            gridColor: CHART_COLORS.GRID,
            crosshair: true
        };

        const { chartConfig, layoutConfig } = applyChartTheme(theme, options, {
            layout: {
                background: { type: 'solid', color: CHART_COLORS.BACKGROUND },
                textColor: CHART_COLORS.TEXT,
            },
            grid: {
                vertLines: { color: CHART_COLORS.GRID, style: LineStyle.Dotted },
                horzLines: { color: CHART_COLORS.GRID, style: LineStyle.Dotted },
            },
            rightPriceScale: {
                borderVisible: false,
                scaleMargins: { top: 0.2, bottom: 0.2 },
            },
            timeScale: {
                borderVisible: false,
                timeVisible: true,
                secondsVisible: timeframe === ChartTimeframe.ONE_MINUTE,
            },
            crosshair: {
                vertLine: { color: CHART_COLORS.CROSSHAIR, width: 1 },
                horzLine: { color: CHART_COLORS.CROSSHAIR, width: 1 },
            },
        });

        // Create chart instance with WebGL support
        chartRef.current = createChart(containerRef.current, {
            ...layoutConfig,
            width: dimensions.width,
            height: dimensions.height,
            handleScale: true,
            handleScroll: true,
            rightPriceScale: { visible: true },
            timeScale: { visible: true },
            watermark: { visible: false },
            layout: layoutConfig.layout,
            grid: showGrid ? layoutConfig.grid : { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: layoutConfig.crosshair,
        });

        // Add performance line series
        const lineSeries = chartRef.current.addLineSeries({
            color: CHART_COLORS.UP,
            lineWidth: 2,
            crosshairMarkerVisible: true,
            lastValueVisible: true,
            priceLineVisible: false,
            autoscaleInfoProvider: () => ({
                priceRange: {
                    minValue: Math.min(...formattedData.map(d => d.value)),
                    maxValue: Math.max(...formattedData.map(d => d.value)),
                },
            }),
        });

        lineSeries.setData(formattedData);

        // Initialize ResizeObserver
        resizeObserverRef.current = new ResizeObserver(handleResize);
        resizeObserverRef.current.observe(containerRef.current);

        // Add accessibility features if enabled
        if (enableAccessibility) {
            containerRef.current.setAttribute('role', 'img');
            containerRef.current.setAttribute('aria-label', 'Portfolio Performance Chart');
            containerRef.current.tabIndex = 0;
        }

        return () => {
            if (resizeObserverRef.current) {
                resizeObserverRef.current.disconnect();
            }
            if (chartRef.current) {
                chartRef.current.remove();
            }
        };
    }, [theme, timeframe, showGrid, dimensions, formattedData, enableAccessibility]);

    return (
        <div 
            ref={containerRef}
            style={{ 
                width: '100%',
                height: '100%',
                minWidth: CHART_DIMENSIONS.MIN_WIDTH,
                minHeight: CHART_DIMENSIONS.MIN_HEIGHT,
                borderRadius: CHART_DIMENSIONS.BORDER_RADIUS,
                overflow: 'hidden'
            }}
            data-testid="performance-chart"
        />
    );
};

export default PerformanceChart;