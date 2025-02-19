import React, { useCallback, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary'; // v4.0.11
import Decimal from 'decimal.js-light'; // v2.5.1
import { useVirtualizer } from '@tanstack/react-virtual'; // v3.0.0

import { Table } from '../common/Table';
import { usePortfolio } from '../../hooks/usePortfolio';
import { Position } from '../../types/portfolio';
import { Exchange } from '../../types/market';

// Constants for accessibility and UI
const ARIA_LABELS = {
    positionList: 'Trading positions list',
    closeButton: 'Close position',
    profitLabel: 'Profit and Loss',
    sizeLabel: 'Position Size',
    priceLabel: 'Current Price',
    exchangeLabel: 'Exchange',
} as const;

// Color constants from theme
const COLORS = {
    profit: 'var(--profit-color)',
    loss: 'var(--loss-color)',
    neutral: 'var(--neutral-color)',
} as const;

interface PositionListProps {
    loading?: boolean;
    error?: string | null;
    theme?: 'dark' | 'light';
    accessibility?: {
        highContrast?: boolean;
        reduceMotion?: boolean;
    };
}

const formatPnL = (value: Decimal): { color: string; text: string; ariaLabel: string } => {
    const formattedValue = value.toFixed(2);
    const percentage = value.mul(100).toFixed(2);
    const isProfit = value.gt(0);
    const isLoss = value.lt(0);
    
    return {
        color: isProfit ? COLORS.profit : isLoss ? COLORS.loss : COLORS.neutral,
        text: `${isProfit ? '+' : ''}${formattedValue} (${percentage}%)`,
        ariaLabel: `${isProfit ? 'Profit' : isLoss ? 'Loss' : 'Break even'} of ${formattedValue} USDC, ${percentage} percent`,
    };
};

const PositionList: React.FC<PositionListProps> = ({
    loading = false,
    error = null,
    theme = 'dark',
    accessibility = {},
}) => {
    const { portfolio, updatePosition, closePosition } = usePortfolio();
    const [selectedPosition, setSelectedPosition] = useState<string | null>(null);

    const handleClosePosition = useCallback(async (positionId: string) => {
        try {
            if (window.confirm('Are you sure you want to close this position?')) {
                await closePosition(positionId);
            }
        } catch (error) {
            console.error('Failed to close position:', error);
        }
    }, [closePosition]);

    const columns = useMemo(() => [
        {
            id: 'tradingPair',
            label: 'Trading Pair',
            accessor: 'tradingPair',
            width: 150,
        },
        {
            id: 'exchange',
            label: 'Exchange',
            accessor: 'exchange',
            width: 120,
            format: (value: Exchange) => (
                <span role="cell" aria-label={`${ARIA_LABELS.exchangeLabel}: ${value}`}>
                    {value}
                </span>
            ),
        },
        {
            id: 'size',
            label: 'Size',
            accessor: 'size',
            width: 120,
            align: 'right',
            format: (value: Decimal) => (
                <span role="cell" aria-label={`${ARIA_LABELS.sizeLabel}: ${value.toString()}`}>
                    {value.toFixed(4)}
                </span>
            ),
        },
        {
            id: 'entryPrice',
            label: 'Entry Price',
            accessor: 'entryPrice',
            width: 120,
            align: 'right',
            format: (value: Decimal) => value.toFixed(2),
        },
        {
            id: 'currentPrice',
            label: 'Current Price',
            accessor: 'currentPrice',
            width: 120,
            align: 'right',
            format: (value: Decimal) => (
                <span role="cell" aria-label={`${ARIA_LABELS.priceLabel}: ${value.toString()} USDC`}>
                    {value.toFixed(2)}
                </span>
            ),
        },
        {
            id: 'unrealizedPnL',
            label: 'P/L',
            accessor: 'unrealizedPnL',
            width: 150,
            align: 'right',
            format: (value: Decimal) => {
                const { color, text, ariaLabel } = formatPnL(value);
                return (
                    <span
                        role="cell"
                        aria-label={`${ARIA_LABELS.profitLabel}: ${ariaLabel}`}
                        style={{ color, fontWeight: 600 }}
                    >
                        {text}
                    </span>
                );
            },
        },
        {
            id: 'actions',
            label: 'Actions',
            accessor: (position: Position) => position.id,
            width: 100,
            format: (positionId: string) => (
                <button
                    className="btn btn-danger"
                    onClick={() => handleClosePosition(positionId)}
                    aria-label={`${ARIA_LABELS.closeButton} for position ${positionId}`}
                >
                    Close
                </button>
            ),
        },
    ], [handleClosePosition]);

    const positions = useMemo(() => portfolio?.positions || [], [portfolio]);

    if (error) {
        return (
            <div role="alert" className="error-container">
                Failed to load positions: {error}
            </div>
        );
    }

    return (
        <ErrorBoundary
            fallback={<div role="alert">Error loading position list</div>}
            onError={(error) => console.error('Position list error:', error)}
        >
            <div 
                className={`position-list ${theme} ${accessibility.highContrast ? 'high-contrast' : ''}`}
                role="region"
                aria-label={ARIA_LABELS.positionList}
            >
                <Table
                    data={positions}
                    columns={columns}
                    loading={loading}
                    virtualized={positions.length > 50}
                    rowHeight={48}
                    sortable={true}
                    highlightedRows={selectedPosition ? [positions.findIndex(p => p.id === selectedPosition)] : []}
                    onRowSelect={(position: Position) => setSelectedPosition(position.id)}
                    emptyStateMessage="No active positions"
                    ariaLabel={ARIA_LABELS.positionList}
                />
            </div>
        </ErrorBoundary>
    );
};

export default PositionList;