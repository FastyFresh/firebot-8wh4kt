// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
import { Portfolio, Position, RiskParameters, PortfolioMetrics } from '../types/portfolio';
import { ApiResponse } from '../types/api';
import { apiService } from '../services/api';

// API endpoints for portfolio management
const PORTFOLIO_API_ENDPOINTS = {
    GET_PORTFOLIO: '/api/v1/portfolio/overview',
    GET_POSITIONS: '/api/v1/portfolio/positions',
    GET_METRICS: '/api/v1/portfolio/performance',
    UPDATE_RISK_PARAMS: '/api/v1/portfolio/risk-metrics',
    REBALANCE: '/api/v1/portfolio/allocations'
} as const;

// Validation constants
const VALID_TIMEFRAMES = ['1h', '24h', '7d', '30d', '1y'] as const;
const MAX_RISK_LEVEL = 10;
const MIN_RISK_LEVEL = 1;

/**
 * Retrieves the current portfolio state including positions and risk parameters
 * with enhanced validation and error handling
 */
export async function getPortfolio(): Promise<ApiResponse<Portfolio>> {
    try {
        const response = await apiService.request<Portfolio>(
            'GET',
            PORTFOLIO_API_ENDPOINTS.GET_PORTFOLIO
        );

        // Validate portfolio data integrity
        if (response.success && response.data) {
            validatePortfolioData(response.data);
            // Convert decimal strings to Decimal instances
            response.data.balance = new Decimal(response.data.balance);
            response.data.positions = response.data.positions.map(position => ({
                ...position,
                size: new Decimal(position.size),
                entryPrice: new Decimal(position.entryPrice),
                currentPrice: new Decimal(position.currentPrice),
                unrealizedPnL: new Decimal(position.unrealizedPnL),
                realizedPnL: new Decimal(position.realizedPnL),
                stopLossPrice: new Decimal(position.stopLossPrice),
                takeProfitPrice: new Decimal(position.takeProfitPrice)
            }));
        }

        return response;
    } catch (error) {
        throw new Error(`Failed to fetch portfolio: ${error.message}`);
    }
}

/**
 * Fetches portfolio performance metrics with high-precision calculations
 * @param timeframe - Time period for metrics calculation
 */
export async function getPortfolioMetrics(
    timeframe: typeof VALID_TIMEFRAMES[number]
): Promise<ApiResponse<PortfolioMetrics>> {
    if (!VALID_TIMEFRAMES.includes(timeframe)) {
        throw new Error(`Invalid timeframe. Must be one of: ${VALID_TIMEFRAMES.join(', ')}`);
    }

    try {
        const response = await apiService.request<PortfolioMetrics>(
            'GET',
            PORTFOLIO_API_ENDPOINTS.GET_METRICS,
            { params: { timeframe } }
        );

        // Convert response metrics to Decimal instances
        if (response.success && response.data) {
            response.data = {
                ...response.data,
                totalValue: new Decimal(response.data.totalValue),
                dailyPnL: new Decimal(response.data.dailyPnL),
                dailyPnLPercent: new Decimal(response.data.dailyPnLPercent),
                totalPnL: new Decimal(response.data.totalPnL),
                totalPnLPercent: new Decimal(response.data.totalPnLPercent),
                sharpeRatio: new Decimal(response.data.sharpeRatio),
                maxDrawdown: new Decimal(response.data.maxDrawdown),
                volatility: new Decimal(response.data.volatility),
                beta: new Decimal(response.data.beta),
                winRate: new Decimal(response.data.winRate)
            };
        }

        return response;
    } catch (error) {
        throw new Error(`Failed to fetch portfolio metrics: ${error.message}`);
    }
}

/**
 * Updates portfolio risk management parameters with comprehensive validation
 * @param params - Risk parameters to update
 */
export async function updateRiskParameters(params: RiskParameters): Promise<ApiResponse<void>> {
    // Validate risk parameters
    validateRiskParameters(params);

    try {
        const response = await apiService.request<void>(
            'PUT',
            PORTFOLIO_API_ENDPOINTS.UPDATE_RISK_PARAMS,
            {
                maxPositionSize: params.maxPositionSize.toString(),
                stopLossPercent: params.stopLossPercent.toString(),
                takeProfitPercent: params.takeProfitPercent.toString(),
                maxDrawdownPercent: params.maxDrawdownPercent.toString(),
                riskLevel: params.riskLevel,
                maxLeverage: params.maxLeverage.toString(),
                marginCallLevel: params.marginCallLevel.toString()
            }
        );

        return response;
    } catch (error) {
        throw new Error(`Failed to update risk parameters: ${error.message}`);
    }
}

/**
 * Triggers portfolio rebalancing with pre-execution validation
 */
export async function rebalancePortfolio(): Promise<ApiResponse<void>> {
    try {
        // Get current portfolio state for validation
        const portfolioResponse = await getPortfolio();
        if (!portfolioResponse.success || !portfolioResponse.data) {
            throw new Error('Failed to fetch portfolio state for rebalancing');
        }

        // Validate portfolio state for rebalancing
        validatePortfolioForRebalancing(portfolioResponse.data);

        const response = await apiService.request<void>(
            'POST',
            PORTFOLIO_API_ENDPOINTS.REBALANCE
        );

        return response;
    } catch (error) {
        throw new Error(`Failed to rebalance portfolio: ${error.message}`);
    }
}

// Helper validation functions
function validatePortfolioData(portfolio: Portfolio): void {
    if (!portfolio.id || !portfolio.walletAddress) {
        throw new Error('Invalid portfolio data: missing required fields');
    }

    if (portfolio.positions.some(position => !validatePosition(position))) {
        throw new Error('Invalid portfolio data: invalid position data');
    }
}

function validatePosition(position: Position): boolean {
    return !!(
        position.id &&
        position.portfolioId &&
        position.tradingPair &&
        position.size &&
        position.entryPrice &&
        position.currentPrice
    );
}

function validateRiskParameters(params: RiskParameters): void {
    if (
        params.riskLevel < MIN_RISK_LEVEL ||
        params.riskLevel > MAX_RISK_LEVEL
    ) {
        throw new Error(`Risk level must be between ${MIN_RISK_LEVEL} and ${MAX_RISK_LEVEL}`);
    }

    if (params.maxPositionSize.lte(0) || params.maxPositionSize.gt(new Decimal(100))) {
        throw new Error('Maximum position size must be between 0 and 100 percent');
    }

    if (params.maxLeverage.lte(0)) {
        throw new Error('Maximum leverage must be greater than 0');
    }
}

function validatePortfolioForRebalancing(portfolio: Portfolio): void {
    if (portfolio.positions.length === 0) {
        throw new Error('No positions to rebalance');
    }

    const totalValue = portfolio.positions.reduce(
        (sum, position) => sum.plus(position.size.times(position.currentPrice)),
        new Decimal(0)
    );

    if (totalValue.lt(new Decimal(100))) {
        throw new Error('Portfolio value too low for rebalancing');
    }
}