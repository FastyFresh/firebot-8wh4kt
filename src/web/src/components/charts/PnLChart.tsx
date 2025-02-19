import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart, LineStyle, IChartApi, ISeriesApi, DeepPartial } from 'lightweight-charts'; // v4.0.0
import Decimal from 'decimal.js-light'; // v2.5.1
import debounce from 'lodash/debounce'; // v4.17.21

import { ChartTimeframe, ChartTheme, ChartOptions } from '../../types/chart';
import { PortfolioMetrics } from '../../types/portfolio';
import { calculateChartDimensions, applyChartTheme, formatChartData } from '../../utils/chart';
import { CHART_COLORS, CHART_DIMENSIONS } from '../../constants/chart';

interface PnLChartProps {
    pnlHistory: PortfolioMetrics[];
    timeframe: ChartTimeframe;
    theme: ChartTheme;
    width: number;
    height: number;
    showUnrealized: boolean;
    customOptions?: DeepPartial<ChartOptions>;
    onDataPointHover?: (point: PortfolioMetrics | null) => void;
    className?: string;
    ariaLabel?: string;
}

interface FormattedDataPoint {
    time: number;
    value: number;
}

const PnLChart: React.FC<PnLChartProps> = ({
    pnlHistory,
    timeframe,
    theme,
    width,
    height,
    showUnrealized = true,
    customOptions,
    onDataPointHover,
    className = '',
    ariaLabel = 'Portfolio PnL Chart'
}) => {
    // Chart refs and state
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Memoized data formatting
    const formattedData = useMemo(() => {
        try {
            return pnlHistory.map(point => ({
                time: Math.floor(new Date(point.timestamp).getTime() / 1000),
                value: showUnrealized
                    ? point.totalPnL.plus(point.unrealizedPnL).toNumber()
                    : point.totalPnL.toNumber()
            })).sort((a, b) => a.time - b.time);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Data formatting error'));
            return [];
        }
    }, [pnlHistory, showUnrealized]);

    // Chart initialization
    useEffect(() => {
        if (!containerRef.current) return;

        try {
            // Create chart instance
            const chart = createChart(containerRef.current, {
                width,
                height,
                layout: {
                    background: { color: theme === ChartTheme.DARK ? CHART_COLORS.BACKGROUND : '#FFFFFF' },
                    textColor: theme === ChartTheme.DARK ? CHART_COLORS.TEXT : '#333333',
                },
                grid: {
                    vertLines: { color: CHART_COLORS.GRID },
                    horzLines: { color: CHART_COLORS.GRID },
                },
                rightPriceScale: {
                    borderVisible: false,
                    scaleMargins: {
                        top: 0.1,
                        bottom: 0.1,
                    },
                },
                timeScale: {
                    borderVisible: false,
                    timeVisible: true,
                    secondsVisible: false,
                },
                crosshair: {
                    vertLine: {
                        color: CHART_COLORS.CROSSHAIR,
                        width: 1,
                        style: LineStyle.Dashed,
                    },
                    horzLine: {
                        color: CHART_COLORS.CROSSHAIR,
                        width: 1,
                        style: LineStyle.Dashed,
                    },
                },
                ...customOptions,
            });

            // Create line series
            const lineSeries = chart.addLineSeries({
                color: CHART_COLORS.UP,
                lineWidth: 2,
                crosshairMarkerVisible: true,
                lastValueVisible: true,
                priceLineVisible: false,
                autoscaleInfoProvider: () => ({
                    priceRange: {
                        minValue: Math.min(...formattedData.map(d => d.value)) * 1.1,
                        maxValue: Math.max(...formattedData.map(d => d.value)) * 1.1,
                    },
                }),
            });

            // Set data
            lineSeries.setData(formattedData);

            // Store refs
            chartRef.current = chart;
            lineSeriesRef.current = lineSeries;

            // Setup hover handler
            chart.subscribeCrosshairMove(param => {
                if (onDataPointHover && param.time) {
                    const point = pnlHistory.find(p => 
                        Math.floor(new Date(p.timestamp).getTime() / 1000) === param.time
                    );
                    onDataPointHover(point || null);
                }
            });

            setIsLoading(false);

            // Cleanup
            return () => {
                chart.remove();
                chartRef.current = null;
                lineSeriesRef.current = null;
            };
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Chart initialization error'));
            setIsLoading(false);
        }
    }, [width, height, theme]);

    // Handle data updates
    useEffect(() => {
        if (lineSeriesRef.current && formattedData.length > 0) {
            lineSeriesRef.current.setData(formattedData);
        }
    }, [formattedData]);

    // Handle resize
    const handleResize = useCallback(debounce((width: number, height: number) => {
        if (chartRef.current) {
            const dimensions = calculateChartDimensions(
                width,
                height,
                width >= CHART_DIMENSIONS.RESPONSIVE_BREAKPOINTS.LARGE ? 'LARGE' :
                width >= CHART_DIMENSIONS.RESPONSIVE_BREAKPOINTS.MEDIUM ? 'MEDIUM' : 'SMALL'
            );
            chartRef.current.resize(dimensions.width, dimensions.height);
        }
    }, 100), []);

    useEffect(() => {
        handleResize(width, height);
    }, [width, height, handleResize]);

    // Error state
    if (error) {
        return (
            <div className={`pnl-chart-error ${className}`} role="alert">
                Error loading chart: {error.message}
            </div>
        );
    }

    // Loading state
    if (isLoading) {
        return (
            <div className={`pnl-chart-loading ${className}`} role="status">
                Loading chart...
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`pnl-chart ${className}`}
            aria-label={ariaLabel}
            role="img"
            style={{
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: theme === ChartTheme.DARK ? CHART_COLORS.BACKGROUND : '#FFFFFF',
                borderRadius: CHART_DIMENSIONS.BORDER_RADIUS,
                overflow: 'hidden',
            }}
        />
    );
};

export default PnLChart;