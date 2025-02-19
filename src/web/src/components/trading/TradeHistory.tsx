// React v18.0.0 - Core React functionality
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
// decimal.js-light v2.5.1 - High-precision decimal calculations
import Decimal from 'decimal.js-light';
// @tanstack/react-virtual v3.0.0 - Virtualization for high-performance lists
import { useVirtualizer } from '@tanstack/react-virtual';
// zustand v4.0.0 - State management
import create from 'zustand';

// Internal imports
import { useWebSocket } from '../../hooks/useWebSocket';
import { Trade, OrderType } from '../../types/trading';
import { WebSocketMessageType } from '../../types/api';
import { WS_MESSAGE_TYPES } from '../../constants/api';

// Interface definitions
interface TradeHistoryProps {
  tradingPair: string;
  pageSize?: number;
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  onPageChange?: (page: number) => void;
  theme?: ThemeConfig;
  accessibility?: AccessibilityConfig;
  virtualizationConfig?: VirtualizationConfig;
}

interface ThemeConfig {
  background: string;
  textColor: string;
  headerBackground: string;
  rowHoverBackground: string;
  borderColor: string;
}

interface AccessibilityConfig {
  announceUpdates: boolean;
  enableKeyboardNavigation: boolean;
  highContrastMode: boolean;
}

interface VirtualizationConfig {
  rowHeight: number;
  overscan: number;
}

// Default configurations
const DEFAULT_THEME: ThemeConfig = {
  background: '#121212',
  textColor: '#FFFFFF',
  headerBackground: '#1E1E1E',
  rowHoverBackground: '#2C2C2C',
  borderColor: '#333333'
};

const DEFAULT_ACCESSIBILITY: AccessibilityConfig = {
  announceUpdates: true,
  enableKeyboardNavigation: true,
  highContrastMode: false
};

const DEFAULT_VIRTUALIZATION: VirtualizationConfig = {
  rowHeight: 40,
  overscan: 5
};

// Trade history store
interface TradeHistoryState {
  trades: Trade[];
  loading: boolean;
  error: Error | null;
  addTrade: (trade: Trade) => void;
  setTrades: (trades: Trade[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;
}

const useTradeHistoryStore = create<TradeHistoryState>((set) => ({
  trades: [],
  loading: false,
  error: null,
  addTrade: (trade) => set((state) => ({
    trades: [trade, ...state.trades].slice(0, 1000) // Keep last 1000 trades
  })),
  setTrades: (trades) => set({ trades }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));

export const TradeHistory: React.FC<TradeHistoryProps> = ({
  tradingPair,
  pageSize = 50,
  onSort,
  onPageChange,
  theme = DEFAULT_THEME,
  accessibility = DEFAULT_ACCESSIBILITY,
  virtualizationConfig = DEFAULT_VIRTUALIZATION
}) => {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);

  // State management
  const { trades, loading, error, addTrade, setLoading, setError } = useTradeHistoryStore();

  // WebSocket connection
  const { subscribe } = useWebSocket();

  // Virtualization setup
  const rowVirtualizer = useVirtualizer({
    count: trades.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => virtualizationConfig.rowHeight,
    overscan: virtualizationConfig.overscan
  });

  // Format trade data for display
  const formatTradeData = useCallback((trade: Trade) => {
    return {
      price: trade.price.toFixed(8),
      amount: trade.amount.toFixed(6),
      value: trade.price.mul(trade.amount).toFixed(2),
      side: trade.side,
      time: new Date(trade.timestamp).toLocaleTimeString(),
      mevProfit: trade.mevProfit.gt(0) ? `+${trade.mevProfit.toFixed(6)}` : ''
    };
  }, []);

  // Handle trade updates
  const handleTradeUpdate = useCallback((trade: Trade) => {
    if (trade.tradingPair === tradingPair) {
      addTrade(trade);
      
      if (accessibility.announceUpdates) {
        const announcement = `New trade: ${trade.amount.toString()} ${tradingPair} at ${trade.price.toString()}`;
        if (announcerRef.current) {
          announcerRef.current.textContent = announcement;
        }
      }
    }
  }, [tradingPair, addTrade, accessibility.announceUpdates]);

  // Subscribe to WebSocket updates
  useEffect(() => {
    const unsubscribe = subscribe<Trade>(
      WS_MESSAGE_TYPES.TRADE_UPDATE,
      handleTradeUpdate,
      { validate: true }
    );

    return () => {
      unsubscribe();
    };
  }, [subscribe, handleTradeUpdate]);

  // Keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!accessibility.enableKeyboardNavigation) return;

    switch (event.key) {
      case 'ArrowDown':
        rowVirtualizer.scrollToIndex(rowVirtualizer.getState().index + 1);
        break;
      case 'ArrowUp':
        rowVirtualizer.scrollToIndex(Math.max(0, rowVirtualizer.getState().index - 1));
        break;
      case 'Home':
        rowVirtualizer.scrollToIndex(0);
        break;
      case 'End':
        rowVirtualizer.scrollToIndex(trades.length - 1);
        break;
    }
  }, [accessibility.enableKeyboardNavigation, rowVirtualizer, trades.length]);

  // Styles
  const styles = {
    container: {
      height: '100%',
      backgroundColor: theme.background,
      color: theme.textColor,
      border: `1px solid ${theme.borderColor}`,
      overflow: 'auto'
    },
    header: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 100px 150px auto',
      padding: '12px 16px',
      backgroundColor: theme.headerBackground,
      position: 'sticky' as const,
      top: 0,
      zIndex: 1
    },
    row: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 100px 150px auto',
      padding: '8px 16px',
      borderBottom: `1px solid ${theme.borderColor}`,
      transition: 'background-color 0.2s',
      ':hover': {
        backgroundColor: theme.rowHoverBackground
      }
    },
    visuallyHidden: {
      position: 'absolute' as const,
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      border: '0'
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        style={styles.container}
        role="grid"
        aria-label="Trade History"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div style={styles.header} role="row">
          <div role="columnheader">Price</div>
          <div role="columnheader">Amount</div>
          <div role="columnheader">Value</div>
          <div role="columnheader">Side</div>
          <div role="columnheader">Time</div>
          <div role="columnheader">MEV Profit</div>
        </div>

        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const trade = trades[virtualRow.index];
            const formattedTrade = formatTradeData(trade);
            
            return (
              <div
                key={trade.id}
                style={{
                  ...styles.row,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
                role="row"
                aria-rowindex={virtualRow.index + 1}
              >
                <div role="gridcell" className={formattedTrade.side}>
                  {formattedTrade.price}
                </div>
                <div role="gridcell">{formattedTrade.amount}</div>
                <div role="gridcell">{formattedTrade.value}</div>
                <div role="gridcell">{formattedTrade.side}</div>
                <div role="gridcell">{formattedTrade.time}</div>
                <div role="gridcell">{formattedTrade.mevProfit}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Accessibility announcer */}
      <div
        ref={announcerRef}
        role="status"
        aria-live="polite"
        style={styles.visuallyHidden}
      />

      {/* Error display */}
      {error && (
        <div role="alert" style={{ color: '#FF3D00', padding: '8px' }}>
          {error.message}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div role="status" aria-label="Loading trades">
          Loading...
        </div>
      )}
    </>
  );
};

export default TradeHistory;