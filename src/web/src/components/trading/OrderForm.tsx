/**
 * @fileoverview High-performance trading order form with real-time validation and MEV optimization
 * @version 1.0.0
 * @package react@18.0.0
 * @package decimal.js-light@2.5.1
 * @package lodash/debounce@4.0.8
 * @package @trading/risk-manager@1.0.0
 * @package @trading/price-monitor@1.0.0
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Decimal from 'decimal.js-light';
import debounce from 'lodash/debounce';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { useRiskManager } from '@trading/risk-manager';
import { usePriceMonitor } from '@trading/price-monitor';
import { useTheme } from '../../hooks/useTheme';
import { validateOrderParams, validateDecimal } from '../../utils/validation';
import { OrderType, OrderStatus, type Order, type OrderParams } from '../../types/trading';
import { type Exchange } from '../../types/market';
import { type RiskParameters } from '../../types/portfolio';

// Constants for order validation
const MIN_ORDER_SIZE = new Decimal('0.1');
const MAX_ORDER_SIZE = new Decimal('1000000');
const MAX_SLIPPAGE_BPS = 100;

interface OrderFormProps {
  tradingPair: string;
  exchange: Exchange;
  onOrderPlaced: (order: Order) => void;
  onError: (error: Error) => void;
  maxPositionSize: Decimal;
  riskLevel: number;
  mevConfig: {
    enabled: boolean;
    maxGasCost: Decimal;
    preferredRoutes: string[];
  };
}

export const OrderForm: React.FC<OrderFormProps> = ({
  tradingPair,
  exchange,
  onOrderPlaced,
  onError,
  maxPositionSize,
  riskLevel,
  mevConfig
}) => {
  const { theme } = useTheme();
  const [orderType, setOrderType] = useState<OrderType>(OrderType.MARKET);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(0.5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Custom hooks for risk management and price monitoring
  const { validatePosition, calculateMaxSize } = useRiskManager();
  const { currentPrice, priceImpact, subscribeToPrice } = usePriceMonitor();

  // Subscribe to price updates
  useEffect(() => {
    const unsubscribe = subscribeToPrice(tradingPair, exchange);
    return () => unsubscribe();
  }, [tradingPair, exchange, subscribeToPrice]);

  // Memoized risk parameters
  const riskParams = useMemo<RiskParameters>(() => ({
    maxPositionSize,
    stopLossPercent: new Decimal(2),
    takeProfitPercent: new Decimal(5),
    maxDrawdownPercent: new Decimal(20),
    riskLevel,
    maxLeverage: new Decimal(1),
    marginCallLevel: new Decimal(80)
  }), [maxPositionSize, riskLevel]);

  // Debounced validation function
  const validateForm = useCallback(debounce(async () => {
    const errors: Record<string, string> = {};

    try {
      const amountDecimal = new Decimal(amount || '0');
      const priceDecimal = new Decimal(price || currentPrice?.toString() || '0');

      // Validate amount
      if (!validateDecimal(amountDecimal, MIN_ORDER_SIZE, MAX_ORDER_SIZE, 8)) {
        errors.amount = `Amount must be between ${MIN_ORDER_SIZE} and ${MAX_ORDER_SIZE}`;
      }

      // Validate price for limit orders
      if (orderType === OrderType.LIMIT && !validateDecimal(priceDecimal, new Decimal('0'), new Decimal('1000000'), 8)) {
        errors.price = 'Invalid price';
      }

      // Validate slippage
      if (slippage < 0 || slippage > MAX_SLIPPAGE_BPS) {
        errors.slippage = `Slippage must be between 0 and ${MAX_SLIPPAGE_BPS} bps`;
      }

      // Validate position size against risk parameters
      const positionSize = amountDecimal.mul(priceDecimal);
      const { isValid, message } = await validatePosition(positionSize, riskParams);
      if (!isValid) {
        errors.amount = message;
      }

      // Check price impact
      if (priceImpact && priceImpact.gt(new Decimal(slippage).div(10000))) {
        errors.amount = 'Price impact exceeds slippage tolerance';
      }
    } catch (error) {
      errors.general = 'Invalid input values';
    }

    setValidationErrors(errors);
  }, 300), [amount, price, orderType, slippage, currentPrice, riskParams, priceImpact]);

  // Validate on input changes
  useEffect(() => {
    validateForm();
  }, [amount, price, orderType, slippage, validateForm]);

  // Handle order submission
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const orderParams: OrderParams = {
        tradingPair,
        exchange,
        type: orderType,
        side,
        price: new Decimal(price || currentPrice?.toString() || '0'),
        amount: new Decimal(amount),
        maxSlippageBps: slippage,
        mevEnabled: mevConfig.enabled,
        preferredRoute: mevConfig.preferredRoutes,
        validationRules: {
          maxGasCost: mevConfig.maxGasCost,
          riskLevel
        }
      };

      // Validate order parameters
      validateOrderParams(orderParams);

      // Create and submit order
      const order: Order = {
        id: crypto.randomUUID(),
        ...orderParams,
        status: OrderStatus.PENDING,
        filledAmount: new Decimal(0),
        remainingAmount: new Decimal(amount),
        createdAt: new Date(),
        updatedAt: new Date(),
        transactionHash: '',
        executionRoute: [],
        gasCost: new Decimal(0),
        slippageLimit: slippage
      };

      onOrderPlaced(order);
      
      // Reset form
      setAmount('');
      setPrice('');
      setValidationErrors({});
    } catch (error) {
      onError(error as Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ backgroundColor: theme.palette.paper, padding: theme.spacing.lg }}>
      <div style={{ marginBottom: theme.spacing.md }}>
        <Button
          variant={side === 'buy' ? 'primary' : 'secondary'}
          onClick={() => setSide('buy')}
          style={{ marginRight: theme.spacing.sm }}
        >
          Buy
        </Button>
        <Button
          variant={side === 'sell' ? 'primary' : 'secondary'}
          onClick={() => setSide('sell')}
        >
          Sell
        </Button>
      </div>

      <div style={{ marginBottom: theme.spacing.md }}>
        <Button
          variant={orderType === OrderType.MARKET ? 'primary' : 'secondary'}
          onClick={() => setOrderType(OrderType.MARKET)}
          style={{ marginRight: theme.spacing.sm }}
        >
          Market
        </Button>
        <Button
          variant={orderType === OrderType.LIMIT ? 'primary' : 'secondary'}
          onClick={() => setOrderType(OrderType.LIMIT)}
        >
          Limit
        </Button>
      </div>

      <Input
        type="number"
        label="Amount"
        value={amount}
        onChange={(value) => setAmount(value.toString())}
        error={validationErrors.amount}
        required
        min={MIN_ORDER_SIZE.toString()}
        max={MAX_ORDER_SIZE.toString()}
        step="0.00000001"
      />

      {orderType === OrderType.LIMIT && (
        <Input
          type="number"
          label="Price"
          value={price}
          onChange={(value) => setPrice(value.toString())}
          error={validationErrors.price}
          required
          min="0"
          step="0.00000001"
        />
      )}

      <Input
        type="number"
        label="Max Slippage (bps)"
        value={slippage}
        onChange={(value) => setSlippage(Number(value))}
        error={validationErrors.slippage}
        required
        min="0"
        max={MAX_SLIPPAGE_BPS}
        step="0.1"
      />

      {currentPrice && (
        <div style={{ marginBottom: theme.spacing.md, color: theme.palette.textSecondary }}>
          Current Price: {currentPrice.toFixed(8)}
        </div>
      )}

      {priceImpact && priceImpact.gt(0) && (
        <div style={{ marginBottom: theme.spacing.md, color: theme.palette.secondary }}>
          Price Impact: {priceImpact.mul(100).toFixed(2)}%
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="large"
        fullWidth
        loading={isSubmitting}
        disabled={isSubmitting || Object.keys(validationErrors).length > 0}
      >
        {isSubmitting ? 'Submitting...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${tradingPair}`}
      </Button>
    </form>
  );
};

export default OrderForm;