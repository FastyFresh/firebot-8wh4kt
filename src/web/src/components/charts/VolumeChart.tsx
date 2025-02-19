// lightweight-charts v4.0.0 - High-performance WebGL-accelerated charting
import { createChart, HistogramData, IChartApi, DeepPartial, HistogramSeriesOptions } from 'lightweight-charts';
// react v18.0.0 - React core functionality and hooks
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// decimal.js-light v2.5.1 - High-precision calculations
import Decimal from 'decimal.js-light';

import { ChartTimeframe, ChartTheme, ChartOptions } from '../../types/chart';
import { MarketData, PricePoint } from '../../types/market';
import { calculateChartDimensions, applyChartTheme } from '../../utils/chart';
import { CHART_COLORS, CHART_DEFAULTS } from '../../constants/chart';

interface VolumeChartProps {
    marketData: PricePoint[];
    timeframe: ChartTimeframe;
    theme: ChartTheme;
    width: number;
    height: number;
    options?: DeepPartial<HistogramSeriesOptions>;
}

export const VolumeChart: React.FC<VolumeChartProps> = ({
    marketData,
    timeframe,
    theme,
    width,
    height,
    options = {}
}) => {
    // Chart instance and container refs
    const chartRef = useRef<IChartApi | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // State management
    const [volumeData, setVolumeData] = useState<HistogramData[]>([]);
    const [isInitialized, setIsInitialized] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    // Memoized chart options
    const chartOptions = useMemo(() => ({
        width,
        height,
        layout: {
            background: {
                color: theme === ChartTheme.DARK ? CHART_COLORS.BACKGROUND : '#FFFFFF'
            },
            textColor: theme === ChartTheme.DARK ? CHART_COLORS.TEXT : '#333333',
        },
        grid: {
            vertLines: { visible: false },
            horzLines: { visible: false }
        },
        rightPriceScale: {
            visible: false
        },
        timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: timeframe === ChartTimeframe.ONE_MINUTE
        },
    }), [width, height, theme, timeframe]);

    // Format volume data with high precision
    const formatVolumeData = useCallback((data: PricePoint[]): HistogramData[] => {
        try {
            return data.map(point => ({
                time: point.timestamp.getTime() / 1000,
                value: new Decimal(point.volume).toNumber(),
                color: new Decimal(point.close).greaterThanOrEqualTo(point.open) 
                    ? CHART_COLORS.VOLUME_UP 
                    : CHART_COLORS.VOLUME_DOWN
            })).sort((a, b) => (a.time as number) - (b.time as number));
        } catch (err) {
            console.error('Error formatting volume data:', err);
            setError(err as Error);
            return [];
        }
    }, []);

    // Debounced chart update function
    const updateChartData = useCallback((chart: IChartApi, data: HistogramData[]) => {
        if (!chart || !data.length) return;

        const series = chart.addHistogramSeries({
            color: CHART_COLORS.VOLUME_UP,
            priceFormat: {
                type: 'volume',
                precision: 6,
            },
            priceScaleId: '',
            ...options
        });

        series.setData(data);

        // Optimize visible range
        const timeRange = {
            from: (data[0]?.time || 0) as number,
            to: (data[data.length - 1]?.time || 0) as number
        };
        chart.timeScale().setVisibleRange(timeRange);

        return () => {
            chart.removeSeries(series);
        };
    }, [options]);

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current || isInitialized) return;

        try {
            chartRef.current = createChart(containerRef.current, chartOptions);
            setIsInitialized(true);
        } catch (err) {
            console.error('Error initializing chart:', err);
            setError(err as Error);
        }

        return () => {
            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
            }
        };
    }, [chartOptions, isInitialized]);

    // Update data and handle theme changes
    useEffect(() => {
        if (!chartRef.current || !isInitialized) return;

        const formattedData = formatVolumeData(marketData);
        let cleanup: (() => void) | undefined;

        try {
            cleanup = updateChartData(chartRef.current, formattedData);
            setVolumeData(formattedData);
        } catch (err) {
            console.error('Error updating chart data:', err);
            setError(err as Error);
        }

        return () => {
            if (cleanup) cleanup();
        };
    }, [marketData, isInitialized, formatVolumeData, updateChartData]);

    // Handle resize
    useEffect(() => {
        if (!chartRef.current) return;

        const handleResize = () => {
            if (containerRef.current && chartRef.current) {
                const dimensions = calculateChartDimensions(
                    containerRef.current.clientWidth,
                    containerRef.current.clientHeight,
                    width >= 1920 ? 'LARGE' : width >= 1440 ? 'MEDIUM' : 'SMALL'
                );
                chartRef.current.applyOptions({ width: dimensions.width, height: dimensions.height });
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [width]);

    // Error fallback
    if (error) {
        return (
            <div className="volume-chart-error" style={{ width, height }}>
                <p>Error loading volume chart. Please refresh the page.</p>
                <small>{error.message}</small>
            </div>
        );
    }

    return (
        <div 
            ref={containerRef} 
            className="volume-chart-container"
            style={{ 
                width, 
                height,
                backgroundColor: theme === ChartTheme.DARK ? CHART_COLORS.BACKGROUND : '#FFFFFF'
            }}
        />
    );
};

export default React.memo(VolumeChart);