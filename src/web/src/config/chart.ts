import { ChartOptions, ChartTheme } from '../types/chart';
import { ColorType } from 'lightweight-charts'; // v4.0.0

/**
 * Default chart configuration with optimal settings for trading visualization
 * Provides base configuration for all chart types (candlestick, depth, performance)
 */
export const DEFAULT_CHART_OPTIONS: ChartOptions = {
    width: 800,
    height: 400,
    timeframe: 'ONE_HOUR',
    theme: 'DARK',
    autoScale: true,
    showVolume: true,
    showGrid: true,
    crosshair: {
        mode: 'normal',
        style: 'solid'
    },
    watermark: {
        visible: true,
        text: 'AI Trading Bot',
        fontSize: 24,
        opacity: 0.1
    }
};

/**
 * Theme configurations optimized for trading visibility
 * Dark theme is optimized for reduced eye strain during extended sessions
 */
export const CHART_THEMES = {
    DARK: {
        background: '#121212',
        textColor: '#FFFFFF',
        gridColor: '#2C2C2C',
        upColor: '#00C853',
        downColor: '#FF3D00',
        volumeUpColor: 'rgba(0, 200, 83, 0.5)',
        volumeDownColor: 'rgba(255, 61, 0, 0.5)',
        crosshairColor: '#B3B3B3',
        watermarkColor: '#333333',
        legendBackground: '#1E1E1E',
        legendTextColor: '#B3B3B3',
        scaleBorderColor: '#333333',
        scaleTextColor: '#B3B3B3'
    },
    LIGHT: {
        background: '#FFFFFF',
        textColor: '#131722',
        gridColor: '#F0F3FA',
        upColor: '#089981',
        downColor: '#F23645',
        volumeUpColor: 'rgba(8, 153, 129, 0.5)',
        volumeDownColor: 'rgba(242, 54, 69, 0.5)',
        crosshairColor: '#737375',
        watermarkColor: '#F0F3FA',
        legendBackground: '#FFFFFF',
        legendTextColor: '#131722',
        scaleBorderColor: '#F0F3FA',
        scaleTextColor: '#131722'
    }
};

/**
 * Chart dimension constraints ensuring optimal display across different screen sizes
 * Maintains professional trading view standards for aspect ratios
 */
export const CHART_DIMENSIONS = {
    MIN_WIDTH: 800,
    MIN_HEIGHT: 400,
    MAX_WIDTH: 3840,
    MAX_HEIGHT: 2160,
    ASPECT_RATIO: {
        MIN: 1.5,
        MAX: 3
    }
};

/**
 * Retrieves theme configuration with fallback to dark theme
 * Ensures consistent styling across all chart components
 * @param theme - Selected chart theme
 * @returns Theme configuration object with colors and styles
 */
export const getChartThemeConfig = (theme: ChartTheme): Record<string, ColorType> => {
    const themeConfig = CHART_THEMES[theme] || CHART_THEMES.DARK;
    
    // Validate theme configuration
    if (!themeConfig) {
        console.warn(`Theme ${theme} not found, falling back to dark theme`);
        return CHART_THEMES.DARK;
    }
    
    return themeConfig;
};

/**
 * Validates and adjusts chart dimensions to maintain proper aspect ratio
 * Ensures charts remain within acceptable size bounds for trading visualization
 * @param width - Desired chart width
 * @param height - Desired chart height
 * @returns Validated width and height values
 */
export const validateChartDimensions = (
    width: number,
    height: number
): { width: number; height: number } => {
    // Input validation
    if (typeof width !== 'number' || typeof height !== 'number') {
        throw new Error('Chart dimensions must be numbers');
    }

    // Clamp dimensions to min/max values
    let validatedWidth = Math.min(Math.max(width, CHART_DIMENSIONS.MIN_WIDTH), CHART_DIMENSIONS.MAX_WIDTH);
    let validatedHeight = Math.min(Math.max(height, CHART_DIMENSIONS.MIN_HEIGHT), CHART_DIMENSIONS.MAX_HEIGHT);

    // Calculate and validate aspect ratio
    const aspectRatio = validatedWidth / validatedHeight;
    
    if (aspectRatio < CHART_DIMENSIONS.ASPECT_RATIO.MIN) {
        validatedHeight = validatedWidth / CHART_DIMENSIONS.ASPECT_RATIO.MIN;
    } else if (aspectRatio > CHART_DIMENSIONS.ASPECT_RATIO.MAX) {
        validatedHeight = validatedWidth / CHART_DIMENSIONS.ASPECT_RATIO.MAX;
    }

    return {
        width: Math.floor(validatedWidth),
        height: Math.floor(validatedHeight)
    };
};