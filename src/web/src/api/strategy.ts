import Decimal from 'decimal.js-light'; // v2.5.1
import { apiService } from '../services/api';
import { API_ENDPOINTS } from '../constants/api';
import { validateStrategy } from '../utils/validation';
import {
    BaseStrategyConfig,
    StrategyType,
    StrategyState,
    StrategyPerformance,
    GridStrategyConfig,
    ArbitrageStrategyConfig,
    MLStrategyConfig,
    isGridStrategy,
    isArbitrageStrategy,
    isMLStrategy
} from '../types/strategy';
import { WebSocketMessageType, ApiResponse, PaginatedResponse } from '../types/api';

/**
 * Time frames for strategy performance analysis
 */
export enum PerformanceTimeframe {
    HOUR = '1h',
    DAY = '1d',
    WEEK = '1w',
    MONTH = '1m',
    YEAR = '1y'
}

/**
 * Strategy update subscription options
 */
interface StrategySubscriptionOptions {
    onUpdate: (strategy: BaseStrategyConfig) => void;
    onError?: (error: Error) => void;
    reconnectAttempts?: number;
}

/**
 * Retrieves all configured trading strategies with circuit breaker protection
 * @returns Promise<BaseStrategyConfig[]> List of strategy configurations
 */
export async function getStrategies(): Promise<BaseStrategyConfig[]> {
    const response = await apiService.request<PaginatedResponse<BaseStrategyConfig>>(
        'GET',
        API_ENDPOINTS.STRATEGY.LIST
    );

    return response.data.items.map(strategy => {
        validateStrategy(strategy);
        return strategy;
    });
}

/**
 * Creates a new trading strategy with comprehensive validation
 * @param config Strategy configuration
 * @returns Promise<BaseStrategyConfig> Created strategy configuration
 */
export async function createStrategy(
    config: Partial<GridStrategyConfig | ArbitrageStrategyConfig | MLStrategyConfig>
): Promise<BaseStrategyConfig> {
    validateStrategy(config);

    const response = await apiService.request<ApiResponse<BaseStrategyConfig>>(
        'POST',
        API_ENDPOINTS.STRATEGY.CREATE,
        config
    );

    return response.data;
}

/**
 * Updates existing strategy configuration with validation
 * @param strategyId Strategy identifier
 * @param updates Partial strategy configuration updates
 * @returns Promise<BaseStrategyConfig> Updated strategy configuration
 */
export async function updateStrategy(
    strategyId: string,
    updates: Partial<BaseStrategyConfig>
): Promise<BaseStrategyConfig> {
    validateStrategy({ id: strategyId, ...updates });

    const response = await apiService.request<ApiResponse<BaseStrategyConfig>>(
        'PUT',
        API_ENDPOINTS.STRATEGY.UPDATE.replace(':strategyId', strategyId),
        updates
    );

    return response.data;
}

/**
 * Retrieves comprehensive performance metrics for a strategy
 * @param strategyId Strategy identifier
 * @param timeframe Performance analysis timeframe
 * @returns Promise<StrategyPerformance> Detailed performance metrics
 */
export async function getStrategyPerformance(
    strategyId: string,
    timeframe: PerformanceTimeframe = PerformanceTimeframe.DAY
): Promise<StrategyPerformance> {
    const response = await apiService.request<ApiResponse<StrategyPerformance>>(
        'GET',
        API_ENDPOINTS.STRATEGY.PERFORMANCE.replace(':strategyId', strategyId),
        { timeframe }
    );

    return response.data;
}

/**
 * Subscribes to real-time strategy updates via WebSocket
 * @param strategyId Strategy identifier
 * @param options Subscription options including callbacks
 * @returns Promise<() => void> Cleanup function to unsubscribe
 */
export async function subscribeToStrategyUpdates(
    strategyId: string,
    options: StrategySubscriptionOptions
): Promise<() => void> {
    const subscription = await apiService.subscribe(
        WebSocketMessageType.STRATEGY_UPDATE,
        (data: BaseStrategyConfig) => {
            if (data.id === strategyId) {
                try {
                    validateStrategy(data);
                    options.onUpdate(data);
                } catch (error) {
                    options.onError?.(error as Error);
                }
            }
        }
    );

    return () => {
        subscription.unsubscribe();
    };
}

/**
 * Triggers strategy optimization process
 * @param strategyId Strategy identifier
 * @returns Promise<BaseStrategyConfig> Optimized strategy configuration
 */
export async function optimizeStrategy(
    strategyId: string
): Promise<BaseStrategyConfig> {
    const response = await apiService.request<ApiResponse<BaseStrategyConfig>>(
        'POST',
        API_ENDPOINTS.STRATEGY.OPTIMIZE.replace(':strategyId', strategyId)
    );

    return response.data;
}

/**
 * Deletes an existing strategy with validation
 * @param strategyId Strategy identifier
 * @returns Promise<void>
 */
export async function deleteStrategy(strategyId: string): Promise<void> {
    await apiService.request(
        'DELETE',
        API_ENDPOINTS.STRATEGY.DELETE.replace(':strategyId', strategyId)
    );
}

/**
 * Type guard to check if strategy is in active state
 * @param strategy Strategy configuration
 * @returns boolean
 */
export function isActiveStrategy(strategy: BaseStrategyConfig): boolean {
    return strategy.state === StrategyState.ACTIVE;
}

/**
 * Utility function to get strategy-specific configuration
 * @param strategy Base strategy configuration
 * @returns Specific strategy configuration type
 */
export function getStrategyConfig(
    strategy: BaseStrategyConfig
): GridStrategyConfig | ArbitrageStrategyConfig | MLStrategyConfig {
    if (isGridStrategy(strategy)) {
        return strategy as GridStrategyConfig;
    } else if (isArbitrageStrategy(strategy)) {
        return strategy as ArbitrageStrategyConfig;
    } else if (isMLStrategy(strategy)) {
        return strategy as MLStrategyConfig;
    }
    throw new Error(`Unsupported strategy type: ${strategy.type}`);
}