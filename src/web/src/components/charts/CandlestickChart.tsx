// react v18.0.0
import React, { useEffect, useRef, useState, useMemo } from 'react';
// lightweight-charts v4.0.0
import { createChart, IChartApi, ISeriesApi, ColorType } from 'lightweight-charts';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';

// Internal imports
import { ChartTimeframe, ChartTheme, CandlestickData, ChartOptions } from '../../types/chart';
import { PricePoint } from '../../types/market';
import { formatCandlestickData, calculateChartDimensions, applyChartTheme } from '../../utils/chart';
import { useMarketData } from '../../hooks/useMarketData';
import { CHART_COLORS, CHART_DIMENSIONS, CANDLESTICK_DEFAULTS } from '../../constants/chart';

interface CandlestickChartProps {
    tradingPair: string;
    exchange: Exchange;
    timeframe: ChartTimeframe;
    options?: Partial<ChartOptions>;
}

/**
 * High-performance candlestick chart component with WebGL acceleration
 * and real-time market data updates
 */
export const CandlestickChart: React.FC<CandlestickChartProps> = ({
    tradingPair,
    exchange,
    timeframe,
    options = {}
}) => {
    // Refs for DOM elements and chart instances
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

    // State management
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [error, setError] = useState<Error | null>(null);

    // Subscribe to real-time market data
    const { marketData, isLoading } = useMarketData(tradingPair, exchange, {
        batchUpdates: true,
        updateInterval: 100,
        validateData: true
    });

    // Memoize chart options with theme
    const chartOptions = useMemo(() => {
        const defaultOptions: ChartOptions = {
            width: dimensions.width,
            height: dimensions.height,
            timeframe,
            theme: ChartTheme.DARK,
            autoScale: true,
            showVolume: true,
            showGrid: true,
            gridColor: CHART_COLORS.GRID,
            crosshair: true
        };

        return { ...defaultOptions, ...options };
    }, [dimensions, timeframe, options]);

    /**
     * Initialize chart with WebGL acceleration and WCAG compliance
     */
    const initializeChart = () => {
        if (!chartContainerRef.current) return;

        try {
            // Create chart instance with WebGL
            chartInstanceRef.current = createChart(chartContainerRef.current, {
                width: dimensions.width,
                height: dimensions.height,
                layout: {
                    background: {
                        type: ColorType.Solid,
                        color: CHART_COLORS.BACKGROUND
                    },
                    textColor: CHART_COLORS.TEXT,
                },
                grid: {
                    vertLines: { color: CHART_COLORS.GRID },
                    horzLines: { color: CHART_COLORS.GRID }
                },
                rightPriceScale: {
                    borderColor: CHART_COLORS.GRID,
                    scaleMargins: {
                        top: 0.2,
                        bottom: 0.2
                    }
                },
                timeScale: {
                    borderColor: CHART_COLORS.GRID,
                    timeVisible: true,
                    secondsVisible: false
                },
                crosshair: {
                    vertLine: {
                        color: CHART_COLORS.CROSSHAIR,
                        width: 1,
                        style: 1
                    },
                    horzLine: {
                        color: CHART_COLORS.CROSSHAIR,
                        width: 1,
                        style: 1
                    }
                },
                handleScroll: {
                    mouseWheel: true,
                    pressedMouseMove: true,
                    horzTouchDrag: true,
                    vertTouchDrag: true
                },
                handleScale: {
                    axisPressedMouseMove: true,
                    mouseWheel: true,
                    pinch: true
                }
            });

            // Initialize candlestick series
            candlestickSeriesRef.current = chartInstanceRef.current.addCandlestickSeries({
                upColor: CANDLESTICK_DEFAULTS.UPWICK_COLOR,
                downColor: CANDLESTICK_DEFAULTS.DOWNWICK_COLOR,
                borderVisible: CANDLESTICK_DEFAULTS.BORDER_VISIBLE,
                wickVisible: CANDLESTICK_DEFAULTS.WICK_VISIBLE
            });

            // Initialize volume series if enabled
            if (chartOptions.showVolume) {
                volumeSeriesRef.current = chartInstanceRef.current.addHistogramSeries({
                    color: CHART_COLORS.VOLUME_UP,
                    priceFormat: {
                        type: 'volume'
                    },
                    priceScaleId: ''
                });
            }

            // Apply WCAG-compliant theme
            const { chartConfig, layoutConfig } = applyChartTheme(
                chartOptions.theme,
                chartOptions,
                chartInstanceRef.current.options()
            );

            chartInstanceRef.current.applyOptions(layoutConfig);

        } catch (err) {
            setError(err as Error);
            console.error('Chart initialization failed:', err);
        }
    };

    /**
     * Update chart data with performance optimization
     */
    const updateChartData = (data: PricePoint[]) => {
        if (!candlestickSeriesRef.current || !data.length) return;

        try {
            // Format data with high precision calculations
            const candlestickData = formatCandlestickData(data);

            // Update series with requestAnimationFrame for smooth rendering
            requestAnimationFrame(() => {
                candlestickSeriesRef.current?.setData(candlestickData);
                
                if (volumeSeriesRef.current && chartOptions.showVolume) {
                    const volumeData = candlestickData.map(candle => ({
                        time: candle.time,
                        value: candle.volume.toNumber(),
                        color: new Decimal(candle.close).gte(candle.open) 
                            ? CHART_COLORS.VOLUME_UP 
                            : CHART_COLORS.VOLUME_DOWN
                    }));
                    volumeSeriesRef.current.setData(volumeData);
                }
            });

        } catch (err) {
            setError(err as Error);
            console.error('Chart data update failed:', err);
        }
    };

    /**
     * Handle responsive chart resizing
     */
    const handleResize = () => {
        if (!chartContainerRef.current || !chartInstanceRef.current) return;

        const { width, height } = calculateChartDimensions(
            chartContainerRef.current.clientWidth,
            chartContainerRef.current.clientHeight,
            'MEDIUM'
        );

        setDimensions({ width, height });
        chartInstanceRef.current.resize(width, height);
    };

    // Initialize chart on mount
    useEffect(() => {
        initializeChart();

        const resizeObserver = new ResizeObserver(handleResize);
        if (chartContainerRef.current) {
            resizeObserver.observe(chartContainerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            chartInstanceRef.current?.remove();
        };
    }, []);

    // Update chart when market data changes
    useEffect(() => {
        if (marketData) {
            updateChartData([marketData]);
        }
    }, [marketData]);

    // Update chart options when they change
    useEffect(() => {
        if (chartInstanceRef.current) {
            const { chartConfig, layoutConfig } = applyChartTheme(
                chartOptions.theme,
                chartOptions,
                chartInstanceRef.current.options()
            );
            chartInstanceRef.current.applyOptions(layoutConfig);
        }
    }, [chartOptions]);

    if (error) {
        return (
            <div className="chart-error" role="alert" aria-live="polite">
                <p>Failed to load chart: {error.message}</p>
            </div>
        );
    }

    return (
        <div 
            ref={chartContainerRef}
            className="candlestick-chart"
            style={{ 
                width: '100%', 
                height: '100%',
                minHeight: CHART_DIMENSIONS.MIN_HEIGHT 
            }}
            role="img"
            aria-label={`Candlestick chart for ${tradingPair}`}
        >
            {isLoading && (
                <div 
                    className="chart-loading"
                    role="status"
                    aria-live="polite"
                >
                    Loading chart data...
                </div>
            )}
        </div>
    );
};

export default CandlestickChart;