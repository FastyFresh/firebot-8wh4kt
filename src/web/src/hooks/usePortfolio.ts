// react v18.0.0 - React hooks for state management
import { useState, useEffect, useCallback, useRef } from 'react';
// circuit-breaker-js v1.0.0 - Circuit breaker for API calls
import CircuitBreaker from 'circuit-breaker-js';

import { Portfolio, Position, RiskParameters } from '../types/portfolio';
import { PortfolioService } from '../services/portfolio';
import { WebSocketMessageType } from '../types/api';

// WebSocket reconnection configuration
const WS_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;

// Circuit breaker configuration for API calls
const CIRCUIT_BREAKER_CONFIG = {
  windowDuration: 60000,
  numBuckets: 10,
  errorThreshold: 50,
  volumeThreshold: 10,
};

// Connection status enum
export enum ConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

// Portfolio error interface
export interface PortfolioError {
  code: number;
  message: string;
  retryable: boolean;
}

/**
 * Enhanced portfolio management hook with WebSocket integration and error handling
 */
export function usePortfolio() {
  // State management
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [error, setError] = useState<PortfolioError | null>(null);
  
  // Refs for WebSocket and reconnection
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const messageQueueRef = useRef<any[]>([]);

  // Circuit breaker for API calls
  const circuitBreaker = useRef(new CircuitBreaker(CIRCUIT_BREAKER_CONFIG));

  /**
   * Initialize WebSocket connection with automatic reconnection
   */
  const initializeWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      wsRef.current = new WebSocket(process.env.REACT_APP_WS_URL!);

      wsRef.current.onopen = () => {
        setConnectionStatus(ConnectionStatus.CONNECTED);
        reconnectAttemptsRef.current = 0;
        processMessageQueue();
      };

      wsRef.current.onclose = () => {
        setConnectionStatus(ConnectionStatus.DISCONNECTED);
        handleReconnection();
      };

      wsRef.current.onerror = (error) => {
        setError({
          code: 5001,
          message: 'WebSocket connection error',
          retryable: true,
        });
        setConnectionStatus(ConnectionStatus.ERROR);
      };

      wsRef.current.onmessage = handleWebSocketMessage;
    } catch (error) {
      setError({
        code: 5000,
        message: `Failed to initialize WebSocket: ${error.message}`,
        retryable: true,
      });
    }
  }, []);

  /**
   * Handle WebSocket message processing with error handling
   */
  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === WebSocketMessageType.TRADE_UPDATE) {
        setPortfolio(prevPortfolio => {
          if (!prevPortfolio) return null;
          return {
            ...prevPortfolio,
            positions: prevPortfolio.positions.map(position =>
              position.id === message.data.positionId
                ? { ...position, ...message.data.changes }
                : position
            ),
          };
        });
      }
    } catch (error) {
      setError({
        code: 4000,
        message: `Failed to process WebSocket message: ${error.message}`,
        retryable: false,
      });
    }
  }, []);

  /**
   * Handle WebSocket reconnection with exponential backoff
   */
  const handleReconnection = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setError({
        code: 5002,
        message: 'Maximum reconnection attempts reached',
        retryable: false,
      });
      return;
    }

    setConnectionStatus(ConnectionStatus.RECONNECTING);
    const delay = WS_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
    
    setTimeout(() => {
      reconnectAttemptsRef.current++;
      initializeWebSocket();
    }, delay);
  }, [initializeWebSocket]);

  /**
   * Process queued messages after reconnection
   */
  const processMessageQueue = useCallback(() => {
    while (messageQueueRef.current.length > 0) {
      const message = messageQueueRef.current.shift();
      wsRef.current?.send(JSON.stringify(message));
    }
  }, []);

  /**
   * Update portfolio position with circuit breaker protection
   */
  const updatePosition = useCallback(async (positionId: string, updates: Partial<Position>) => {
    try {
      await circuitBreaker.current.run(async () => {
        const response = await PortfolioService.updatePosition(positionId, updates);
        if (response.success) {
          setPortfolio(prevPortfolio => {
            if (!prevPortfolio) return null;
            return {
              ...prevPortfolio,
              positions: prevPortfolio.positions.map(position =>
                position.id === positionId
                  ? { ...position, ...updates }
                  : position
              ),
            };
          });
        }
      });
    } catch (error) {
      setError({
        code: 4300,
        message: `Failed to update position: ${error.message}`,
        retryable: true,
      });
    }
  }, []);

  /**
   * Update risk parameters with validation
   */
  const updateRiskParameters = useCallback(async (params: RiskParameters) => {
    try {
      await circuitBreaker.current.run(async () => {
        const response = await PortfolioService.updateRiskParameters(params);
        if (response.success) {
          setPortfolio(prevPortfolio => {
            if (!prevPortfolio) return null;
            return {
              ...prevPortfolio,
              riskParameters: params,
            };
          });
        }
      });
    } catch (error) {
      setError({
        code: 4400,
        message: `Failed to update risk parameters: ${error.message}`,
        retryable: true,
      });
    }
  }, []);

  /**
   * Initialize portfolio data and WebSocket connection
   */
  useEffect(() => {
    const initializePortfolio = async () => {
      try {
        const portfolioData = await PortfolioService.getPortfolioState();
        if (portfolioData) {
          setPortfolio(portfolioData);
          initializeWebSocket();
        }
      } catch (error) {
        setError({
          code: 5000,
          message: `Failed to initialize portfolio: ${error.message}`,
          retryable: true,
        });
      }
    };

    initializePortfolio();

    return () => {
      wsRef.current?.close();
      circuitBreaker.current.shutdown();
    };
  }, [initializeWebSocket]);

  return {
    portfolio,
    connectionStatus,
    error,
    updatePosition,
    updateRiskParameters,
  };
}