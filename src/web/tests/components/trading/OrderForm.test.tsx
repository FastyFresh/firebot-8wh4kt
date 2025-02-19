/**
 * @fileoverview Comprehensive test suite for OrderForm component
 * @version 1.0.0
 * @package react@18.0.0
 * @package @testing-library/react@14.0.0
 * @package @jest/globals@29.0.0
 * @package decimal.js-light@2.5.1
 * @package @axe-core/react@4.7.3
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { axe, toHaveNoViolations } from '@axe-core/react';
import Decimal from 'decimal.js-light';
import { OrderForm } from '../../../src/components/trading/OrderForm';
import { validateOrderParams } from '../../../src/utils/validation';
import { OrderType } from '../../../src/types/trading';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { darkTheme } from '../../../config/theme';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

// Mock external dependencies
jest.mock('../../../utils/validation');
jest.mock('@trading/risk-manager', () => ({
  useRiskManager: () => ({
    validatePosition: jest.fn().mockResolvedValue({ isValid: true }),
    calculateMaxSize: jest.fn().mockReturnValue(new Decimal('5000'))
  })
}));

jest.mock('@trading/price-monitor', () => ({
  usePriceMonitor: () => ({
    currentPrice: new Decimal('22.50'),
    priceImpact: new Decimal('0.001'),
    subscribeToPrice: jest.fn().mockReturnValue(() => {})
  })
}));

// Test data
const defaultProps = {
  tradingPair: 'SOL/USDC',
  exchange: 'JUPITER',
  onOrderPlaced: jest.fn(),
  onError: jest.fn(),
  maxPositionSize: new Decimal('5000'),
  riskLevel: 10,
  mevConfig: {
    enabled: true,
    maxGasCost: new Decimal('0.1'),
    preferredRoutes: ['JUPITER', 'PUMP_FUN']
  }
};

// Helper function to render OrderForm with theme
const renderOrderForm = (props = {}) => {
  const mergedProps = { ...defaultProps, ...props };
  return render(
    <ThemeProvider>
      <OrderForm {...mergedProps} />
    </ThemeProvider>
  );
};

// Helper function to measure performance
const measurePerformance = async (callback: () => Promise<void>): Promise<number> => {
  const start = performance.now();
  await callback();
  const duration = performance.now() - start;
  expect(duration).toBeLessThan(500); // Verify sub-500ms performance
  return duration;
};

describe('OrderForm Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with dark theme and meets accessibility standards', async () => {
    const { container } = renderOrderForm();
    
    // Verify dark theme application
    const form = container.firstChild as HTMLElement;
    expect(form).toHaveStyle(`background-color: ${darkTheme.palette.paper}`);
    
    // Run accessibility audit
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('validates order parameters with risk management', async () => {
    const { getByLabelText, getByText } = renderOrderForm();
    
    // Input valid order details
    fireEvent.change(getByLabelText('Amount'), { target: { value: '1.5' } });
    fireEvent.change(getByLabelText('Max Slippage (bps)'), { target: { value: '50' } });
    
    // Submit order
    fireEvent.click(getByText('Buy SOL/USDC'));
    
    await waitFor(() => {
      expect(validateOrderParams).toHaveBeenCalledWith(expect.objectContaining({
        tradingPair: 'SOL/USDC',
        amount: new Decimal('1.5'),
        maxSlippageBps: 50
      }));
    });
  });

  it('measures trade execution performance', async () => {
    const { getByLabelText, getByText } = renderOrderForm();
    
    const duration = await measurePerformance(async () => {
      // Input order details
      fireEvent.change(getByLabelText('Amount'), { target: { value: '1.5' } });
      fireEvent.change(getByLabelText('Max Slippage (bps)'), { target: { value: '50' } });
      
      // Submit order
      fireEvent.click(getByText('Buy SOL/USDC'));
      
      await waitFor(() => {
        expect(defaultProps.onOrderPlaced).toHaveBeenCalled();
      });
    });
    
    console.log(`Order submission took ${duration}ms`);
  });

  it('handles limit orders with price input', async () => {
    const { getByText, getByLabelText } = renderOrderForm();
    
    // Switch to limit order
    fireEvent.click(getByText('Limit'));
    
    // Input order details
    fireEvent.change(getByLabelText('Amount'), { target: { value: '1.5' } });
    fireEvent.change(getByLabelText('Price'), { target: { value: '23.50' } });
    
    await waitFor(() => {
      expect(screen.getByLabelText('Price')).toHaveValue(23.50);
    });
  });

  it('displays real-time price impact warnings', async () => {
    const { getByLabelText, getByText } = renderOrderForm();
    
    // Input large order amount to trigger price impact warning
    fireEvent.change(getByLabelText('Amount'), { target: { value: '1000' } });
    
    await waitFor(() => {
      expect(getByText('Price Impact: 0.10%')).toBeInTheDocument();
    });
  });

  it('validates position size against risk parameters', async () => {
    const { getByLabelText, getByText } = renderOrderForm({
      maxPositionSize: new Decimal('1000')
    });
    
    // Input amount exceeding position size limit
    fireEvent.change(getByLabelText('Amount'), { target: { value: '50' } });
    
    await waitFor(() => {
      expect(screen.getByText(/exceeds maximum position size/i)).toBeInTheDocument();
    });
  });

  it('handles MEV optimization configuration', async () => {
    const { getByLabelText, getByText } = renderOrderForm({
      mevConfig: {
        enabled: true,
        maxGasCost: new Decimal('0.05'),
        preferredRoutes: ['JUPITER']
      }
    });
    
    // Submit order with MEV optimization
    fireEvent.change(getByLabelText('Amount'), { target: { value: '1.5' } });
    fireEvent.click(getByText('Buy SOL/USDC'));
    
    await waitFor(() => {
      expect(defaultProps.onOrderPlaced).toHaveBeenCalledWith(
        expect.objectContaining({
          mevEnabled: true,
          preferredRoute: ['JUPITER']
        })
      );
    });
  });

  it('maintains responsive performance with rapid input changes', async () => {
    const { getByLabelText } = renderOrderForm();
    const amountInput = getByLabelText('Amount');
    
    await measurePerformance(async () => {
      for (let i = 0; i < 10; i++) {
        fireEvent.change(amountInput, { target: { value: i.toString() } });
      }
      
      await waitFor(() => {
        expect(amountInput).toHaveValue(9);
      });
    });
  });
});