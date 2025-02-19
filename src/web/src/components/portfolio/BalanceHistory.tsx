// react v18.0.0
import React, { useEffect, useMemo, useCallback, useState } from 'react';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// react-error-boundary v4.0.0
import { ErrorBoundary } from 'react-error-boundary';

import { PerformanceChart } from '../charts/PerformanceChart';
import { usePortfolio } from '../../hooks/usePortfolio';
import { ChartTimeframe } from '../../types/chart';
import { CHART_COLORS, CHART_DIMENSIONS } from '../../constants/chart';
import { ConnectionStatus } from '../../hooks/usePortfolio';

interface BalanceHistoryProps {
    timeframe: ChartTimeframe;
    showMetrics: boolean;
    height?: number;
    refreshInterval?: number;
}

/**
 * Displays portfolio balance history with real-time updates and performance metrics
 * Optimized for high-frequency data updates and responsive rendering
 */
const BalanceHistory: React.FC<BalanceHistoryProps> = ({
    timeframe = ChartTimeframe.FIFTEEN_MINUTES,
    showMetrics = true,
    height = CHART_DIMENSIONS.MIN_HEIGHT,
    refreshInterval = 1000
}) => {
    // Portfolio state management with WebSocket updates
    const { portfolio, connectionStatus, error } = usePortfolio();
    const [balanceData, setBalanceData] = useState<Array<{ timestamp: number; value: number }>>([]);

    /**
     * Format portfolio metrics into chart-compatible data points
     * Memoized for performance optimization
     */
    const formattedBalanceData = useMemo(() => {
        if (!portfolio?.metrics) return [];

        return portfolio.metrics.map(metric => ({
            timestamp: new Date(metric.timestamp).getTime(),
            value: new Decimal(metric.totalValue).toNumber()
        })).sort((a, b) => a.timestamp - b.timestamp);
    }, [portfolio?.metrics]);

    /**
     * Handle real-time WebSocket updates
     */
    const handleWebSocketUpdate = useCallback((update: any) => {
        if (!update?.totalValue) return;

        setBalanceData(prevData => {
            const newDataPoint = {
                timestamp: Date.now(),
                value: new Decimal(update.totalValue).toNumber()
            };

            // Maintain data window based on timeframe
            const timeWindow = getTimeWindowFromTimeframe(timeframe);
            const filteredData = prevData.filter(point => 
                point.timestamp > Date.now() - timeWindow
            );

            return [...filteredData, newDataPoint];
        });
    }, [timeframe]);

    /**
     * Initialize data and WebSocket subscription
     */
    useEffect(() => {
        if (formattedBalanceData.length > 0) {
            setBalanceData(formattedBalanceData);
        }
    }, [formattedBalanceData]);

    /**
     * Calculate performance metrics
     */
    const performanceMetrics = useMemo(() => {
        if (balanceData.length < 2) return null;

        const latest = balanceData[balanceData.length - 1].value;
        const earliest = balanceData[0].value;
        const change = new Decimal(latest).minus(earliest);
        const percentChange = change.div(earliest).times(100);

        return {
            currentBalance: new Decimal(latest).toFixed(2),
            change: change.toFixed(2),
            percentChange: percentChange.toFixed(2)
        };
    }, [balanceData]);

    /**
     * Error fallback component
     */
    const ErrorFallback = ({ error }: { error: Error }) => (
        <div style={{ 
            padding: '20px', 
            color: CHART_COLORS.DOWN, 
            backgroundColor: 'rgba(255, 61, 0, 0.1)',
            borderRadius: '4px'
        }}>
            <h4>Chart Error</h4>
            <p>{error.message}</p>
        </div>
    );

    // Connection status indicator styles
    const getConnectionStatusColor = () => {
        switch (connectionStatus) {
            case ConnectionStatus.CONNECTED:
                return CHART_COLORS.UP;
            case ConnectionStatus.RECONNECTING:
                return CHART_COLORS.TEXT_SECONDARY;
            default:
                return CHART_COLORS.DOWN;
        }
    };

    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <div className="balance-history" data-testid="balance-history">
                {showMetrics && performanceMetrics && (
                    <div className="metrics-container" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '16px',
                        backgroundColor: 'rgba(44, 44, 44, 0.5)',
                        borderRadius: '4px',
                        marginBottom: '16px'
                    }}>
                        <div className="metric">
                            <span className="label">Current Balance</span>
                            <span className="value">${performanceMetrics.currentBalance}</span>
                        </div>
                        <div className="metric">
                            <span className="label">Change</span>
                            <span className="value" style={{
                                color: new Decimal(performanceMetrics.change).isPositive() ? 
                                    CHART_COLORS.UP : CHART_COLORS.DOWN
                            }}>
                                ${performanceMetrics.change} ({performanceMetrics.percentChange}%)
                            </span>
                        </div>
                        <div className="connection-status" style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: getConnectionStatusColor()
                            }} />
                            <span>{connectionStatus}</span>
                        </div>
                    </div>
                )}

                <PerformanceChart
                    data={balanceData}
                    timeframe={timeframe}
                    theme="dark"
                    height={height}
                    showGrid={true}
                    autoScale={true}
                    enableWebGL={true}
                    enableAccessibility={true}
                />

                {error && (
                    <div className="error-message" style={{
                        color: CHART_COLORS.DOWN,
                        padding: '8px',
                        marginTop: '8px',
                        fontSize: '14px'
                    }}>
                        {error.message}
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
};

/**
 * Helper function to calculate time window based on timeframe
 */
const getTimeWindowFromTimeframe = (timeframe: ChartTimeframe): number => {
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    switch (timeframe) {
        case ChartTimeframe.ONE_MINUTE:
            return MINUTE;
        case ChartTimeframe.FIVE_MINUTES:
            return 5 * MINUTE;
        case ChartTimeframe.FIFTEEN_MINUTES:
            return 15 * MINUTE;
        case ChartTimeframe.ONE_HOUR:
            return HOUR;
        case ChartTimeframe.FOUR_HOURS:
            return 4 * HOUR;
        case ChartTimeframe.ONE_DAY:
            return DAY;
        default:
            return 15 * MINUTE;
    }
};

export default React.memo(BalanceHistory);