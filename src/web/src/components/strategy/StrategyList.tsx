import React, { useMemo, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual'; // ^3.0.0
import { ErrorBoundary } from 'react-error-boundary'; // ^4.0.0
import Decimal from 'decimal.js-light'; // ^2.5.1
import { Table } from '../common/Table';
import { useStrategy } from '../../hooks/useStrategy';
import { BaseStrategyConfig, StrategyType, StrategyState, StrategyPerformance } from '../../types/strategy';

// Constants for performance metrics formatting
const PERFORMANCE_DECIMALS = 2;
const RISK_SCORE_DECIMALS = 1;
const MIN_PERFORMANCE_THRESHOLD = new Decimal('-10');
const MAX_PERFORMANCE_THRESHOLD = new Decimal('10');

interface StrategyListProps {
    onStrategySelect?: (strategy: BaseStrategyConfig) => void;
    onMetricsUpdate?: (metrics: StrategyPerformance) => void;
    className?: string;
    style?: React.CSSProperties;
    virtualListConfig?: {
        overscan?: number;
        scrollMargin?: number;
    };
    accessibilityConfig?: {
        ariaLabel?: string;
        ariaDescribedBy?: string;
    };
}

export const StrategyList: React.FC<StrategyListProps> = ({
    onStrategySelect,
    onMetricsUpdate,
    className,
    style,
    virtualListConfig = {},
    accessibilityConfig = {}
}) => {
    // Strategy management hook
    const { strategies, loading, error } = useStrategy();
    const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);

    // Memoized table columns configuration
    const columns = useMemo(() => [
        {
            id: 'name',
            label: 'Strategy Name',
            accessor: 'name',
            width: 200,
            format: (value: string) => (
                <div className="strategy-name" role="cell">
                    {value}
                </div>
            )
        },
        {
            id: 'type',
            label: 'Type',
            accessor: 'type',
            width: 120,
            format: (value: StrategyType) => (
                <div className="strategy-type" role="cell">
                    {value}
                </div>
            )
        },
        {
            id: 'state',
            label: 'Status',
            accessor: 'state',
            width: 100,
            format: (value: StrategyState) => (
                <div className={`strategy-state ${value.toLowerCase()}`} role="cell">
                    {value}
                </div>
            )
        },
        {
            id: 'performanceScore',
            label: 'Performance',
            accessor: 'performanceScore',
            width: 150,
            format: (value: Decimal) => renderPerformanceMetrics(value),
            customSort: (a: Decimal, b: Decimal) => a.comparedTo(b)
        },
        {
            id: 'tradingPairs',
            label: 'Trading Pairs',
            accessor: 'tradingPairs',
            width: 200,
            format: (value: string[]) => (
                <div className="trading-pairs" role="cell">
                    {value.join(', ')}
                </div>
            )
        },
        {
            id: 'updatedAt',
            label: 'Last Updated',
            accessor: 'updatedAt',
            width: 150,
            format: (value: Date) => (
                <div className="updated-at" role="cell">
                    {new Date(value).toLocaleString()}
                </div>
            )
        }
    ], []);

    // Memoized performance metrics renderer
    const renderPerformanceMetrics = useCallback((performance: Decimal) => {
        const formattedValue = performance.toDecimalPlaces(PERFORMANCE_DECIMALS);
        const colorClass = performance.gte(0) ? 'positive' : 'negative';
        
        return (
            <div 
                className={`performance-metric ${colorClass}`}
                role="cell"
                aria-label={`Performance: ${formattedValue}%`}
            >
                <span className="value">
                    {formattedValue.toString()}%
                </span>
                <span className={`trend-indicator ${colorClass}`}>
                    {performance.gte(0) ? '▲' : '▼'}
                </span>
            </div>
        );
    }, []);

    // Strategy selection handler
    const handleStrategySelect = useCallback(async (strategy: BaseStrategyConfig) => {
        try {
            setSelectedStrategyId(strategy.id);
            onStrategySelect?.(strategy);
        } catch (error) {
            console.error('Strategy selection failed:', error);
            setSelectedStrategyId(null);
        }
    }, [onStrategySelect]);

    // Row class generator based on strategy state
    const getRowClassName = useCallback((strategy: BaseStrategyConfig) => {
        const classes = ['strategy-row'];
        if (strategy.id === selectedStrategyId) classes.push('selected');
        if (strategy.state === StrategyState.ERROR) classes.push('error');
        if (strategy.state === StrategyState.INACTIVE) classes.push('inactive');
        return classes.join(' ');
    }, [selectedStrategyId]);

    // Error fallback component
    const ErrorFallback = ({ error }: { error: Error }) => (
        <div className="error-container" role="alert">
            <h3>Error loading strategies</h3>
            <pre>{error.message}</pre>
        </div>
    );

    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <div 
                className={`strategy-list-container ${className || ''}`}
                style={style}
                role="region"
                aria-label={accessibilityConfig.ariaLabel || 'Trading Strategies List'}
                aria-describedby={accessibilityConfig.ariaDescribedBy}
            >
                <Table
                    data={strategies}
                    columns={columns}
                    loading={loading}
                    virtualized={true}
                    rowHeight={60}
                    sortable={true}
                    onRowSelect={handleStrategySelect}
                    rowClassName={getRowClassName}
                    loadingRows={5}
                    emptyStateMessage="No strategies available"
                    ariaLabel="Trading Strategies Table"
                    virtualListConfig={{
                        overscan: virtualListConfig.overscan || 5,
                        scrollMargin: virtualListConfig.scrollMargin || 200
                    }}
                />
            </div>
        </ErrorBoundary>
    );
};

export type { StrategyListProps };