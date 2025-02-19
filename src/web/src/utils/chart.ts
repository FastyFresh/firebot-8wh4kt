// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// lightweight-charts v4.0.0
import { ColorType, LayoutOptions } from 'lightweight-charts';
import { 
    ChartTimeframe, 
    ChartTheme, 
    CandlestickData, 
    DepthChartData, 
    ChartOptions, 
    ResponsiveBreakpoint 
} from '../types/chart';
import {
    CHART_DIMENSIONS,
    CHART_COLORS,
    CHART_BREAKPOINTS
} from '../constants/chart';

/**
 * Formats raw market data into candlestick chart format with high precision calculations
 * @param rawData Array of raw market data points
 * @returns Array of formatted CandlestickData objects
 */
export const formatCandlestickData = (rawData: any[]): CandlestickData[] => {
    return rawData.map(data => ({
        time: Math.floor(new Date(data.timestamp).getTime()),
        open: new Decimal(data.open),
        high: new Decimal(data.high),
        low: new Decimal(data.low),
        close: new Decimal(data.close),
        volume: new Decimal(data.volume)
    })).sort((a, b) => a.time - b.time);
};

/**
 * Formats order book data into depth chart format with cumulative volume calculation
 * @param orderBookData Array of order book entries
 * @returns Array of formatted DepthChartData objects
 */
export const formatDepthChartData = (orderBookData: any[]): DepthChartData[] => {
    const bids = orderBookData.filter(order => order.side === 'buy');
    const asks = orderBookData.filter(order => order.side === 'sell');

    const formatSide = (orders: any[], side: 'buy' | 'sell'): DepthChartData[] => {
        let cumulative = new Decimal(0);
        return orders
            .sort((a, b) => side === 'buy' ? 
                new Decimal(b.price).minus(a.price).toNumber() : 
                new Decimal(a.price).minus(b.price).toNumber())
            .map(order => {
                cumulative = cumulative.plus(order.volume);
                return {
                    price: new Decimal(order.price),
                    volume: new Decimal(order.volume),
                    side,
                    cumulativeVolume: cumulative
                };
            });
    };

    return [...formatSide(bids, 'buy'), ...formatSide(asks, 'sell')];
};

/**
 * Calculates optimal chart dimensions based on container size and responsive breakpoint
 * @param containerWidth Container width in pixels
 * @param containerHeight Container height in pixels
 * @param breakpoint Current responsive breakpoint
 * @returns Optimized chart dimensions with responsive configuration
 */
export const calculateChartDimensions = (
    containerWidth: number,
    containerHeight: number,
    breakpoint: ResponsiveBreakpoint
): { width: number; height: number; responsive: any } => {
    // Validate minimum dimensions
    if (containerWidth < CHART_DIMENSIONS.MIN_WIDTH || 
        containerHeight < CHART_DIMENSIONS.MIN_HEIGHT) {
        throw new Error('Container dimensions below minimum requirements');
    }

    // Calculate available space
    const availableWidth = containerWidth - (CHART_DIMENSIONS.PADDING * 2) - (CHART_DIMENSIONS.MARGIN * 2);
    const availableHeight = containerHeight - CHART_DIMENSIONS.HEADER_HEIGHT - 
        CHART_DIMENSIONS.TOOLBAR_HEIGHT - (CHART_DIMENSIONS.PADDING * 2);

    // Apply breakpoint-specific scaling
    let scaleFactor = 1;
    switch (breakpoint) {
        case 'LARGE':
            scaleFactor = 1.2;
            break;
        case 'MEDIUM':
            scaleFactor = 1;
            break;
        case 'SMALL':
            scaleFactor = 0.8;
            break;
    }

    // Calculate dimensions with scaling
    const width = Math.floor(availableWidth * scaleFactor);
    const height = Math.floor(availableHeight * scaleFactor);

    return {
        width,
        height,
        responsive: {
            breakpoint,
            scaleFactor,
            gridGap: CHART_DIMENSIONS.GRID_GAP,
            borderRadius: CHART_DIMENSIONS.BORDER_RADIUS
        }
    };
};

/**
 * Applies optimized theme settings to chart configuration with enhanced contrast
 * @param theme Selected chart theme
 * @param options Base chart options
 * @param layoutOptions Layout configuration options
 * @returns Enhanced chart configuration with theme optimizations
 */
export const applyChartTheme = (
    theme: ChartTheme,
    options: ChartOptions,
    layoutOptions: LayoutOptions
): { chartConfig: ChartOptions; layoutConfig: LayoutOptions } => {
    const isDark = theme === ChartTheme.DARK;
    const colors = CHART_COLORS;

    const chartConfig: ChartOptions = {
        ...options,
        theme,
        gridColor: isDark ? colors.GRID : '#E0E0E0',
        crosshair: true,
        showGrid: true,
        showVolume: true,
        autoScale: true
    };

    const layoutConfig: LayoutOptions = {
        ...layoutOptions,
        background: {
            type: ColorType.Solid,
            color: isDark ? colors.BACKGROUND : '#FFFFFF'
        },
        textColor: isDark ? colors.TEXT : '#333333',
        grid: {
            vertLines: {
                color: isDark ? colors.GRID : '#E0E0E0',
                style: 1
            },
            horzLines: {
                color: isDark ? colors.GRID : '#E0E0E0',
                style: 1
            }
        },
        crosshair: {
            vertLine: {
                color: colors.CROSSHAIR,
                width: 1,
                style: 1
            },
            horzLine: {
                color: colors.CROSSHAIR,
                width: 1,
                style: 1
            }
        },
        rightPriceScale: {
            borderColor: isDark ? colors.GRID : '#E0E0E0',
            textColor: isDark ? colors.TEXT : '#333333'
        },
        timeScale: {
            borderColor: isDark ? colors.GRID : '#E0E0E0',
            textColor: isDark ? colors.TEXT : '#333333',
            secondaryTextColor: isDark ? colors.TEXT_SECONDARY : '#666666'
        },
        watermark: {
            color: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
        }
    };

    return { chartConfig, layoutConfig };
};