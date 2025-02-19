import React, { useState, useCallback, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import AssetAllocation from '../components/portfolio/AssetAllocation';
import BalanceHistory from '../components/portfolio/BalanceHistory';
import PositionList from '../components/portfolio/PositionList';
import RiskMetrics from '../components/portfolio/RiskMetrics';
import { usePortfolio } from '../hooks/usePortfolio';
import { ChartTimeframe } from '../types/chart';
import { palette } from '../config/theme';

// Error boundary fallback component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => (
  <div 
    role="alert" 
    style={{ 
      padding: '20px',
      margin: '20px',
      backgroundColor: 'rgba(255, 61, 0, 0.1)',
      borderRadius: '4px',
      color: palette.textPrimary
    }}
  >
    <h2>Portfolio Error</h2>
    <p>{error.message}</p>
    <button 
      onClick={resetErrorBoundary}
      style={{
        backgroundColor: palette.primary,
        color: palette.textPrimary,
        padding: '8px 16px',
        borderRadius: '4px',
        border: 'none',
        cursor: 'pointer'
      }}
    >
      Retry
    </button>
  </div>
);

const Portfolio: React.FC = () => {
  // Portfolio state management with WebSocket reliability
  const { 
    portfolio, 
    connectionStatus, 
    error, 
    updatePosition, 
    closePosition 
  } = usePortfolio();

  // Chart timeframe state
  const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>(
    ChartTimeframe.FIFTEEN_MINUTES
  );

  // Handle timeframe changes with performance optimization
  const handleTimeframeChange = useCallback((timeframe: ChartTimeframe) => {
    setSelectedTimeframe(timeframe);
  }, []);

  // Handle position closure with enhanced error handling
  const handlePositionClose = useCallback(async (positionId: string) => {
    try {
      if (window.confirm('Are you sure you want to close this position?')) {
        await closePosition(positionId);
      }
    } catch (error) {
      console.error('Failed to close position:', error);
      throw new Error(`Failed to close position: ${error.message}`);
    }
  }, [closePosition]);

  // Monitor WebSocket connection status
  useEffect(() => {
    if (connectionStatus === 'ERROR') {
      console.error('WebSocket connection error - attempting reconnection');
    }
  }, [connectionStatus]);

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => window.location.reload()}
      onError={(error) => {
        console.error('Portfolio error:', error);
        // Implement error tracking/logging here
      }}
    >
      <div 
        className="portfolio-page"
        style={{
          padding: '24px',
          backgroundColor: palette.background,
          minHeight: '100vh'
        }}
      >
        {/* Header Section */}
        <header 
          className="portfolio-header"
          style={{
            marginBottom: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h1 style={{ color: palette.textPrimary }}>Portfolio Overview</h1>
          <div 
            className="connection-status"
            style={{
              color: connectionStatus === 'CONNECTED' ? palette.primary : palette.secondary
            }}
            role="status"
            aria-live="polite"
          >
            {connectionStatus}
          </div>
        </header>

        {/* Main Content Grid */}
        <div 
          className="portfolio-grid"
          style={{
            display: 'grid',
            gap: '24px',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gridAutoRows: 'minmax(100px, auto)'
          }}
        >
          {/* Balance History Chart */}
          <div style={{ gridColumn: 'span 8' }}>
            <BalanceHistory
              timeframe={selectedTimeframe}
              showMetrics={true}
              height={400}
              refreshInterval={1000}
            />
          </div>

          {/* Asset Allocation */}
          <div style={{ gridColumn: 'span 4' }}>
            <AssetAllocation
              showChart={true}
              showTable={true}
              rebalanceThreshold={5}
            />
          </div>

          {/* Risk Metrics */}
          <div style={{ gridColumn: 'span 4' }}>
            <RiskMetrics
              highContrast={false}
              onRiskAlert={(level, message) => {
                console.warn(`Risk Alert [${level}]: ${message}`);
                // Implement risk alert handling here
              }}
            />
          </div>

          {/* Position List */}
          <div style={{ gridColumn: 'span 8' }}>
            <PositionList
              loading={!portfolio}
              error={error?.message}
              theme="dark"
              accessibility={{
                highContrast: false,
                reduceMotion: false
              }}
            />
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default Portfolio;