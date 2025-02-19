// react v18.0.0
import React, { useEffect, useState, useCallback, useMemo } from 'react';
// @mui/material v5.0.0
import { 
    Box, 
    Grid, 
    Paper, 
    Typography, 
    useTheme, 
    CircularProgress, 
    Alert 
} from '@mui/material';
// @sentry/react v7.0.0
import { withErrorBoundary, withProfiler } from '@sentry/react';

// Internal imports
import { PerformanceChart } from '../components/charts/PerformanceChart';
import { usePortfolio, PortfolioMetrics } from '../hooks/usePortfolio';
import { useMarketData } from '../hooks/useMarketData';
import { ChartTimeframe, ChartTheme } from '../types/chart';
import { Exchange } from '../types/market';
import { CHART_DIMENSIONS, CHART_COLORS } from '../constants/chart';

// Dashboard layout configuration
const LAYOUT_CONFIG = {
    minWidth: CHART_DIMENSIONS.MIN_WIDTH,
    minHeight: CHART_DIMENSIONS.MIN_HEIGHT,
    gridSpacing: 2,
    padding: 3,
};

/**
 * Main dashboard component providing comprehensive trading overview
 * Features real-time updates, performance monitoring, and enhanced accessibility
 */
const Dashboard: React.FC = () => {
    const theme = useTheme();
    const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>(ChartTimeframe.FIFTEEN_MINUTES);

    // Initialize portfolio state management with WebSocket integration
    const { 
        portfolio, 
        connectionStatus, 
        error: portfolioError,
        updatePosition,
        updateRiskParameters 
    } = usePortfolio();

    // Initialize market data streams for active trading pairs
    const {
        marketData,
        orderBook,
        marketDepth,
        isLoading: marketDataLoading,
        error: marketDataError,
        connectionHealth
    } = useMarketData(
        portfolio?.positions[0]?.tradingPair || 'SOL/USDC',
        Exchange.JUPITER,
        {
            batchUpdates: true,
            updateInterval: 100,
            depth: 10,
            validateData: true
        }
    );

    // Memoized performance metrics calculation
    const performanceMetrics = useMemo(() => {
        if (!portfolio?.metrics) return null;
        return {
            totalValue: portfolio.metrics.totalValue,
            dailyPnL: portfolio.metrics.dailyPnL,
            dailyPnLPercent: portfolio.metrics.dailyPnLPercent,
            winRate: portfolio.metrics.winRate
        };
    }, [portfolio?.metrics]);

    // Handle WebSocket connection status changes
    useEffect(() => {
        if (connectionStatus === 'ERROR') {
            console.error('WebSocket connection error:', portfolioError);
        }
    }, [connectionStatus, portfolioError]);

    // Format performance data for chart visualization
    const chartData = useMemo(() => {
        if (!portfolio?.metrics) return [];
        return [{
            timestamp: Date.now(),
            value: portfolio.metrics.totalValue.toNumber()
        }];
    }, [portfolio?.metrics]);

    // Handle system errors with user feedback
    const renderError = useCallback(() => {
        if (portfolioError || marketDataError) {
            return (
                <Alert 
                    severity="error" 
                    sx={{ mb: 2 }}
                    role="alert"
                >
                    {portfolioError?.message || marketDataError?.message}
                </Alert>
            );
        }
        return null;
    }, [portfolioError, marketDataError]);

    // Loading state handler
    if (!portfolio || marketDataLoading) {
        return (
            <Box 
                display="flex" 
                justifyContent="center" 
                alignItems="center" 
                minHeight="100vh"
                role="progressbar"
                aria-label="Loading dashboard"
            >
                <CircularProgress size={60} />
            </Box>
        );
    }

    return (
        <Box
            sx={{
                backgroundColor: CHART_COLORS.BACKGROUND,
                minWidth: LAYOUT_CONFIG.minWidth,
                minHeight: LAYOUT_CONFIG.minHeight,
                p: LAYOUT_CONFIG.padding
            }}
            role="main"
            aria-label="Trading Dashboard"
        >
            {renderError()}

            <Grid container spacing={LAYOUT_CONFIG.gridSpacing}>
                {/* Portfolio Overview Panel */}
                <Grid item xs={12} md={3}>
                    <Paper 
                        elevation={0}
                        sx={{ 
                            p: 2, 
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: CHART_DIMENSIONS.BORDER_RADIUS 
                        }}
                    >
                        <Typography 
                            variant="h6" 
                            color="textPrimary"
                            role="heading"
                            aria-level={1}
                        >
                            Portfolio Overview
                        </Typography>
                        
                        {performanceMetrics && (
                            <Box mt={2}>
                                <Typography 
                                    variant="h4" 
                                    color="textPrimary"
                                    role="text"
                                    aria-label="Total Portfolio Value"
                                >
                                    ${performanceMetrics.totalValue.toFixed(2)}
                                </Typography>
                                <Typography 
                                    variant="body1"
                                    color={performanceMetrics.dailyPnL.isPositive() ? 
                                        CHART_COLORS.UP : 
                                        CHART_COLORS.DOWN}
                                    role="text"
                                    aria-label="Daily Profit/Loss"
                                >
                                    {performanceMetrics.dailyPnLPercent.toFixed(2)}% Today
                                </Typography>
                            </Box>
                        )}
                    </Paper>
                </Grid>

                {/* Performance Chart Panel */}
                <Grid item xs={12} md={6}>
                    <Paper 
                        elevation={0}
                        sx={{ 
                            p: 2,
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: CHART_DIMENSIONS.BORDER_RADIUS
                        }}
                    >
                        <PerformanceChart
                            data={chartData}
                            timeframe={selectedTimeframe}
                            theme={ChartTheme.DARK}
                            showGrid={true}
                            autoScale={true}
                            enableWebGL={true}
                            enableAccessibility={true}
                        />
                    </Paper>
                </Grid>

                {/* Market Data Panel */}
                <Grid item xs={12} md={3}>
                    <Paper 
                        elevation={0}
                        sx={{ 
                            p: 2,
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: CHART_DIMENSIONS.BORDER_RADIUS
                        }}
                    >
                        <Typography 
                            variant="h6" 
                            color="textPrimary"
                            role="heading"
                            aria-level={1}
                        >
                            Market Overview
                        </Typography>
                        
                        {marketData && (
                            <Box mt={2}>
                                <Typography 
                                    variant="body1" 
                                    color="textSecondary"
                                    role="text"
                                    aria-label="Current Market Price"
                                >
                                    {marketData.tradingPair}: ${marketData.price.toFixed(2)}
                                </Typography>
                                <Typography 
                                    variant="body2" 
                                    color="textSecondary"
                                    role="text"
                                    aria-label="Trading Volume"
                                >
                                    Volume: ${marketData.volume.toFixed(2)}
                                </Typography>
                            </Box>
                        )}
                    </Paper>
                </Grid>
            </Grid>

            {/* Connection Status Indicator */}
            <Box 
                sx={{ 
                    position: 'fixed', 
                    bottom: 16, 
                    right: 16,
                    borderRadius: '50%',
                    width: 12,
                    height: 12,
                    backgroundColor: connectionStatus === 'CONNECTED' ? 
                        CHART_COLORS.UP : 
                        CHART_COLORS.DOWN
                }}
                role="status"
                aria-label={`Connection Status: ${connectionStatus}`}
            />
        </Box>
    );
};

// Enhance component with error boundary and performance monitoring
export default withErrorBoundary(
    withProfiler(Dashboard, { name: 'Dashboard' }),
    {
        fallback: (
            <Box 
                display="flex" 
                justifyContent="center" 
                alignItems="center" 
                minHeight="100vh"
            >
                <Alert severity="error">
                    An error occurred while loading the dashboard. Please refresh the page.
                </Alert>
            </Box>
        )
    }
);