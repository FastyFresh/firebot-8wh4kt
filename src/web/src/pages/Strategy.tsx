import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary'; // ^4.0.0
import { toast } from 'react-hot-toast'; // ^2.4.1
import Decimal from 'decimal.js-light'; // ^2.5.1

// Internal imports
import { StrategyList } from '../components/strategy/StrategyList';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useStrategy } from '../../hooks/useStrategy';
import { validateRiskParameters } from '../../utils/validation';
import { 
    BaseStrategyConfig, 
    StrategyType, 
    StrategyState,
    StrategyPerformance,
    GridStrategyConfig,
    ArbitrageStrategyConfig,
    MLStrategyConfig
} from '../../types/strategy';
import { WebSocketMessageType } from '../../types/api';

// Constants for performance thresholds
const PERFORMANCE_UPDATE_INTERVAL = 5000;
const CRITICAL_DRAWDOWN_THRESHOLD = new Decimal('20'); // 20%
const WARNING_DRAWDOWN_THRESHOLD = new Decimal('10'); // 10%

/**
 * Strategy management page component with real-time monitoring
 * Provides interface for viewing, configuring and monitoring trading strategies
 */
const StrategyPage: React.FC = () => {
    // State management
    const [selectedStrategy, setSelectedStrategy] = useState<BaseStrategyConfig | null>(null);
    const [performance, setPerformance] = useState<StrategyPerformance | null>(null);
    const [isConfiguring, setIsConfiguring] = useState(false);

    // Custom hooks
    const { 
        strategies,
        loading,
        error,
        createStrategy,
        updateStrategy,
        deleteStrategy,
        getPerformance
    } = useStrategy();

    const { 
        isConnected: wsConnected,
        subscribe
    } = useWebSocket({
        autoConnect: true,
        reconnectAttempts: 5,
        messageValidation: true
    });

    // Memoized strategy type configurations
    const strategyConfigs = useMemo(() => ({
        [StrategyType.GRID]: {
            minGridLevels: 5,
            maxGridLevels: 100,
            defaultPositionSize: 500 // 5%
        },
        [StrategyType.ARBITRAGE]: {
            minProfitBps: 10,
            maxSlippageBps: 100,
            defaultPositionSize: 1000 // 10%
        },
        [StrategyType.ML]: {
            confidenceThreshold: 0.6,
            maxDrawdownBps: 2000,
            defaultPositionSize: 500 // 5%
        }
    }), []);

    // WebSocket subscription for real-time updates
    useEffect(() => {
        if (!wsConnected || !selectedStrategy) return;

        const unsubscribe = subscribe<BaseStrategyConfig>(
            WebSocketMessageType.STRATEGY_UPDATE,
            (updatedStrategy) => {
                if (updatedStrategy.id === selectedStrategy.id) {
                    setSelectedStrategy(updatedStrategy);
                }
            },
            { validate: true }
        );

        return () => {
            unsubscribe();
        };
    }, [wsConnected, selectedStrategy, subscribe]);

    // Performance monitoring
    useEffect(() => {
        if (!selectedStrategy) return;

        const fetchPerformance = async () => {
            try {
                const metrics = await getPerformance(selectedStrategy.id);
                setPerformance(metrics);

                // Check for critical drawdown levels
                if (metrics.maxDrawdown.gte(CRITICAL_DRAWDOWN_THRESHOLD)) {
                    toast.error(`Critical drawdown detected: ${metrics.maxDrawdown}%`);
                } else if (metrics.maxDrawdown.gte(WARNING_DRAWDOWN_THRESHOLD)) {
                    toast.warning(`High drawdown warning: ${metrics.maxDrawdown}%`);
                }
            } catch (error) {
                console.error('Failed to fetch performance:', error);
                toast.error('Failed to update performance metrics');
            }
        };

        fetchPerformance();
        const interval = setInterval(fetchPerformance, PERFORMANCE_UPDATE_INTERVAL);

        return () => {
            clearInterval(interval);
        };
    }, [selectedStrategy, getPerformance]);

    // Strategy selection handler
    const handleStrategySelect = useCallback((strategy: BaseStrategyConfig) => {
        setSelectedStrategy(strategy);
        setIsConfiguring(false);
    }, []);

    // Strategy creation handler
    const handleCreateStrategy = useCallback(async (config: Partial<GridStrategyConfig | ArbitrageStrategyConfig | MLStrategyConfig>) => {
        try {
            // Validate risk parameters
            validateRiskParameters({
                maxPositionSize: new Decimal(config.positionSizeBps || 0).div(100),
                stopLossPercent: new Decimal(5), // Default 5% stop loss
                takeProfitPercent: new Decimal(10), // Default 10% take profit
                maxDrawdownPercent: new Decimal(20) // Default 20% max drawdown
            });

            const newStrategy = await createStrategy(config);
            toast.success('Strategy created successfully');
            setSelectedStrategy(newStrategy);
            setIsConfiguring(false);
        } catch (error) {
            console.error('Failed to create strategy:', error);
            toast.error('Failed to create strategy');
        }
    }, [createStrategy]);

    // Strategy update handler
    const handleUpdateStrategy = useCallback(async (
        id: string,
        updates: Partial<BaseStrategyConfig>
    ) => {
        try {
            const updatedStrategy = await updateStrategy(id, updates);
            toast.success('Strategy updated successfully');
            setSelectedStrategy(updatedStrategy);
        } catch (error) {
            console.error('Failed to update strategy:', error);
            toast.error('Failed to update strategy');
        }
    }, [updateStrategy]);

    // Strategy deletion handler
    const handleDeleteStrategy = useCallback(async (id: string) => {
        try {
            await deleteStrategy(id);
            toast.success('Strategy deleted successfully');
            setSelectedStrategy(null);
        } catch (error) {
            console.error('Failed to delete strategy:', error);
            toast.error('Failed to delete strategy');
        }
    }, [deleteStrategy]);

    // Error boundary fallback
    const ErrorFallback = ({ error }: { error: Error }) => (
        <div className="error-container" role="alert">
            <h2>Strategy Management Error</h2>
            <pre>{error.message}</pre>
            <button onClick={() => window.location.reload()}>
                Reload Page
            </button>
        </div>
    );

    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <div className="strategy-page">
                <header className="strategy-header">
                    <h1>Trading Strategies</h1>
                    <div className="strategy-actions">
                        <button
                            onClick={() => setIsConfiguring(true)}
                            disabled={loading}
                            className="create-strategy-btn"
                        >
                            Create New Strategy
                        </button>
                    </div>
                </header>

                <main className="strategy-content">
                    <section className="strategy-list-section">
                        <StrategyList
                            onStrategySelect={handleStrategySelect}
                            className="strategy-list"
                        />
                    </section>

                    {selectedStrategy && (
                        <section className="strategy-details">
                            <h2>{selectedStrategy.name}</h2>
                            <div className="strategy-metrics">
                                {performance && (
                                    <>
                                        <div className="metric">
                                            <label>Total P&L</label>
                                            <span className={performance.totalPnL.gte(0) ? 'positive' : 'negative'}>
                                                {performance.totalPnL.toFixed(2)}%
                                            </span>
                                        </div>
                                        <div className="metric">
                                            <label>Win Rate</label>
                                            <span>{(performance.winRate * 100).toFixed(1)}%</span>
                                        </div>
                                        <div className="metric">
                                            <label>Sharpe Ratio</label>
                                            <span>{performance.sharpeRatio.toFixed(2)}</span>
                                        </div>
                                        <div className="metric">
                                            <label>Max Drawdown</label>
                                            <span className="negative">
                                                {performance.maxDrawdown.toFixed(2)}%
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>
                    )}
                </main>

                {error && (
                    <div className="error-message" role="alert">
                        {error.message}
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
};

export default StrategyPage;