// Import decimal.js-light v2.5.1 for precise financial calculations
import Decimal from 'decimal.js-light';

// Global constants for strategy configuration limits
export const MIN_GRID_LEVELS = 5;
export const MAX_GRID_LEVELS = 100;
export const MIN_POSITION_SIZE_BPS = 100; // 1%
export const MAX_POSITION_SIZE_BPS = 5000; // 50%
export const MIN_PROFIT_BPS = 10; // 0.1%
export const MAX_SLIPPAGE_BPS = 1000; // 10%
export const MIN_CONFIDENCE_THRESHOLD = 0.6;
export const MAX_DRAWDOWN_BPS = 2000; // 20%

/**
 * Enumeration of supported trading strategy types
 */
export enum StrategyType {
    GRID = 'GRID',
    ARBITRAGE = 'ARBITRAGE',
    ML = 'ML'
}

/**
 * Enumeration of possible strategy states
 */
export enum StrategyState {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    PAUSED = 'PAUSED',
    ERROR = 'ERROR'
}

/**
 * Base interface for all strategy configurations
 */
export interface BaseStrategyConfig {
    id: string;
    name: string;
    type: StrategyType;
    state: StrategyState;
    tradingPairs: string[];
    performanceScore: Decimal;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Configuration interface for grid trading strategy
 * Extends BaseStrategyConfig with grid-specific parameters
 */
export interface GridStrategyConfig extends BaseStrategyConfig {
    gridLevels: number;
    upperPrice: Decimal;
    lowerPrice: Decimal;
    positionSizeBps: number;
}

/**
 * Configuration interface for arbitrage strategy
 * Extends BaseStrategyConfig with arbitrage-specific parameters
 */
export interface ArbitrageStrategyConfig extends BaseStrategyConfig {
    minProfitBps: number;
    maxSlippageBps: number;
    positionSizeBps: number;
}

/**
 * Configuration interface for machine learning based strategy
 * Extends BaseStrategyConfig with ML-specific parameters
 */
export interface MLStrategyConfig extends BaseStrategyConfig {
    modelType: string;
    confidenceThreshold: number;
    positionSizeBps: number;
    maxDrawdownBps: number;
}

/**
 * Interface for strategy performance metrics
 * Used for tracking and displaying strategy results
 */
export interface StrategyPerformance {
    totalPnL: Decimal;
    totalTrades: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: Decimal;
}

// Type guard functions for strategy configurations
export const isGridStrategy = (strategy: BaseStrategyConfig): strategy is GridStrategyConfig => {
    return strategy.type === StrategyType.GRID;
};

export const isArbitrageStrategy = (strategy: BaseStrategyConfig): strategy is ArbitrageStrategyConfig => {
    return strategy.type === StrategyType.ARBITRAGE;
};

export const isMLStrategy = (strategy: BaseStrategyConfig): strategy is MLStrategyConfig => {
    return strategy.type === StrategyType.ML;
};

// Validation functions for strategy parameters
export const validateGridLevels = (levels: number): boolean => {
    return levels >= MIN_GRID_LEVELS && levels <= MAX_GRID_LEVELS;
};

export const validatePositionSize = (positionSizeBps: number): boolean => {
    return positionSizeBps >= MIN_POSITION_SIZE_BPS && positionSizeBps <= MAX_POSITION_SIZE_BPS;
};

export const validateConfidenceThreshold = (threshold: number): boolean => {
    return threshold >= MIN_CONFIDENCE_THRESHOLD && threshold <= 1;
};

export const validateDrawdown = (drawdownBps: number): boolean => {
    return drawdownBps > 0 && drawdownBps <= MAX_DRAWDOWN_BPS;
};