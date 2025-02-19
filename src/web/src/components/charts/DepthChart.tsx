import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { createChart, IChartApi, DeepPartial, ChartOptions, AreaSeriesOptions } from 'lightweight-charts'; // v4.0.0
import Decimal from 'decimal.js-light'; // v2.5.1
import debounce from 'lodash/debounce'; // v4.17.21

import { DepthChartData } from '../../types/chart';
import { OrderBook } from '../../types/market';
import { getChartThemeConfig } from '../../config/chart';
import { validateChartDimensions } from '../../utils/validation';

interface DepthChartProps {
    orderBook: OrderBook;
    width: number;
    height: number;
    theme: 'dark' | 'light';
    precision: number;
    onHover?: (price: Decimal, volume: Decimal) => void;
    onResize?: (dimensions: { width: number; height: number }) => void;
    accessibilityLabel?: string;
}

/**
 * High-performance market depth visualization component
 * Renders cumulative bid/ask volumes with WebGL acceleration
 */
const DepthChart: React.FC<DepthChartProps> = ({
    orderBook,
    width,
    height,
    theme = 'dark',
    precision = 6,
    onHover,
    onResize,
    accessibilityLabel = 'Market Depth Chart'
}) => {
    // Refs for chart instance and container
    const chartRef = useRef<IChartApi | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Process order book data with high-precision calculations
    const processOrderBookData = useMemo(() => {
        if (!orderBook?.bids?.length && !orderBook?.asks?.length) {
            return [];
        }

        const data: DepthChartData[] = [];
        let cumulativeVolume = new Decimal(0);

        // Process bids (buy orders)
        orderBook.bids
            .sort((a, b) => b.price.minus(a.price).toNumber())
            .forEach(bid => {
                cumulativeVolume = cumulativeVolume.plus(bid.size);
                data.push({
                    price: bid.price,
                    volume: bid.size,
                    cumulativeVolume,
                    side: 'buy'
                });
            });

        // Reset cumulative volume for asks
        cumulativeVolume = new Decimal(0);

        // Process asks (sell orders)
        orderBook.asks
            .sort((a, b) => a.price.minus(b.price).toNumber())
            .forEach(ask => {
                cumulativeVolume = cumulativeVolume.plus(ask.size);
                data.push({
                    price: ask.price,
                    volume: ask.size,
                    cumulativeVolume,
                    side: 'sell'
                });
            });

        return data;
    }, [orderBook]);

    // Debounced chart update function for performance
    const updateChartData = useCallback(
        debounce((data: DepthChartData[], chart: IChartApi) => {
            if (!chart || !data.length) return;

            const themeConfig = getChartThemeConfig(theme);
            const bidData = data.filter(d => d.side === 'buy');
            const askData = data.filter(d => d.side === 'sell');

            // Configure series options
            const seriesOptions: DeepPartial<AreaSeriesOptions> = {
                lineWidth: 2,
                priceFormat: {
                    type: 'price',
                    precision,
                    minMove: 1 / Math.pow(10, precision),
                },
                lastValueVisible: true,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 4,
            };

            // Clear existing series
            chart.removeSeries();

            // Add bid series
            const bidSeries = chart.addAreaSeries({
                ...seriesOptions,
                topColor: themeConfig.volumeUpColor,
                bottomColor: `${themeConfig.volumeUpColor}00`,
                lineColor: themeConfig.upColor,
            });

            // Add ask series
            const askSeries = chart.addAreaSeries({
                ...seriesOptions,
                topColor: themeConfig.volumeDownColor,
                bottomColor: `${themeConfig.volumeDownColor}00`,
                lineColor: themeConfig.downColor,
            });

            // Set data with price formatting
            bidSeries.setData(
                bidData.map(d => ({
                    time: d.price.toNumber(),
                    value: d.cumulativeVolume.toNumber(),
                }))
            );

            askSeries.setData(
                askData.map(d => ({
                    time: d.price.toNumber(),
                    value: d.cumulativeVolume.toNumber(),
                }))
            );

            // Fit content
            chart.timeScale().fitContent();
        }, 100),
        [theme, precision]
    );

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return;

        // Validate and adjust dimensions
        const { width: validWidth, height: validHeight } = validateChartDimensions(width, height);

        // Create chart instance with theme configuration
        const themeConfig = getChartThemeConfig(theme);
        const chartOptions: DeepPartial<ChartOptions> = {
            width: validWidth,
            height: validHeight,
            layout: {
                background: {
                    color: themeConfig.background,
                },
                textColor: themeConfig.textColor,
            },
            grid: {
                vertLines: {
                    color: themeConfig.gridColor,
                },
                horzLines: {
                    color: themeConfig.gridColor,
                },
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    color: themeConfig.crosshairColor,
                    width: 1,
                    style: 2,
                },
                horzLine: {
                    color: themeConfig.crosshairColor,
                    width: 1,
                    style: 2,
                },
            },
            rightPriceScale: {
                borderColor: themeConfig.scaleBorderColor,
                textColor: themeConfig.scaleTextColor,
            },
            timeScale: {
                borderColor: themeConfig.scaleBorderColor,
                textColor: themeConfig.scaleTextColor,
            },
        };

        chartRef.current = createChart(containerRef.current, chartOptions);

        // Handle hover events
        if (onHover) {
            chartRef.current.subscribeCrosshairMove(param => {
                if (param.point) {
                    const price = new Decimal(param.time || 0);
                    const volume = new Decimal(param.seriesPrices.values().next().value || 0);
                    onHover(price, volume);
                }
            });
        }

        // Cleanup
        return () => {
            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
            }
        };
    }, [width, height, theme, onHover]);

    // Update chart data when order book changes
    useEffect(() => {
        if (chartRef.current && processOrderBookData.length) {
            updateChartData(processOrderBookData, chartRef.current);
        }
    }, [processOrderBookData, updateChartData]);

    // Handle resize events
    useEffect(() => {
        if (!chartRef.current) return;

        const handleResize = debounce(() => {
            if (!containerRef.current || !chartRef.current) return;

            const { width: validWidth, height: validHeight } = validateChartDimensions(width, height);
            chartRef.current.resize(validWidth, validHeight);
            onResize?.({ width: validWidth, height: validHeight });
        }, 100);

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [width, height, onResize]);

    return (
        <div
            ref={containerRef}
            aria-label={accessibilityLabel}
            role="img"
            style={{ position: 'relative' }}
        />
    );
};

export default React.memo(DepthChart);