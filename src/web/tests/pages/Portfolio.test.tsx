import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { axe } from '@axe-core/react';
import Decimal from 'decimal.js-light';

import Portfolio from '../../src/pages/Portfolio';
import { usePortfolio } from '../../src/hooks/usePortfolio';
import { ConnectionStatus } from '../../src/hooks/usePortfolio';
import { ChartTimeframe } from '../../src/types/chart';

// Mock the hooks
jest.mock('../../src/hooks/usePortfolio');

// Mock child components
jest.mock('../../src/components/portfolio/AssetAllocation', () => ({
  __esModule: true,
  default: () => <div data-testid="asset-allocation">Asset Allocation</div>
}));

jest.mock('../../src/components/portfolio/BalanceHistory', () => ({
  __esModule: true,
  default: () => <div data-testid="balance-history">Balance History</div>
}));

jest.mock('../../src/components/portfolio/PositionList', () => ({
  __esModule: true,
  default: () => <div data-testid="position-list">Position List</div>
}));

jest.mock('../../src/components/portfolio/RiskMetrics', () => ({
  __esModule: true,
  default: () => <div data-testid="risk-metrics">Risk Metrics</div>
}));

// Test data
const mockPortfolioData = {
  id: 'test-portfolio',
  walletAddress: 'test-wallet',
  balance: new Decimal('50000'),
  positions: [
    {
      id: 'pos-1',
      tradingPair: 'SOL/USDC',
      size: new Decimal('100'),
      entryPrice: new Decimal('22.50'),
      currentPrice: new Decimal('23.10'),
      unrealizedPnL: new Decimal('60'),
      exchange: 'JUPITER'
    }
  ],
  metrics: {
    totalValue: new Decimal('50000'),
    dailyPnL: new Decimal('1250'),
    dailyPnLPercent: new Decimal('2.5'),
    maxDrawdown: new Decimal('-5'),
    sharpeRatio: new Decimal('1.8'),
    volatility: new Decimal('15')
  },
  riskParameters: {
    maxPositionSize: new Decimal('25'),
    stopLossPercent: new Decimal('5'),
    takeProfitPercent: new Decimal('10')
  }
};

describe('Portfolio Page Component', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock implementation
    (usePortfolio as jest.Mock).mockReturnValue({
      portfolio: mockPortfolioData,
      connectionStatus: ConnectionStatus.CONNECTED,
      error: null,
      updatePosition: jest.fn(),
      closePosition: jest.fn()
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders portfolio overview correctly', async () => {
    const { container } = render(<Portfolio />);

    // Check main components are rendered
    expect(screen.getByTestId('asset-allocation')).toBeInTheDocument();
    expect(screen.getByTestId('balance-history')).toBeInTheDocument();
    expect(screen.getByTestId('position-list')).toBeInTheDocument();
    expect(screen.getByTestId('risk-metrics')).toBeInTheDocument();

    // Check header content
    expect(screen.getByText('Portfolio Overview')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('CONNECTED');

    // Verify accessibility
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('handles real-time updates efficiently', async () => {
    const mockUpdatePosition = jest.fn();
    (usePortfolio as jest.Mock).mockReturnValue({
      ...mockPortfolioData,
      updatePosition: mockUpdatePosition,
      connectionStatus: ConnectionStatus.CONNECTED
    });

    render(<Portfolio />);

    // Simulate portfolio update
    const updatedPortfolio = {
      ...mockPortfolioData,
      metrics: {
        ...mockPortfolioData.metrics,
        totalValue: new Decimal('51000'),
        dailyPnL: new Decimal('1500')
      }
    };

    (usePortfolio as jest.Mock).mockReturnValue({
      portfolio: updatedPortfolio,
      connectionStatus: ConnectionStatus.CONNECTED,
      error: null
    });

    // Wait for update to be reflected
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('handles connection status changes appropriately', async () => {
    // Test disconnected state
    (usePortfolio as jest.Mock).mockReturnValue({
      portfolio: mockPortfolioData,
      connectionStatus: ConnectionStatus.DISCONNECTED,
      error: null
    });

    render(<Portfolio />);
    expect(screen.getByRole('status')).toHaveTextContent('DISCONNECTED');

    // Test reconnecting state
    (usePortfolio as jest.Mock).mockReturnValue({
      portfolio: mockPortfolioData,
      connectionStatus: ConnectionStatus.RECONNECTING,
      error: null
    });

    render(<Portfolio />);
    expect(screen.getByRole('status')).toHaveTextContent('RECONNECTING');
  });

  it('handles error states correctly', async () => {
    const mockError = {
      message: 'Failed to load portfolio data',
      code: 500
    };

    (usePortfolio as jest.Mock).mockReturnValue({
      portfolio: null,
      connectionStatus: ConnectionStatus.ERROR,
      error: mockError
    });

    render(<Portfolio />);

    // Verify error message is displayed
    expect(screen.getByRole('alert')).toHaveTextContent(mockError.message);
  });

  it('maintains accessibility standards', async () => {
    const { container } = render(<Portfolio />);

    // Check ARIA attributes
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('region')).toBeInTheDocument();

    // Test keyboard navigation
    const interactiveElements = screen.getAllByRole('button');
    interactiveElements.forEach(element => {
      element.focus();
      expect(element).toHaveFocus();
    });

    // Verify color contrast and other accessibility requirements
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('handles dark theme correctly', () => {
    render(<Portfolio />);

    // Verify dark theme classes and styles
    const portfolioContainer = screen.getByTestId('portfolio-page');
    expect(portfolioContainer).toHaveStyle({
      backgroundColor: '#121212'
    });
  });

  it('supports responsive layout', async () => {
    const { container } = render(<Portfolio />);

    // Verify grid layout
    const gridContainer = container.querySelector('.portfolio-grid');
    expect(gridContainer).toHaveStyle({
      display: 'grid',
      gap: '24px'
    });

    // Verify responsive breakpoints
    const mediaQuery = window.matchMedia('(min-width: 1920px)');
    if (mediaQuery.matches) {
      expect(gridContainer).toHaveStyle({
        gridTemplateColumns: 'repeat(12, 1fr)'
      });
    }
  });
});