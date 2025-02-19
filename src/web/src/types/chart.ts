// decimal.js-light v2.5.1 - High-precision decimal calculations for financial data
import Decimal from 'decimal.js-light';

/**
 * Available timeframe options for chart displays
 * Represents standard trading intervals from 1 minute to 1 day
 */
export enum ChartTimeframe {
    ONE_MINUTE = '1m',
    FIVE_MINUTES = '5m',
    FIFTEEN_MINUTES = '15m',
    ONE_HOUR = '1h',
    FOUR_HOURS = '4h',
    ONE_DAY = '1d'
}

/**
 * Chart theme options optimized for trading visibility
 * DARK theme is recommended for reduced eye strain during extended trading sessions
 */
export enum ChartTheme {
    DARK = 'dark',
    LIGHT = 'light'
}

/**
 * Candlestick chart data structure
 * Uses Decimal type for high-precision price and volume calculations
 */
export interface CandlestickData {
    /** Unix timestamp in milliseconds */
    time: number;
    /** Opening price for the period */
    open: Decimal;
    /** Highest price during the period */
    high: Decimal;
    /** Lowest price during the period */
    low: Decimal;
    /** Closing price for the period */
    close: Decimal;
    /** Trading volume for the period */
    volume: Decimal;
}

/**
 * Market depth chart data structure
 * Tracks order book depth with cumulative volume
 */
export interface DepthChartData {
    /** Price level */
    price: Decimal;
    /** Volume at this price level */
    volume: Decimal;
    /** Order side: 'buy' or 'sell' */
    side: 'buy' | 'sell';
    /** Cumulative volume up to this price level */
    cumulativeVolume: Decimal;
}

/**
 * Comprehensive chart configuration options
 * Controls visual appearance and behavior of chart components
 */
export interface ChartOptions {
    /** Chart width in pixels */
    width: number;
    /** Chart height in pixels */
    height: number;
    /** Selected timeframe for data display */
    timeframe: ChartTimeframe;
    /** Visual theme selection */
    theme: ChartTheme;
    /** Enable automatic price scale adjustment */
    autoScale: boolean;
    /** Show volume bars below price chart */
    showVolume: boolean;
    /** Display price/time grid lines */
    showGrid: boolean;
    /** Color of grid lines (CSS color string) */
    gridColor: string;
    /** Enable crosshair price/time markers */
    crosshair: boolean;
}