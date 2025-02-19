// react v18.0.0
import React from 'react';
// @testing-library/react v14.0.0
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
// @testing-library/jest-dom v5.16.5
import '@testing-library/jest-dom';
// jest v29.6.0
import { jest } from '@jest/globals';

// Internal imports
import Dashboard from '../../src/pages/Dashboard';
import { usePortfolio } from '../../src/hooks/usePortfolio';
import { useMarketData } from '../../src/hooks/useMarketData';
import { ChartTimeframe, ChartTheme } from '../../src/types/chart';
import { CHART_COLORS, CHART_DIMENSIONS } from '../../src/constants/chart';
import { Exchange } from '../../src/types/market';
import { ConnectionStatus } from '../../src/hooks/usePortfolio';

// Mock hooks
jest.mock('../../src/hooks/usePortfolio');
jest.mock('../../src/hooks/useMarketData');

// Mock performance chart component to avoid WebGL context issues
jest.mock('../../src/components/charts/PerformanceChart', () => ({
    __esModule: true,
    default: () => <div data-testid="performance-chart">Performance Chart</div>
}));

describe('Dashboard Component', () => {
    // Mock data setup
    const mockPortfolioData = {
        portfolio: {
            metrics: {
                totalValue: 50000,
                dailyPnL: 1250,
                dailyPnLPercent: 2.5,
                winRate: 0.65
            },
            positions: [{
                tradingPair: 'SOL/USDC',
                size: 100,
                entryPrice: 22.50,
                currentPrice: 23.10
            }]
        },
        connectionStatus: ConnectionStatus.CONNECTED,
        error: null,
        updatePosition: jest.fn(),
        updateRiskParameters: jest.fn()
    };

    const mockMarketData = {
        marketData: {
            tradingPair: 'SOL/USDC',
            price: 23.10,
            volume: 1000000
        },
        orderBook: {
            bids: [],
            asks: []
        },
        marketDepth: [],
        isLoading: false,
        error: null,
        connectionHealth: {
            latency: 50,
            messageRate: 10
        }
    };

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Mock hook implementations
        (usePortfolio as jest.Mock).mockReturnValue(mockPortfolioData);
        (useMarketData as jest.Mock).mockReturnValue(mockMarketData);

        // Set viewport size
        Object.defineProperty(window, 'innerWidth', { value: 1920 });
        Object.defineProperty(window, 'innerHeight', { value: 1080 });
    });

    describe('Layout and Rendering', () => {
        it('should render the three-panel layout correctly', () => {
            render(<Dashboard />);

            // Verify main container
            const mainContainer = screen.getByRole('main');
            expect(mainContainer).toHaveStyle({
                backgroundColor: CHART_COLORS.BACKGROUND,
                minWidth: `${CHART_DIMENSIONS.MIN_WIDTH}px`,
                minHeight: `${CHART_DIMENSIONS.MIN_HEIGHT}px`
            });

            // Verify panels
            expect(screen.getByText('Portfolio Overview')).toBeInTheDocument();
            expect(screen.getByTestId('performance-chart')).toBeInTheDocument();
            expect(screen.getByText('Market Overview')).toBeInTheDocument();
        });

        it('should apply dark theme colors correctly', () => {
            render(<Dashboard />);
            
            const panels = screen.getAllByRole('article');
            panels.forEach(panel => {
                expect(panel).toHaveStyle({
                    backgroundColor: 'rgba(255, 255, 255, 0.05)'
                });
            });
        });

        it('should maintain WCAG contrast compliance', () => {
            render(<Dashboard />);
            
            const headings = screen.getAllByRole('heading');
            headings.forEach(heading => {
                const styles = window.getComputedStyle(heading);
                expect(styles.color).toBe(CHART_COLORS.TEXT);
            });
        });
    });

    describe('Real-time Updates', () => {
        it('should update portfolio values in real-time', async () => {
            render(<Dashboard />);

            const updatedPortfolio = {
                ...mockPortfolioData.portfolio,
                metrics: {
                    ...mockPortfolioData.portfolio.metrics,
                    totalValue: 51000,
                    dailyPnLPercent: 3.0
                }
            };

            // Simulate portfolio update
            (usePortfolio as jest.Mock).mockReturnValue({
                ...mockPortfolioData,
                portfolio: updatedPortfolio
            });

            await waitFor(() => {
                expect(screen.getByText('$51,000.00')).toBeInTheDocument();
                expect(screen.getByText('3.00% Today')).toBeInTheDocument();
            });
        });

        it('should update market data with correct frequency', async () => {
            jest.useFakeTimers();
            render(<Dashboard />);

            const updatedMarketData = {
                ...mockMarketData,
                marketData: {
                    ...mockMarketData.marketData,
                    price: 23.50
                }
            };

            // Simulate market data update
            (useMarketData as jest.Mock).mockReturnValue(updatedMarketData);

            // Fast-forward 100ms (market data update interval)
            jest.advanceTimersByTime(100);

            await waitFor(() => {
                expect(screen.getByText('SOL/USDC: $23.50')).toBeInTheDocument();
            });

            jest.useRealTimers();
        });

        it('should handle WebSocket connection status changes', async () => {
            render(<Dashboard />);

            // Simulate connection loss
            (usePortfolio as jest.Mock).mockReturnValue({
                ...mockPortfolioData,
                connectionStatus: ConnectionStatus.DISCONNECTED
            });

            await waitFor(() => {
                const statusIndicator = screen.getByRole('status');
                expect(statusIndicator).toHaveStyle({
                    backgroundColor: CHART_COLORS.DOWN
                });
            });
        });
    });

    describe('Responsive Behavior', () => {
        it('should adapt layout to different screen sizes', () => {
            // Test large viewport (1920x1080)
            render(<Dashboard />);
            expect(screen.getByRole('main')).toHaveStyle({
                minWidth: `${CHART_DIMENSIONS.MIN_WIDTH}px`
            });

            // Cleanup and test smaller viewport
            cleanup();
            Object.defineProperty(window, 'innerWidth', { value: 1440 });
            render(<Dashboard />);
            
            const panels = screen.getAllByRole('article');
            expect(panels).toHaveLength(3);
        });

        it('should show warning for unsupported viewport sizes', () => {
            // Set viewport below minimum supported size
            Object.defineProperty(window, 'innerWidth', { value: 1024 });
            render(<Dashboard />);

            expect(screen.getByRole('alert')).toHaveTextContent(
                /minimum resolution/i
            );
        });
    });

    describe('Error Handling', () => {
        it('should display error alerts when API calls fail', async () => {
            const mockError = {
                message: 'Failed to fetch portfolio data'
            };

            (usePortfolio as jest.Mock).mockReturnValue({
                ...mockPortfolioData,
                error: mockError
            });

            render(<Dashboard />);

            await waitFor(() => {
                expect(screen.getByRole('alert')).toHaveTextContent(mockError.message);
            });
        });

        it('should handle market data errors gracefully', async () => {
            (useMarketData as jest.Mock).mockReturnValue({
                ...mockMarketData,
                error: new Error('Market data unavailable')
            });

            render(<Dashboard />);

            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
        });
    });

    describe('Accessibility', () => {
        it('should maintain proper ARIA attributes', () => {
            render(<Dashboard />);

            // Check main landmark
            expect(screen.getByRole('main')).toHaveAttribute(
                'aria-label',
                'Trading Dashboard'
            );

            // Check headings hierarchy
            const headings = screen.getAllByRole('heading');
            expect(headings[0]).toHaveAttribute('aria-level', '1');
        });

        it('should support keyboard navigation', () => {
            render(<Dashboard />);

            const panels = screen.getAllByRole('article');
            panels.forEach(panel => {
                fireEvent.focus(panel);
                expect(panel).toHaveFocus();
            });
        });
    });
});