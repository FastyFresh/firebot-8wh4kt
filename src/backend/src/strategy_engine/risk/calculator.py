"""
Risk Calculator Module

Implements advanced risk metrics, position sizing algorithms, and portfolio risk assessment
with enhanced correlation analysis and multi-factor risk validation.

Dependencies:
numpy==1.24.0 - Vectorized numerical computations for efficient risk calculations
pandas==2.0.0 - Market data manipulation and time-series analysis for risk metrics
scipy==1.10.0 - Advanced statistical functions for correlation and risk modeling
"""

import numpy as np
import pandas as pd
from scipy import stats
from strategy_engine.base import BaseStrategy, MAX_POSITION_SIZE_BPS, MIN_POSITION_SIZE_BPS

# Global constants for risk calculations
VAR_LOOKBACK_DAYS = 30
RISK_CONFIDENCE_LEVEL = 0.95
MAX_CONCENTRATION_LIMIT = 0.25
CORRELATION_THRESHOLD = 0.7
VOLATILITY_WINDOW = 20
LIQUIDITY_THRESHOLD = 0.1
RISK_SCORE_THRESHOLD = 0.8

class RiskCalculator:
    """
    Advanced risk calculation engine implementing comprehensive portfolio risk assessment,
    dynamic position sizing, and multi-factor trade validation.
    """
    
    def __init__(self, confidence_level: float = RISK_CONFIDENCE_LEVEL,
                 lookback_period: int = VAR_LOOKBACK_DAYS,
                 risk_limits: dict = None,
                 market_parameters: dict = None) -> None:
        """
        Initialize the risk calculator with enhanced configuration parameters and statistical models.

        Args:
            confidence_level (float): Statistical confidence level for risk metrics
            lookback_period (int): Historical period for risk calculations in days
            risk_limits (dict): Custom risk limits and constraints
            market_parameters (dict): Market-specific parameters for risk adjustments
        """
        self.confidence_level = min(max(confidence_level, 0.9), 0.99)
        self.lookback_period = max(lookback_period, 5)
        self.risk_limits = risk_limits or {
            'max_position_size': MAX_POSITION_SIZE_BPS,
            'min_position_size': MIN_POSITION_SIZE_BPS,
            'max_concentration': MAX_CONCENTRATION_LIMIT,
            'correlation_limit': CORRELATION_THRESHOLD
        }
        
        # Initialize statistical models and metrics
        self.correlation_matrix = np.array([])
        self.volatility_metrics = {}
        self.liquidity_scores = {}
        
        # Market impact parameters
        self._market_params = market_parameters or {
            'impact_coefficient': 0.1,
            'volatility_adjustment': 1.5,
            'liquidity_factor': 0.8
        }

    def calculate_value_at_risk(self, portfolio_returns: pd.DataFrame,
                              market_conditions: dict,
                              var_type: str = 'historical') -> dict:
        """
        Calculates multi-timeframe Value at Risk (VaR) using historical simulation
        with volatility adjustment.

        Args:
            portfolio_returns (pd.DataFrame): Historical returns data
            market_conditions (dict): Current market state and volatility metrics
            var_type (str): VaR calculation method ('historical', 'parametric', 'monte_carlo')

        Returns:
            dict: Multi-timeframe VaR metrics with confidence intervals
        """
        try:
            # Clean and validate input data
            returns = portfolio_returns.dropna()
            if len(returns) < self.lookback_period:
                raise ValueError("Insufficient historical data for VaR calculation")

            # Calculate volatility adjustment
            current_vol = returns.std()
            historical_vol = returns.rolling(VOLATILITY_WINDOW).std().mean()
            vol_adjustment = current_vol / historical_vol if historical_vol != 0 else 1

            var_metrics = {}
            timeframes = [1, 5, 10]  # Days

            for timeframe in timeframes:
                # Calculate base VaR
                if var_type == 'historical':
                    var = np.percentile(returns * vol_adjustment, 
                                      (1 - self.confidence_level) * 100) * np.sqrt(timeframe)
                elif var_type == 'parametric':
                    var = stats.norm.ppf(1 - self.confidence_level) * current_vol * np.sqrt(timeframe)
                else:  # monte_carlo
                    simulated_returns = np.random.normal(returns.mean(), 
                                                       current_vol, 
                                                       10000)
                    var = np.percentile(simulated_returns, (1 - self.confidence_level) * 100)

                # Calculate confidence intervals
                ci_lower = var * 0.9  # 90% confidence interval
                ci_upper = var * 1.1

                var_metrics[f'{timeframe}d'] = {
                    'var': abs(var),
                    'confidence_interval': (ci_lower, ci_upper),
                    'volatility_adjustment': vol_adjustment
                }

            return var_metrics

        except Exception as e:
            raise ValueError(f"Error calculating VaR: {str(e)}")

    def calculate_position_size(self, market_data: dict,
                              portfolio_value: float,
                              existing_positions: dict,
                              market_impact_params: dict) -> dict:
        """
        Determines optimal position size using multi-factor analysis including
        volatility, correlation, and liquidity.

        Args:
            market_data (dict): Current market data and metrics
            portfolio_value (float): Total portfolio value
            existing_positions (dict): Current portfolio positions
            market_impact_params (dict): Market impact and slippage parameters

        Returns:
            dict: Comprehensive position sizing recommendations with risk metrics
        """
        try:
            # Calculate volatility-adjusted base position size
            volatility = market_data.get('volatility', 0.0)
            vol_adjusted_size = (MAX_POSITION_SIZE_BPS / 10000) * portfolio_value * \
                              (1 / (1 + volatility * self._market_params['volatility_adjustment']))

            # Adjust for market liquidity
            avg_volume = market_data.get('average_volume', 0.0)
            market_impact = (vol_adjusted_size / avg_volume) * \
                          market_impact_params.get('impact_coefficient', 
                                                 self._market_params['impact_coefficient'])
            
            liquidity_adjusted_size = vol_adjusted_size * \
                                    (1 - market_impact * self._market_params['liquidity_factor'])

            # Check concentration limits
            total_exposure = sum(pos['value'] for pos in existing_positions.values())
            concentration_limit = min(
                self.risk_limits['max_concentration'] * portfolio_value - total_exposure,
                liquidity_adjusted_size
            )

            # Calculate final position size
            final_size = max(
                min(concentration_limit, liquidity_adjusted_size),
                MIN_POSITION_SIZE_BPS / 10000 * portfolio_value
            )

            return {
                'recommended_size': final_size,
                'risk_metrics': {
                    'volatility_adjustment': volatility * self._market_params['volatility_adjustment'],
                    'market_impact': market_impact,
                    'concentration': final_size / portfolio_value,
                    'liquidity_score': 1 - market_impact
                }
            }

        except Exception as e:
            raise ValueError(f"Error calculating position size: {str(e)}")

    def calculate_portfolio_risk(self, portfolio_state: dict,
                               market_data: pd.DataFrame,
                               stress_scenarios: dict) -> dict:
        """
        Performs comprehensive portfolio risk assessment including correlation
        analysis and stress testing.

        Args:
            portfolio_state (dict): Current portfolio positions and metrics
            market_data (pd.DataFrame): Historical market data for analysis
            stress_scenarios (dict): Stress test scenarios and parameters

        Returns:
            dict: Detailed portfolio risk metrics and stress test results
        """
        try:
            # Calculate portfolio-level metrics
            portfolio_value = sum(pos['value'] for pos in portfolio_state['positions'].values())
            returns = market_data.pct_change().dropna()

            # Update correlation matrix
            self.correlation_matrix = returns.corr().values
            
            # Calculate concentration metrics
            concentration = max(pos['value'] / portfolio_value 
                             for pos in portfolio_state['positions'].values())

            # Perform stress testing
            stress_results = {}
            for scenario, params in stress_scenarios.items():
                shocked_returns = returns * params.get('shock_factor', 1.0)
                stress_var = self.calculate_value_at_risk(
                    shocked_returns,
                    {'volatility': params.get('volatility_adjustment', 1.0)},
                    'historical'
                )
                stress_results[scenario] = stress_var

            # Calculate risk-adjusted metrics
            sharpe_ratio = returns.mean() / returns.std() * np.sqrt(252)
            max_drawdown = (returns.cummax() - returns).max()

            return {
                'var_metrics': self.calculate_value_at_risk(returns, 
                                                          {'volatility': returns.std()},
                                                          'historical'),
                'correlation_matrix': self.correlation_matrix.tolist(),
                'concentration': concentration,
                'stress_test_results': stress_results,
                'risk_adjusted_metrics': {
                    'sharpe_ratio': sharpe_ratio,
                    'max_drawdown': max_drawdown,
                    'diversification_score': 1 - concentration
                }
            }

        except Exception as e:
            raise ValueError(f"Error calculating portfolio risk: {str(e)}")

    def validate_trade(self, trade_params: dict,
                      portfolio_state: dict,
                      market_data: pd.DataFrame,
                      risk_scenarios: dict) -> tuple:
        """
        Performs multi-factor trade validation against risk limits and portfolio constraints.

        Args:
            trade_params (dict): Proposed trade parameters
            portfolio_state (dict): Current portfolio state
            market_data (pd.DataFrame): Market data for analysis
            risk_scenarios (dict): Risk scenarios for validation

        Returns:
            tuple: (bool, dict) - Validation result with detailed risk analysis
        """
        try:
            # Calculate pre-trade risk metrics
            pre_trade_risk = self.calculate_portfolio_risk(
                portfolio_state,
                market_data,
                risk_scenarios
            )

            # Simulate post-trade portfolio
            simulated_portfolio = portfolio_state.copy()
            trade_value = trade_params['size'] * trade_params['price']
            
            if trade_params['pair'] in simulated_portfolio['positions']:
                simulated_portfolio['positions'][trade_params['pair']]['value'] += trade_value
            else:
                simulated_portfolio['positions'][trade_params['pair']] = {
                    'value': trade_value
                }

            # Calculate post-trade risk metrics
            post_trade_risk = self.calculate_portfolio_risk(
                simulated_portfolio,
                market_data,
                risk_scenarios
            )

            # Validate against risk limits
            risk_score = 0.0
            validation_results = {
                'position_size': trade_value <= self.risk_limits['max_position_size'],
                'concentration': post_trade_risk['concentration'] <= self.risk_limits['max_concentration'],
                'correlation': all(corr <= self.risk_limits['correlation_limit'] 
                                 for corr in post_trade_risk['correlation_matrix'])
            }

            # Calculate comprehensive risk score
            risk_weights = {
                'position_size': 0.3,
                'concentration': 0.3,
                'correlation': 0.4
            }

            risk_score = sum(result * risk_weights[metric] 
                           for metric, result in validation_results.items())

            return (
                risk_score >= RISK_SCORE_THRESHOLD,
                {
                    'risk_score': risk_score,
                    'validation_results': validation_results,
                    'pre_trade_risk': pre_trade_risk,
                    'post_trade_risk': post_trade_risk,
                    'risk_change': {
                        metric: post_trade_risk[metric] - pre_trade_risk[metric]
                        for metric in pre_trade_risk
                        if isinstance(pre_trade_risk[metric], (int, float))
                    }
                }
            )

        except Exception as e:
            return False, {'error': str(e)}