import { ChartTimeframe } from '../types/chart';

/**
 * Chart dimensions and responsive breakpoints
 * Optimized for trading platform requirements with minimum viewport of 1920x1080
 */
export const CHART_DIMENSIONS = {
    MIN_WIDTH: 800,
    MIN_HEIGHT: 400,
    PADDING: 20,
    MARGIN: 10,
    HEADER_HEIGHT: 40,
    TOOLBAR_HEIGHT: 35,
    GRID_GAP: 15,
    BORDER_RADIUS: 4,
    RESPONSIVE_BREAKPOINTS: {
        LARGE: 1920,  // Optimized for ultra-wide monitors
        MEDIUM: 1440, // Standard desktop display
        SMALL: 1024   // Minimum supported width
    }
} as const;

/**
 * Dark theme optimized color palette
 * Designed for maximum readability and reduced eye strain during extended trading sessions
 */
export const CHART_COLORS = {
    BACKGROUND: '#121212',        // Dark background for reduced eye strain
    GRID: '#2C2C2C',             // Subtle grid lines
    TEXT: '#FFFFFF',             // High contrast primary text
    TEXT_SECONDARY: '#B3B3B3',   // Secondary information
    UP: '#00C853',              // Positive price movement
    DOWN: '#FF3D00',            // Negative price movement
    VOLUME_UP: 'rgba(0, 200, 83, 0.5)',    // Semi-transparent volume bars for up moves
    VOLUME_DOWN: 'rgba(255, 61, 0, 0.5)',  // Semi-transparent volume bars for down moves
    CROSSHAIR: 'rgba(255, 255, 255, 0.3)', // Subtle crosshair overlay
    TOOLTIP_BACKGROUND: 'rgba(18, 18, 18, 0.9)', // Semi-transparent tooltip
    SELECTION_BACKGROUND: 'rgba(255, 255, 255, 0.1)' // Subtle selection highlight
} as const;

/**
 * Standard timeframe options for chart displays
 * Mapped to ChartTimeframe enum values for type safety
 */
export const CHART_TIMEFRAMES = {
    ONE_MIN: ChartTimeframe.ONE_MINUTE,
    FIVE_MIN: ChartTimeframe.FIVE_MINUTES,
    FIFTEEN_MIN: ChartTimeframe.FIFTEEN_MINUTES,
    ONE_HOUR: ChartTimeframe.ONE_HOUR,
    FOUR_HOUR: ChartTimeframe.FOUR_HOURS,
    ONE_DAY: ChartTimeframe.ONE_DAY
} as const;

/**
 * Default chart configuration
 * Optimized settings for trading visualization
 */
export const CHART_DEFAULTS = {
    TIMEFRAME: 'FIFTEEN_MIN',
    THEME: 'DARK',
    AUTO_SCALE: true,
    SHOW_VOLUME: true,
    SHOW_GRID: true,
    CROSSHAIR: true,
    ANIMATION_DURATION: 300,    // Smooth transitions in milliseconds
    TOOLTIP_DELAY: 100,         // Responsive tooltip display
    ZOOM_FACTOR: 1.2,           // Smooth zoom scaling
    MIN_ZOOM_LEVEL: 0.5,        // Prevent excessive zoom out
    MAX_ZOOM_LEVEL: 5,          // Limit maximum zoom
    DEFAULT_VISIBLE_CANDLES: 100 // Initial candle display count
} as const;

/**
 * Candlestick chart visualization defaults
 * Optimized for clear price action visibility
 */
export const CANDLESTICK_DEFAULTS = {
    UPWICK_COLOR: '#00C853',    // Matches CHART_COLORS.UP
    DOWNWICK_COLOR: '#FF3D00',  // Matches CHART_COLORS.DOWN
    BORDER_VISIBLE: true,
    WICK_VISIBLE: true,
    BODY_WIDTH: 6,              // Optimal width for visibility
    WICK_WIDTH: 2,              // Clear wick display
    MIN_HEIGHT: 1,              // Minimum candle body height
    HIGHLIGHT_OPACITY: 0.8,     // Hover highlight intensity
    HOVER_EFFECT: true          // Enable interactive highlighting
} as const;

/**
 * Depth chart visualization defaults
 * Optimized for order book visualization
 */
export const DEPTH_CHART_DEFAULTS = {
    BID_COLOR: 'rgba(0, 200, 83, 0.2)',    // Semi-transparent bid area
    ASK_COLOR: 'rgba(255, 61, 0, 0.2)',    // Semi-transparent ask area
    BID_LINE_COLOR: '#00C853',             // Solid bid line
    ASK_LINE_COLOR: '#FF3D00',             // Solid ask line
    LINE_WIDTH: 2,                         // Clear line visibility
    AREA_OPACITY: 0.2,                     // Subtle area fill
    HOVER_OPACITY: 0.4,                    // Enhanced hover state
    CURVE_TENSION: 0.4,                    // Smooth curve rendering
    PRICE_PRECISION: 6,                    // Decimal places for price
    VOLUME_PRECISION: 4                    // Decimal places for volume
} as const;