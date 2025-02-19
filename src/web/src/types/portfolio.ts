// decimal.js-light v2.5.1 - High-precision decimal calculations
import Decimal from 'decimal.js-light';
import { Exchange } from './market';

// Global constants for portfolio management
export const MAX_POSITION_SIZE_PERCENT = 25;
export const DEFAULT_RISK_LEVEL = 10;
export const MIN_PORTFOLIO_VALUE = new Decimal(100);
export const MAX_DRAWDOWN_PERCENT = 30;

/**
 * Supported order types for position management
 */
export enum OrderType {
    MARKET = 'MARKET',
    LIMIT = 'LIMIT',
    STOP_LOSS = 'STOP_LOSS',
    TAKE_PROFIT = 'TAKE_PROFIT'
}

/**
 * Comprehensive portfolio state and configuration
 * Tracks all positions, risk parameters, and performance metrics
 */
export interface Portfolio {
    id: string;
    walletAddress: string;
    balance: Decimal;
    positions: Position[];
    riskParameters: RiskParameters;
    metrics: PortfolioMetrics;
    assetAllocations: AssetAllocation[];
    lastUpdated: Date;
}

/**
 * Detailed trading position tracking with risk management
 * Includes entry/exit prices, P&L calculations, and risk limits
 */
export interface Position {
    id: string;
    portfolioId: string;
    tradingPair: string;
    exchange: Exchange;
    orderType: OrderType;
    size: Decimal;
    entryPrice: Decimal;
    currentPrice: Decimal;
    unrealizedPnL: Decimal;
    realizedPnL: Decimal;
    stopLossPrice: Decimal;
    takeProfitPrice: Decimal;
}

/**
 * Comprehensive risk management parameters
 * Controls position sizing, stop-loss levels, and drawdown limits
 */
export interface RiskParameters {
    maxPositionSize: Decimal;
    stopLossPercent: Decimal;
    takeProfitPercent: Decimal;
    maxDrawdownPercent: Decimal;
    riskLevel: number;
    maxLeverage: Decimal;
    marginCallLevel: Decimal;
}

/**
 * Advanced portfolio performance metrics
 * Tracks P&L, risk-adjusted returns, and trading statistics
 */
export interface PortfolioMetrics {
    totalValue: Decimal;
    dailyPnL: Decimal;
    dailyPnLPercent: Decimal;
    totalPnL: Decimal;
    totalPnLPercent: Decimal;
    sharpeRatio: Decimal;
    maxDrawdown: Decimal;
    volatility: Decimal;
    beta: Decimal;
    winRate: Decimal;
}

/**
 * Detailed asset distribution tracking with rebalancing parameters
 * Manages portfolio composition and rebalancing thresholds
 */
export interface AssetAllocation {
    asset: string;
    amount: Decimal;
    value: Decimal;
    percentage: Decimal;
    targetPercentage: Decimal;
    rebalanceThreshold: Decimal;
}