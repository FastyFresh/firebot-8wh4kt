// decimal.js-light v2.5.1 - High-precision decimal calculations with minimal bundle size
import Decimal from 'decimal.js-light';

// Global constants for price and volume precision
export const MIN_PRICE_PRECISION = 8;
export const MIN_VOLUME_PRECISION = 6;

/**
 * Supported decentralized exchanges in the system
 */
export enum Exchange {
    JUPITER = 'JUPITER',
    PUMP_FUN = 'PUMP_FUN',
    DRIFT = 'DRIFT'
}

/**
 * Market data point-in-time representation
 * Contains current price and volume with high-precision decimal values
 */
export interface MarketData {
    id: string;
    tradingPair: string;
    exchange: Exchange;
    price: Decimal;
    volume: Decimal;
    timestamp: Date;
}

/**
 * Single level in the order book
 * Represents a price level with its corresponding size
 */
export interface OrderBookLevel {
    price: Decimal;
    size: Decimal;
}

/**
 * Complete order book representation for a trading pair
 * Contains sorted arrays of bids (descending) and asks (ascending)
 */
export interface OrderBook {
    tradingPair: string;
    exchange: Exchange;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    timestamp: Date;
}

/**
 * Cumulative market depth at a specific price level
 * Used for market depth chart visualization
 */
export interface MarketDepth {
    price: Decimal;
    totalSize: Decimal;
}

/**
 * OHLCV (Open, High, Low, Close, Volume) price data point
 * Used for candlestick chart visualization with high-precision values
 */
export interface PricePoint {
    timestamp: Date;
    open: Decimal;
    high: Decimal;
    low: Decimal;
    close: Decimal;
    volume: Decimal;
}