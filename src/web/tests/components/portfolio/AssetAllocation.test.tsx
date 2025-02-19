import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import Decimal from 'decimal.js-light';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../config/theme';
import AssetAllocation from '../../../components/portfolio/AssetAllocation';
import { Portfolio, Position } from '../../../types/portfolio';
import { usePortfolio } from '../../../hooks/usePortfolio';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

// Mock the usePortfolio hook
jest.mock('../../../hooks/usePortfolio');
const mockUsePortfolio = usePortfolio as jest.MockedFunction<typeof usePortfolio>;

// Mock ResizeObserver for responsive testing
const mockResizeObserver = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
window.ResizeObserver = mockResizeObserver;

// Test data with high-precision decimals
const mockPortfolio: Portfolio = {
  id: 'test-portfolio',
  walletAddress: 'test-wallet',
  balance: new Decimal('50000.00'),
  positions: [
    {
      id: 'pos-1',
      portfolioId: 'test-portfolio',
      tradingPair: 'SOL/USDC',
      size: new Decimal('100.0000'),
      currentPrice: new Decimal('22.50'),
      entryPrice: new Decimal('20.00'),
      unrealizedPnL: new Decimal('250.00'),
      realizedPnL: new Decimal('0.00'),
      stopLossPrice: new Decimal('19.00'),
      takeProfitPrice: new Decimal('25.00'),
      exchange: 'JUPITER'
    },
    {
      id: 'pos-2',
      portfolioId: 'test-portfolio',
      tradingPair: 'ORCA/USDC',
      size: new Decimal('500.0000'),
      currentPrice: new Decimal('1.20'),
      entryPrice: new Decimal('1.00'),
      unrealizedPnL: new Decimal('100.00'),
      realizedPnL: new Decimal('0.00'),
      stopLossPrice: new Decimal('0.90'),
      takeProfitPrice: new Decimal('1.50'),
      exchange: 'PUMP_FUN'
    }
  ],
  riskParameters: {
    maxPositionSize: new Decimal('25'),
    stopLossPercent: new Decimal('5'),
    takeProfitPercent: new Decimal('10'),
    maxDrawdownPercent: new Decimal('30'),
    riskLevel: 5,
    maxLeverage: new Decimal('2'),
    marginCallLevel: new Decimal('80')
  },
  metrics: {
    totalValue: new Decimal('50000.00'),
    dailyPnL: new Decimal('350.00'),
    dailyPnLPercent: new Decimal('0.7'),
    totalPnL: new Decimal('1000.00'),
    totalPnLPercent: new Decimal('2.0'),
    sharpeRatio: new Decimal('1.5'),
    maxDrawdown: new Decimal('5.0'),
    volatility: new Decimal('15.0'),
    beta: new Decimal('1.2'),
    winRate: new Decimal('60.0')
  },
  assetAllocations: [],
  lastUpdated: new Date()
};

describe('AssetAllocation Component', () => {
  beforeEach(() => {
    mockUsePortfolio.mockReturnValue({
      portfolio: mockPortfolio,
      connectionStatus: 'CONNECTED',
      error: null,
      updatePosition: jest.fn(),
      updateRiskParameters: jest.fn()
    });
  });

  it('should render pie chart with correct asset distribution', async () => {
    const { container } = render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    // Verify pie chart segments
    await waitFor(() => {
      const chart = container.querySelector('.recharts-pie');
      expect(chart).toBeInTheDocument();
      
      // Check SOL allocation (100 * 22.50 = 2250 USDC, ~64.29% of portfolio)
      const solSegment = container.querySelector('[name="SOL"]');
      expect(solSegment).toHaveAttribute('percentage', '64.29');
      
      // Check ORCA allocation (500 * 1.20 = 600 USDC, ~35.71% of portfolio)
      const orcaSegment = container.querySelector('[name="ORCA"]');
      expect(orcaSegment).toHaveAttribute('percentage', '35.71');
    });

    // Verify ARIA labels
    expect(container.querySelector('[role="table"]'))
      .toHaveAttribute('aria-label', 'Asset allocation breakdown');
  });

  it('should handle real-time portfolio updates', async () => {
    const { rerender } = render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    // Initial state verification
    let totalValue = screen.getByText('$3,500.00'); // 2250 + 600 = 3500
    expect(totalValue).toBeInTheDocument();

    // Simulate portfolio update
    const updatedPortfolio = {
      ...mockPortfolio,
      positions: [
        {
          ...mockPortfolio.positions[0],
          currentPrice: new Decimal('23.00')
        },
        ...mockPortfolio.positions.slice(1)
      ]
    };

    mockUsePortfolio.mockReturnValue({
      portfolio: updatedPortfolio,
      connectionStatus: 'CONNECTED',
      error: null,
      updatePosition: jest.fn(),
      updateRiskParameters: jest.fn()
    });

    rerender(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    // Verify updated values
    await waitFor(() => {
      totalValue = screen.getByText('$3,550.00'); // (100 * 23.00) + 600 = 3550
      expect(totalValue).toBeInTheDocument();
    });
  });

  it('should maintain responsive layout', async () => {
    const { container } = render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    // Test minimum viewport (1920x1080)
    Object.defineProperty(window, 'innerWidth', { value: 1920 });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => {
      const chart = container.querySelector('.recharts-responsive-container');
      expect(chart).toHaveStyle({ width: '100%', height: '300px' });
    });

    // Test ultra-wide viewport
    Object.defineProperty(window, 'innerWidth', { value: 2560 });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => {
      const chart = container.querySelector('.recharts-responsive-container');
      expect(chart).toHaveStyle({ width: '100%', height: '300px' });
    });
  });

  it('should pass accessibility audit', async () => {
    const { container } = render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should handle empty portfolio state', () => {
    mockUsePortfolio.mockReturnValue({
      portfolio: { ...mockPortfolio, positions: [] },
      connectionStatus: 'CONNECTED',
      error: null,
      updatePosition: jest.fn(),
      updateRiskParameters: jest.fn()
    });

    render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('should maintain high-precision calculations', async () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    const rows = screen.getAllByRole('row');
    const solRow = within(rows[1]);
    const orcaRow = within(rows[2]);

    // Verify precise decimal calculations
    expect(solRow.getByText('100.0000')).toBeInTheDocument();
    expect(solRow.getByText('64.29%')).toBeInTheDocument();
    expect(orcaRow.getByText('500.0000')).toBeInTheDocument();
    expect(orcaRow.getByText('35.71%')).toBeInTheDocument();
  });

  it('should support keyboard navigation', async () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <AssetAllocation showChart={true} showTable={true} />
      </ThemeProvider>
    );

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');

    // Test keyboard focus management
    userEvent.tab();
    expect(rows[1]).toHaveFocus();

    userEvent.keyboard('{ArrowDown}');
    expect(rows[2]).toHaveFocus();
  });
});