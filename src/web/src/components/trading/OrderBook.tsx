// react v18.0.0
import React, { useCallback, useMemo, useEffect, useRef } from 'react';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// lodash/debounce v4.0.8
import debounce from 'lodash/debounce';
// react-virtualized v9.22.3
import { AutoSizer, List } from 'react-virtualized';
// styled-components v5.3.0
import styled, { css } from 'styled-components';

// Internal imports
import { OrderBook, OrderBookLevel, Exchange } from '../../types/market';
import { useMarketData } from '../../hooks/useMarketData';

// Constants for order book display
const UPDATE_INTERVAL = 100; // 100ms refresh rate
const DEFAULT_ROWS = 25;
const PRICE_PRECISION = 8;
const SIZE_PRECISION = 6;

interface OrderBookProps {
    tradingPair: string;
    exchange: Exchange;
    maxRows?: number;
    onOrderSelect?: (price: Decimal) => void;
    updateInterval?: number;
    depthVisualization?: boolean;
    accessibilityMode?: boolean;
}

interface DepthVisualization {
    percentage: number;
    side: 'bid' | 'ask';
}

// Styled components with WCAG 2.1 compliance
const OrderBookContainer = styled.div`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${({ theme }) => theme.colors.background.primary};
    border-radius: 4px;
    overflow: hidden;
`;

const Header = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    padding: 12px;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.primary};
    color: ${({ theme }) => theme.colors.text.primary};
    font-weight: 600;
`;

const OrderRow = styled.div<{ side: 'bid' | 'ask'; depth?: DepthVisualization }>`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    padding: 8px 12px;
    cursor: pointer;
    position: relative;
    color: ${({ theme, side }) => 
        side === 'bid' ? theme.colors.success : theme.colors.error};
    
    ${({ depth }) => depth && css`
        &::before {
            content: '';
            position: absolute;
            top: 0;
            ${depth.side === 'bid' ? 'right' : 'left'}: 0;
            height: 100%;
            width: ${depth.percentage}%;
            background: ${({ theme }) => 
                depth.side === 'bid' 
                    ? theme.colors.success + '20' 
                    : theme.colors.error + '20'};
            z-index: 0;
        }
    `}

    &:hover {
        background: ${({ theme }) => theme.colors.background.hover};
    }

    &:focus-visible {
        outline: 2px solid ${({ theme }) => theme.colors.primary};
        outline-offset: -2px;
    }
`;

const Cell = styled.div`
    position: relative;
    z-index: 1;
    text-align: right;
    font-variant-numeric: tabular-nums;
`;

const OrderBook: React.FC<OrderBookProps> = ({
    tradingPair,
    exchange,
    maxRows = DEFAULT_ROWS,
    onOrderSelect,
    updateInterval = UPDATE_INTERVAL,
    depthVisualization = true,
    accessibilityMode = false
}) => {
    const { orderBook, isLoading, connectionStatus } = useMarketData(tradingPair, exchange, {
        updateInterval,
        validateData: true
    });

    const listRef = useRef<List>(null);

    // Calculate total volumes for depth visualization
    const depthData = useMemo(() => {
        if (!orderBook || !depthVisualization) return null;

        const calculateDepth = (levels: OrderBookLevel[]) => {
            const total = levels.reduce((sum, level) => sum.plus(level.size), new Decimal(0));
            return levels.map(level => ({
                ...level,
                percentage: level.size.div(total).times(100).toNumber()
            }));
        };

        return {
            bids: calculateDepth(orderBook.bids.slice(0, maxRows)),
            asks: calculateDepth(orderBook.asks.slice(0, maxRows))
        };
    }, [orderBook, maxRows, depthVisualization]);

    // Debounced update handler for smooth rendering
    const handleUpdate = useCallback(
        debounce(() => {
            listRef.current?.recomputeRowHeights();
            listRef.current?.forceUpdate();
        }, updateInterval),
        [updateInterval]
    );

    useEffect(() => {
        handleUpdate();
    }, [orderBook, handleUpdate]);

    const renderRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
        if (!orderBook) return null;

        const isAsk = index >= maxRows;
        const level = isAsk 
            ? orderBook.asks[index - maxRows] 
            : orderBook.bids[index];

        if (!level) return null;

        const depth = depthVisualization && depthData
            ? {
                percentage: isAsk 
                    ? depthData.asks[index - maxRows]?.percentage || 0
                    : depthData.bids[index]?.percentage || 0,
                side: isAsk ? 'ask' : 'bid'
            }
            : undefined;

        return (
            <OrderRow
                style={style}
                side={isAsk ? 'ask' : 'bid'}
                depth={depth}
                onClick={() => onOrderSelect?.(level.price)}
                role="button"
                tabIndex={0}
                aria-label={`${isAsk ? 'Ask' : 'Bid'} price ${level.price.toFixed(PRICE_PRECISION)} size ${level.size.toFixed(SIZE_PRECISION)}`}
            >
                <Cell>{level.price.toFixed(PRICE_PRECISION)}</Cell>
                <Cell>{level.size.toFixed(SIZE_PRECISION)}</Cell>
                <Cell>
                    {level.price.times(level.size).toFixed(PRICE_PRECISION)}
                </Cell>
            </OrderRow>
        );
    }, [orderBook, maxRows, depthData, depthVisualization, onOrderSelect]);

    if (isLoading) {
        return (
            <OrderBookContainer role="alert" aria-busy="true">
                Loading order book...
            </OrderBookContainer>
        );
    }

    return (
        <OrderBookContainer
            role="region"
            aria-label="Order Book"
            aria-live={accessibilityMode ? "polite" : "off"}
        >
            <Header>
                <Cell>Price</Cell>
                <Cell>Size</Cell>
                <Cell>Total</Cell>
            </Header>
            <AutoSizer>
                {({ width, height }) => (
                    <List
                        ref={listRef}
                        width={width}
                        height={height - 44} // Subtract header height
                        rowCount={maxRows * 2} // Bids + Asks
                        rowHeight={36}
                        overscanRowCount={5}
                        rowRenderer={renderRow}
                        aria-label={`Order book for ${tradingPair}`}
                    />
                )}
            </AutoSizer>
        </OrderBookContainer>
    );
};

export default OrderBook;