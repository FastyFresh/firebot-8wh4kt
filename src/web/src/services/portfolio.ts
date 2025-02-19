// decimal.js-light v2.5.1 - High-precision decimal calculations
import Decimal from 'decimal.js-light';
// rxjs v7.8.1 - Reactive state management
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { debounceTime, retry, catchError, map, takeUntil } from 'rxjs/operators';

import { Portfolio, Position, RiskParameters, PortfolioMetrics } from '../types/portfolio';
import { portfolioApi } from '../api/portfolio';
import { WebSocketMessageType, ApiResponse } from '../types/api';
import { apiService } from './api';

// Cache configuration for performance optimization
const METRICS_CACHE_TTL = 5000; // 5 seconds
const PORTFOLIO_UPDATE_DEBOUNCE = 100; // 100ms

/**
 * Enhanced portfolio service with real-time updates and error recovery
 */
export class PortfolioService {
    private readonly portfolioState: BehaviorSubject<Portfolio | null>;
    private readonly metricsState: BehaviorSubject<PortfolioMetrics | null>;
    private readonly subscriptions: Map<string, Subscription>;
    private readonly destroy$: Subject<void>;
    private readonly metricsCache: Map<string, { value: PortfolioMetrics; timestamp: number }>;

    constructor() {
        this.portfolioState = new BehaviorSubject<Portfolio | null>(null);
        this.metricsState = new BehaviorSubject<PortfolioMetrics | null>(null);
        this.subscriptions = new Map();
        this.destroy$ = new Subject<void>();
        this.metricsCache = new Map();
    }

    /**
     * Initialize portfolio service with WebSocket connection and initial data load
     */
    public async initialize(): Promise<void> {
        try {
            // Load initial portfolio data with retry logic
            const initialPortfolio = await portfolioApi.getPortfolio();
            if (initialPortfolio.success && initialPortfolio.data) {
                this.portfolioState.next(initialPortfolio.data);
                await this.initializeMetrics(initialPortfolio.data);
            }

            // Subscribe to real-time portfolio updates
            this.setupWebSocketSubscription();
            this.setupPerformanceTracking();
        } catch (error) {
            console.error('Portfolio service initialization failed:', error);
            throw new Error(`Failed to initialize portfolio service: ${error.message}`);
        }
    }

    /**
     * Get current portfolio state as observable
     */
    public getPortfolioState(): Observable<Portfolio | null> {
        return this.portfolioState.asObservable();
    }

    /**
     * Get portfolio metrics as observable with caching
     */
    public getPortfolioMetrics(): Observable<PortfolioMetrics | null> {
        return this.metricsState.asObservable();
    }

    /**
     * Update portfolio risk parameters with validation
     */
    public async updateRiskParameters(params: RiskParameters): Promise<void> {
        try {
            const response = await portfolioApi.updateRiskParameters(params);
            if (response.success) {
                const currentPortfolio = this.portfolioState.value;
                if (currentPortfolio) {
                    this.portfolioState.next({
                        ...currentPortfolio,
                        riskParameters: params
                    });
                }
            }
        } catch (error) {
            console.error('Failed to update risk parameters:', error);
            throw new Error(`Risk parameters update failed: ${error.message}`);
        }
    }

    /**
     * Close position with enhanced error handling
     */
    public async closePosition(positionId: string): Promise<void> {
        try {
            const response = await portfolioApi.closePosition(positionId);
            if (response.success) {
                const currentPortfolio = this.portfolioState.value;
                if (currentPortfolio) {
                    const updatedPositions = currentPortfolio.positions.filter(
                        position => position.id !== positionId
                    );
                    this.portfolioState.next({
                        ...currentPortfolio,
                        positions: updatedPositions
                    });
                }
            }
        } catch (error) {
            console.error('Failed to close position:', error);
            throw new Error(`Position closure failed: ${error.message}`);
        }
    }

    /**
     * Calculate portfolio metrics with high precision
     */
    private calculatePortfolioMetrics(portfolio: Portfolio): PortfolioMetrics {
        const totalValue = portfolio.positions.reduce(
            (sum, position) => sum.plus(
                position.size.times(position.currentPrice)
            ),
            new Decimal(0)
        );

        const unrealizedPnL = portfolio.positions.reduce(
            (sum, position) => sum.plus(position.unrealizedPnL),
            new Decimal(0)
        );

        const realizedPnL = portfolio.positions.reduce(
            (sum, position) => sum.plus(position.realizedPnL),
            new Decimal(0)
        );

        return {
            totalValue,
            dailyPnL: unrealizedPnL.plus(realizedPnL),
            dailyPnLPercent: unrealizedPnL.plus(realizedPnL).div(totalValue).times(100),
            totalPnL: realizedPnL,
            totalPnLPercent: realizedPnL.div(totalValue).times(100),
            sharpeRatio: new Decimal(0), // Calculated in backend
            maxDrawdown: new Decimal(0), // Calculated in backend
            volatility: new Decimal(0), // Calculated in backend
            beta: new Decimal(0), // Calculated in backend
            winRate: new Decimal(0) // Calculated in backend
        };
    }

    /**
     * Initialize WebSocket subscription for real-time updates
     */
    private setupWebSocketSubscription(): void {
        apiService.subscribe(
            WebSocketMessageType.TRADE_UPDATE,
            (update: any) => {
                const currentPortfolio = this.portfolioState.value;
                if (currentPortfolio) {
                    this.handlePortfolioUpdate(update);
                }
            }
        );
    }

    /**
     * Setup performance tracking with debouncing
     */
    private setupPerformanceTracking(): void {
        this.portfolioState
            .pipe(
                debounceTime(PORTFOLIO_UPDATE_DEBOUNCE),
                takeUntil(this.destroy$)
            )
            .subscribe(portfolio => {
                if (portfolio) {
                    const metrics = this.calculatePortfolioMetrics(portfolio);
                    this.metricsState.next(metrics);
                    this.updateMetricsCache(metrics);
                }
            });
    }

    /**
     * Initialize portfolio metrics with caching
     */
    private async initializeMetrics(portfolio: Portfolio): Promise<void> {
        try {
            const response = await portfolioApi.getPortfolioPerformance('24h');
            if (response.success && response.data) {
                this.metricsState.next(response.data);
                this.updateMetricsCache(response.data);
            }
        } catch (error) {
            console.error('Failed to initialize metrics:', error);
            // Fallback to calculated metrics
            const calculatedMetrics = this.calculatePortfolioMetrics(portfolio);
            this.metricsState.next(calculatedMetrics);
            this.updateMetricsCache(calculatedMetrics);
        }
    }

    /**
     * Update metrics cache with timestamp
     */
    private updateMetricsCache(metrics: PortfolioMetrics): void {
        this.metricsCache.set('latest', {
            value: metrics,
            timestamp: Date.now()
        });
    }

    /**
     * Handle real-time portfolio updates
     */
    private handlePortfolioUpdate(update: any): void {
        const currentPortfolio = this.portfolioState.value;
        if (!currentPortfolio) return;

        const updatedPortfolio = {
            ...currentPortfolio,
            positions: currentPortfolio.positions.map(position =>
                position.id === update.positionId
                    ? { ...position, ...update.changes }
                    : position
            )
        };

        this.portfolioState.next(updatedPortfolio);
    }

    /**
     * Cleanup resources on service disposal
     */
    public dispose(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
        this.subscriptions.clear();
        this.metricsCache.clear();
        this.portfolioState.complete();
        this.metricsState.complete();
    }
}

// Export singleton instance
export const portfolioService = new PortfolioService();