import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import Decimal from 'decimal.js-light';
import { WebSocket, Server } from 'mock-socket';

import PositionList from '../../../src/components/portfolio/PositionList';
import { Position } from '../../../src/types/portfolio';
import { Exchange } from '../../../src/types/market';
import { WebSocketMessageType } from '../../../src/types/api';

// Add jest-axe matchers
expect.extend(toHaveNoViolations);

// Mock WebSocket
global.WebSocket = WebSocket as any;

describe('PositionList Component', () => {
    let mockServer: Server;
    let mockOnPositionClose: vi.Mock;
    let mockOnSort: vi.Mock;

    const createMockPosition = (overrides = {}): Position => ({
        id: `pos-${Math.random().toString(36).substr(2, 9)}`,
        portfolioId: 'portfolio-1',
        tradingPair: 'SOL/USDC',
        exchange: Exchange.JUPITER,
        size: new Decimal('10.5'),
        entryPrice: new Decimal('22.50'),
        currentPrice: new Decimal('23.10'),
        unrealizedPnL: new Decimal('6.30'),
        realizedPnL: new Decimal('0'),
        stopLossPrice: new Decimal('21.50'),
        takeProfitPrice: new Decimal('24.50'),
        ...overrides
    });

    beforeEach(() => {
        // Setup WebSocket mock server
        mockServer = new Server('ws://localhost:8080');
        mockOnPositionClose = vi.fn();
        mockOnSort = vi.fn();
    });

    afterEach(() => {
        mockServer.close();
        vi.clearAllMocks();
    });

    it('renders empty state when no positions', () => {
        const { container } = render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
            />
        );

        expect(screen.getByText('No active positions')).toBeInTheDocument();
        expect(container.querySelector('.position-list.dark')).toBeInTheDocument();
    });

    it('renders positions with correct formatting', () => {
        const mockPositions = [
            createMockPosition(),
            createMockPosition({
                tradingPair: 'ORCA/USDC',
                size: new Decimal('100'),
                entryPrice: new Decimal('1.20'),
                currentPrice: new Decimal('1.25'),
                unrealizedPnL: new Decimal('-5.00')
            })
        ];

        render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
                positions={mockPositions}
                onPositionClose={mockOnPositionClose}
                onSort={mockOnSort}
            />
        );

        // Verify position data display
        mockPositions.forEach(position => {
            const row = screen.getByRole('row', { name: new RegExp(position.tradingPair) });
            expect(within(row).getByText(position.tradingPair)).toBeInTheDocument();
            expect(within(row).getByText(position.size.toFixed(4))).toBeInTheDocument();
            expect(within(row).getByText(position.currentPrice.toFixed(2))).toBeInTheDocument();
        });

        // Verify P/L formatting
        const profitCell = screen.getByText(/\+6.30/);
        const lossCell = screen.getByText(/-5.00/);
        expect(profitCell).toHaveStyle({ color: 'var(--profit-color)' });
        expect(lossCell).toHaveStyle({ color: 'var(--loss-color)' });
    });

    it('handles real-time position updates via WebSocket', async () => {
        const mockPosition = createMockPosition();
        const updatedPrice = new Decimal('24.00');

        render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
                positions={[mockPosition]}
            />
        );

        // Simulate WebSocket update
        mockServer.emit('message', JSON.stringify({
            type: WebSocketMessageType.TRADE_UPDATE,
            data: {
                positionId: mockPosition.id,
                changes: {
                    currentPrice: updatedPrice,
                    unrealizedPnL: new Decimal('15.75')
                }
            }
        }));

        await waitFor(() => {
            expect(screen.getByText(updatedPrice.toFixed(2))).toBeInTheDocument();
            expect(screen.getByText(/\+15.75/)).toBeInTheDocument();
        });
    });

    it('manages positions correctly', async () => {
        const mockPosition = createMockPosition();

        render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
                positions={[mockPosition]}
                onPositionClose={mockOnPositionClose}
            />
        );

        // Test position close action
        const closeButton = screen.getByRole('button', { name: /Close position/i });
        fireEvent.click(closeButton);

        // Verify confirmation dialog
        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
        expect(mockOnPositionClose).toHaveBeenCalledWith(mockPosition.id);
        confirmSpy.mockRestore();
    });

    it('implements sorting functionality', () => {
        const mockPositions = [
            createMockPosition(),
            createMockPosition({
                tradingPair: 'ORCA/USDC',
                size: new Decimal('100')
            })
        ];

        render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
                positions={mockPositions}
                onSort={mockOnSort}
            />
        );

        // Test sorting
        const sizeHeader = screen.getByRole('columnheader', { name: /Size/i });
        fireEvent.click(sizeHeader);
        expect(mockOnSort).toHaveBeenCalledWith('size', 'asc');
    });

    it('displays loading state correctly', () => {
        render(
            <PositionList
                loading={true}
                error={null}
                theme="dark"
            />
        );

        expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
        expect(document.querySelector('.loading-row')).toBeInTheDocument();
    });

    it('handles error states appropriately', () => {
        const errorMessage = 'Failed to load positions';
        render(
            <PositionList
                loading={false}
                error={errorMessage}
                theme="dark"
            />
        );

        expect(screen.getByRole('alert')).toHaveTextContent(errorMessage);
    });

    it('meets accessibility requirements', async () => {
        const mockPositions = [createMockPosition()];
        const { container } = render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
                positions={mockPositions}
            />
        );

        const results = await axe(container);
        expect(results).toHaveNoViolations();

        // Verify keyboard navigation
        const table = screen.getByRole('region', { name: /Trading positions list/i });
        expect(table).toHaveAttribute('aria-label');
        
        // Test focus management
        const closeButton = screen.getByRole('button', { name: /Close position/i });
        closeButton.focus();
        expect(document.activeElement).toBe(closeButton);
    });

    it('implements dark theme correctly', () => {
        const { container } = render(
            <PositionList
                loading={false}
                error={null}
                theme="dark"
                accessibility={{ highContrast: true }}
            />
        );

        const positionList = container.querySelector('.position-list');
        expect(positionList).toHaveClass('dark');
        expect(positionList).toHaveClass('high-contrast');
    });
});