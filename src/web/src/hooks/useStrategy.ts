import { useState, useEffect, useCallback } from 'react'; // ^18.0.0
import {
    getStrategies,
    getStrategyById,
    createStrategy,
    updateStrategy,
    deleteStrategy,
    getStrategyPerformance,
} from '../api/strategy';
import { StrategyType, BaseStrategyConfig } from '../types/strategy';
import { WebSocketMessageType } from '../types/api';
import { apiService } from '../services/api';

/**
 * Custom hook for managing trading strategy operations with real-time updates
 * Provides comprehensive strategy management functionality including CRUD operations,
 * performance monitoring, and WebSocket-based live updates
 */
export function useStrategy() {
    // State management for strategies and UI states
    const [strategies, setStrategies] = useState<BaseStrategyConfig[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState<BaseStrategyConfig | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    /**
     * Fetches all available trading strategies
     * Implements error handling and state management
     */
    const fetchStrategies = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const fetchedStrategies = await getStrategies();
            setStrategies(fetchedStrategies);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch strategies'));
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Selects and loads detailed information for a specific strategy
     * @param id Strategy identifier
     */
    const selectStrategy = useCallback(async (id: string) => {
        try {
            setLoading(true);
            setError(null);
            const strategy = await getStrategyById(id);
            setSelectedStrategy(strategy);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to select strategy'));
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Creates a new trading strategy with validation
     * @param config Strategy configuration parameters
     */
    const createNewStrategy = useCallback(async (config: BaseStrategyConfig) => {
        try {
            setLoading(true);
            setError(null);
            const newStrategy = await createStrategy(config);
            setStrategies(prev => [...prev, newStrategy]);
            return newStrategy;
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to create strategy'));
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Updates existing strategy configuration
     * @param id Strategy identifier
     * @param config Updated strategy configuration
     */
    const updateExistingStrategy = useCallback(async (
        id: string,
        config: BaseStrategyConfig
    ) => {
        try {
            setLoading(true);
            setError(null);
            const updatedStrategy = await updateStrategy(id, config);
            setStrategies(prev =>
                prev.map(strategy =>
                    strategy.id === id ? updatedStrategy : strategy
                )
            );
            if (selectedStrategy?.id === id) {
                setSelectedStrategy(updatedStrategy);
            }
            return updatedStrategy;
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to update strategy'));
            throw err;
        } finally {
            setLoading(false);
        }
    }, [selectedStrategy]);

    /**
     * Deletes an existing strategy
     * @param id Strategy identifier
     */
    const deleteExistingStrategy = useCallback(async (id: string) => {
        try {
            setLoading(true);
            setError(null);
            await deleteStrategy(id);
            setStrategies(prev => prev.filter(strategy => strategy.id !== id));
            if (selectedStrategy?.id === id) {
                setSelectedStrategy(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to delete strategy'));
            throw err;
        } finally {
            setLoading(false);
        }
    }, [selectedStrategy]);

    /**
     * Retrieves performance metrics for a strategy
     * @param id Strategy identifier
     */
    const getStrategyPerformanceMetrics = useCallback(async (id: string) => {
        try {
            return await getStrategyPerformance(id);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch strategy performance'));
            throw err;
        }
    }, []);

    /**
     * Handles real-time strategy updates from WebSocket
     * @param data Updated strategy data
     */
    const handleStrategyUpdate = useCallback((data: BaseStrategyConfig) => {
        setStrategies(prev =>
            prev.map(strategy =>
                strategy.id === data.id ? data : strategy
            )
        );
        if (selectedStrategy?.id === data.id) {
            setSelectedStrategy(data);
        }
    }, [selectedStrategy]);

    // Initialize WebSocket connection and fetch initial data
    useEffect(() => {
        let wsCleanup: (() => void) | undefined;

        const initializeStrategy = async () => {
            try {
                await fetchStrategies();
                
                // Subscribe to real-time strategy updates
                wsCleanup = await apiService.subscribe(
                    WebSocketMessageType.STRATEGY_UPDATE,
                    handleStrategyUpdate
                );
            } catch (err) {
                setError(err instanceof Error ? err : new Error('Failed to initialize strategy hook'));
            }
        };

        initializeStrategy();

        // Cleanup WebSocket subscription on unmount
        return () => {
            if (wsCleanup) {
                wsCleanup();
            }
        };
    }, [fetchStrategies, handleStrategyUpdate]);

    return {
        // State
        strategies,
        selectedStrategy,
        loading,
        error,
        
        // Actions
        fetchStrategies,
        selectStrategy,
        createStrategy: createNewStrategy,
        updateStrategy: updateExistingStrategy,
        deleteStrategy: deleteExistingStrategy,
        getPerformance: getStrategyPerformanceMetrics,
    };
}