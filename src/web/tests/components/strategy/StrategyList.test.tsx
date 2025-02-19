import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '@axe-core/react';
import { StrategyList, StrategyListProps } from '../../src/components/strategy/StrategyList';
import { useStrategy } from '../../src/hooks/useStrategy';
import { StrategyType, StrategyState } from '../../src/types/strategy';
import Decimal from 'decimal.js-light';

// Mock useStrategy hook
jest.mock('../../src/hooks/useStrategy');

// Mock strategy data generator
const setupMockStrategies = () => [
    {
        id: '1',
        name: 'Grid Trading USDC/SOL',
        type: StrategyType.GRID,
        state: StrategyState.ACTIVE,
        tradingPairs: ['USDC/SOL'],
        performanceScore: new Decimal('8.5'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02')
    },
    {
        id: '2',
        name: 'Arbitrage ORCA/USDC',
        type: StrategyType.ARBITRAGE,
        state: StrategyState.ACTIVE,
        tradingPairs: ['ORCA/USDC'],
        performanceScore: new Decimal('-2.3'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02')
    },
    {
        id: '3',
        name: 'ML Strategy RAY/USDC',
        type: StrategyType.ML,
        state: StrategyState.ERROR,
        tradingPairs: ['RAY/USDC'],
        performanceScore: new Decimal('4.7'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02')
    }
];

describe('StrategyList Component', () => {
    // Setup default props
    const defaultProps: StrategyListProps = {
        onStrategySelect: jest.fn(),
        onMetricsUpdate: jest.fn(),
        className: 'custom-strategy-list',
        virtualListConfig: {
            overscan: 2,
            scrollMargin: 100
        },
        accessibilityConfig: {
            ariaLabel: 'Trading Strategies',
            ariaDescribedBy: 'strategy-description'
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Rendering and Data Display', () => {
        it('renders strategy list with correct data', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            // Verify all strategies are rendered
            expect(screen.getAllByRole('row')).toHaveLength(mockStrategies.length + 1); // +1 for header
            
            // Check strategy names
            expect(screen.getByText('Grid Trading USDC/SOL')).toBeInTheDocument();
            expect(screen.getByText('Arbitrage ORCA/USDC')).toBeInTheDocument();
            expect(screen.getByText('ML Strategy RAY/USDC')).toBeInTheDocument();

            // Verify performance metrics formatting
            const performanceElements = screen.getAllByRole('cell', { name: /Performance/i });
            expect(performanceElements[0]).toHaveTextContent('8.50%');
            expect(performanceElements[1]).toHaveTextContent('-2.30%');
        });

        it('handles loading state correctly', () => {
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: [],
                loading: true,
                error: null
            });

            render(<StrategyList {...defaultProps} />);
            
            expect(screen.getByRole('progressbar')).toBeInTheDocument();
            expect(screen.queryByRole('grid')).not.toBeInTheDocument();
        });

        it('displays error state appropriately', () => {
            const error = new Error('Failed to load strategies');
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: [],
                loading: false,
                error
            });

            render(<StrategyList {...defaultProps} />);
            
            expect(screen.getByRole('alert')).toHaveTextContent('Failed to load strategies');
        });
    });

    describe('Interaction and Selection', () => {
        it('handles strategy selection correctly', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            // Click on a strategy row
            const strategyRow = screen.getByText('Grid Trading USDC/SOL').closest('tr');
            await userEvent.click(strategyRow!);

            expect(defaultProps.onStrategySelect).toHaveBeenCalledWith(mockStrategies[0]);
            expect(strategyRow).toHaveClass('selected');
        });

        it('supports keyboard navigation', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            const rows = screen.getAllByRole('row');
            
            // Tab to first row
            await userEvent.tab();
            expect(rows[1]).toHaveFocus();

            // Press Enter to select
            await userEvent.keyboard('{Enter}');
            expect(defaultProps.onStrategySelect).toHaveBeenCalledWith(mockStrategies[0]);
        });
    });

    describe('Sorting and Filtering', () => {
        it('sorts strategies by performance', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            // Click performance header to sort
            const performanceHeader = screen.getByRole('columnheader', { name: /Performance/i });
            await userEvent.click(performanceHeader);

            const rows = screen.getAllByRole('row');
            const firstPerformance = within(rows[1]).getByRole('cell', { name: /Performance/i });
            expect(firstPerformance).toHaveTextContent('8.50%');
        });

        it('maintains sort state after data updates', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            // Sort by performance
            const performanceHeader = screen.getByRole('columnheader', { name: /Performance/i });
            await userEvent.click(performanceHeader);

            // Simulate data update
            const updatedStrategies = [...mockStrategies];
            updatedStrategies[0].performanceScore = new Decimal('10.0');
            
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: updatedStrategies,
                loading: false,
                error: null
            });

            // Verify sort is maintained
            const rows = screen.getAllByRole('row');
            const firstPerformance = within(rows[1]).getByRole('cell', { name: /Performance/i });
            expect(firstPerformance).toHaveTextContent('10.00%');
        });
    });

    describe('Accessibility', () => {
        it('meets WCAG 2.1 accessibility guidelines', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            const { container } = render(<StrategyList {...defaultProps} />);
            
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });

        it('provides appropriate ARIA labels and roles', () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            expect(screen.getByRole('region')).toHaveAttribute('aria-label', 'Trading Strategies');
            expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Trading Strategies Table');
        });

        it('handles screen reader announcements for state changes', async () => {
            const mockStrategies = setupMockStrategies();
            (useStrategy as jest.Mock).mockReturnValue({
                strategies: mockStrategies,
                loading: false,
                error: null
            });

            render(<StrategyList {...defaultProps} />);

            const errorStrategy = screen.getByText('ML Strategy RAY/USDC').closest('tr');
            expect(errorStrategy).toHaveAttribute('aria-label', expect.stringContaining('Error'));
        });
    });
});