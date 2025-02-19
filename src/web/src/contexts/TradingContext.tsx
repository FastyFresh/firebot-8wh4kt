import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { ErrorBoundary, useErrorHandler } from 'react-error-boundary';
import { debounce } from 'lodash';
import CircuitBreaker from 'circuit-breaker';
import RiskManager from '@trading/risk-manager';
import Decimal from 'decimal.js-light';

import { 
  Order, 
  OrderParams, 
  OrderStatus, 
  OrderType,
  Trade 
} from '../types/trading';
import { 
  Exchange, 
  MarketData, 
  OrderBook 
} from '../types/market';

// Performance monitoring interfaces
interface PerformanceStats {
  averageExecutionTime: number;
  successRate: number;
  mevProfitTotal: Decimal;
}

interface RiskMetrics {
  portfolioValue: Decimal;
  exposureRatio: number;
  riskScore: number;
}

interface TradingContextValue {
  activeOrders: Order[];
  isLoading: boolean;
  error: Error | null;
  riskMetrics: RiskMetrics;
  performanceStats: PerformanceStats;
  placeOrder: (params: OrderParams) => Promise<Order>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  refreshOrders: () => Promise<void>;
}

interface TradingConfig {
  wsEndpoint: string;
  riskLimits: {
    maxExposureRatio: number;
    maxRiskScore: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeout: number;
  };
}

const TradingContext = createContext<TradingContextValue | undefined>(undefined);

// Circuit breaker configuration for API calls
const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
};

// WebSocket reconnection configuration
const WS_RECONNECT_CONFIG = {
  maxRetries: 5,
  backoffFactor: 1.5,
  initialDelay: 1000,
};

export const TradingProvider: React.FC<{
  children: React.ReactNode;
  config: TradingConfig;
}> = ({ children, config }) => {
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);
  const handleError = useErrorHandler();

  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics>({
    portfolioValue: new Decimal(0),
    exposureRatio: 0,
    riskScore: 0,
  });

  const [performanceStats, setPerformanceStats] = useState<PerformanceStats>({
    averageExecutionTime: 0,
    successRate: 100,
    mevProfitTotal: new Decimal(0),
  });

  // Initialize circuit breaker for API calls
  const apiCircuitBreaker = new CircuitBreaker({
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...config.circuitBreaker,
  });

  // Initialize risk manager
  const riskManager = new RiskManager({
    maxExposureRatio: config.riskLimits.maxExposureRatio,
    maxRiskScore: config.riskLimits.maxRiskScore,
  });

  // WebSocket connection management
  const setupWebSocket = useCallback(() => {
    let retryCount = 0;
    let retryDelay = WS_RECONNECT_CONFIG.initialDelay;

    const connect = () => {
      const ws = new WebSocket(config.wsEndpoint);

      ws.onopen = () => {
        setWsConnection(ws);
        retryCount = 0;
        retryDelay = WS_RECONNECT_CONFIG.initialDelay;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ORDER_UPDATE') {
            handleOrderUpdate(data.order);
          } else if (data.type === 'TRADE_UPDATE') {
            handleTradeUpdate(data.trade);
          }
        } catch (err) {
          handleError(err);
        }
      };

      ws.onclose = () => {
        setWsConnection(null);
        if (retryCount < WS_RECONNECT_CONFIG.maxRetries) {
          setTimeout(connect, retryDelay);
          retryCount++;
          retryDelay *= WS_RECONNECT_CONFIG.backoffFactor;
        }
      };

      ws.onerror = (err) => {
        handleError(err);
      };
    };

    connect();
  }, [config.wsEndpoint, handleError]);

  // Debounced order updates to prevent excessive re-renders
  const handleOrderUpdate = debounce((updatedOrder: Order) => {
    setActiveOrders(prevOrders => {
      const orderIndex = prevOrders.findIndex(order => order.id === updatedOrder.id);
      if (orderIndex === -1) {
        return [...prevOrders, updatedOrder];
      }
      const newOrders = [...prevOrders];
      newOrders[orderIndex] = updatedOrder;
      return newOrders;
    });
  }, 100);

  const handleTradeUpdate = useCallback((trade: Trade) => {
    setPerformanceStats(prev => ({
      ...prev,
      mevProfitTotal: prev.mevProfitTotal.plus(trade.mevProfit),
      averageExecutionTime: (prev.averageExecutionTime + trade.executionLatency) / 2,
    }));
  }, []);

  const placeOrder = async (params: OrderParams): Promise<Order> => {
    try {
      setIsLoading(true);

      // Validate order parameters
      if (!params.tradingPair || !params.amount || !params.price) {
        throw new Error('Invalid order parameters');
      }

      // Perform risk assessment
      const riskAssessment = await riskManager.assessOrder(params);
      if (!riskAssessment.approved) {
        throw new Error(`Risk limits exceeded: ${riskAssessment.reason}`);
      }

      // Execute order through circuit breaker
      const order = await apiCircuitBreaker.execute(async () => {
        const response = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error(`Order placement failed: ${response.statusText}`);
        }

        return response.json();
      });

      setActiveOrders(prev => [...prev, order]);
      return order;

    } catch (err) {
      handleError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const cancelOrder = async (orderId: string): Promise<boolean> => {
    try {
      setIsLoading(true);

      const success = await apiCircuitBreaker.execute(async () => {
        const response = await fetch(`/api/v1/orders/${orderId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(`Order cancellation failed: ${response.statusText}`);
        }

        return response.json();
      });

      if (success) {
        setActiveOrders(prev => 
          prev.map(order => 
            order.id === orderId 
              ? { ...order, status: OrderStatus.CANCELLED }
              : order
          )
        );
      }

      return success;
    } catch (err) {
      handleError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshOrders = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const orders = await apiCircuitBreaker.execute(async () => {
        const response = await fetch('/api/v1/orders');
        if (!response.ok) {
          throw new Error(`Failed to fetch orders: ${response.statusText}`);
        }
        return response.json();
      });

      setActiveOrders(orders);
    } catch (err) {
      handleError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setupWebSocket();
    refreshOrders();

    return () => {
      if (wsConnection) {
        wsConnection.close();
      }
    };
  }, []);

  const contextValue: TradingContextValue = {
    activeOrders,
    isLoading,
    error,
    riskMetrics,
    performanceStats,
    placeOrder,
    cancelOrder,
    refreshOrders,
  };

  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => (
        <div>Trading system error: {error.message}</div>
      )}
      onReset={() => {
        setError(null);
        refreshOrders();
      }}
    >
      <TradingContext.Provider value={contextValue}>
        {children}
      </TradingContext.Provider>
    </ErrorBoundary>
  );
};

export const useTradingContext = (): TradingContextValue => {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error('useTradingContext must be used within a TradingProvider');
  }
  return context;
};