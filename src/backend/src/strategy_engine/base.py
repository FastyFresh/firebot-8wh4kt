"""
Base Strategy Module

Provides the abstract base class for all trading strategies with comprehensive risk management,
market validation, and portfolio analytics capabilities.

Dependencies:
numpy==1.24.0 - Numerical computations for strategy calculations and risk metrics
pandas==2.0.0 - Market data manipulation, time series analysis, and portfolio analytics
"""

import numpy as np
import pandas as pd
from abc import ABC, abstractmethod
from typing import Dict, Tuple, Optional

# Global constants for strategy configuration and risk management
MIN_MARKET_DATA_POINTS = 100
MAX_TRADE_SLIPPAGE = 0.01
DEFAULT_CONFIDENCE_LEVEL = 0.95
MAX_POSITION_SIZE_BPS = 5000  # 50% of portfolio
MIN_POSITION_SIZE_BPS = 100   # 1% of portfolio

class BaseStrategy(ABC):
    """
    Abstract base class for all trading strategies providing core functionality for
    strategy execution, risk management, and market data validation with comprehensive
    portfolio analytics.
    """
    
    def __init__(self, config: Dict) -> None:
        """
        Initialize the base strategy with comprehensive configuration and risk management setup.
        
        Args:
            config (Dict): Strategy configuration including trading pairs, timeframes,
                          risk limits, and execution parameters.
        
        Raises:
            ValueError: If required configuration parameters are missing or invalid.
        """
        self._validate_config(config)
        self.strategy_config = config
        self.market_data: Optional[pd.DataFrame] = None
        self.portfolio_state: Dict = {
            'positions': {},
            'balance': 0.0,
            'equity': 0.0
        }
        self.risk_limits = {
            'max_position_size_bps': config.get('max_position_size_bps', MAX_POSITION_SIZE_BPS),
            'min_position_size_bps': config.get('min_position_size_bps', MIN_POSITION_SIZE_BPS),
            'max_drawdown': config.get('max_drawdown', 0.15),
            'var_confidence_level': config.get('var_confidence_level', DEFAULT_CONFIDENCE_LEVEL)
        }
        self.correlation_matrix: Optional[np.ndarray] = None
        self.performance_metrics: Dict = {
            'returns': [],
            'sharpe_ratio': None,
            'max_drawdown': None,
            'win_rate': None
        }
        self.risk_metrics: Dict = {
            'var': None,
            'position_exposure': {},
            'concentration': None,
            'liquidity_score': None
        }

    def _validate_config(self, config: Dict) -> None:
        """
        Validate the strategy configuration parameters.
        
        Args:
            config (Dict): Strategy configuration to validate.
            
        Raises:
            ValueError: If required parameters are missing or invalid.
        """
        required_params = {'trading_pairs', 'timeframe', 'risk_limits'}
        if not all(param in config for param in required_params):
            missing_params = required_params - set(config.keys())
            raise ValueError(f"Missing required configuration parameters: {missing_params}")

    @staticmethod
    def validate_market_data(market_data: pd.DataFrame) -> bool:
        """
        Comprehensive market data validation including price anomaly detection and volume analysis.
        
        Args:
            market_data (pd.DataFrame): Market data to validate with required columns
                                      [timestamp, price, volume, pair]
        
        Returns:
            bool: True if data is valid, False otherwise
        """
        try:
            # Check data completeness
            required_columns = {'timestamp', 'price', 'volume', 'pair'}
            if not all(col in market_data.columns for col in required_columns):
                return False
                
            # Validate data size
            if len(market_data) < MIN_MARKET_DATA_POINTS:
                return False
                
            # Check for timestamp sequence and gaps
            market_data = market_data.sort_values('timestamp')
            time_diffs = np.diff(market_data['timestamp'])
            if np.any(time_diffs <= 0):
                return False
                
            # Detect price anomalies
            rolling_std = market_data['price'].rolling(window=20).std()
            price_zscore = np.abs((market_data['price'] - market_data['price'].rolling(window=20).mean()) / rolling_std)
            if np.any(price_zscore > 4):  # More than 4 standard deviations
                return False
                
            # Validate volume data
            if np.any(market_data['volume'] <= 0):
                return False
                
            return True
            
        except Exception:
            return False

    def calculate_portfolio_risk(self) -> Dict:
        """
        Calculate comprehensive portfolio risk metrics including VaR, correlation,
        and concentration analysis.
        
        Returns:
            Dict: Portfolio risk metrics including VaR, exposure, correlation, and concentration
        """
        if self.market_data is None or self.portfolio_state['positions'] == {}:
            return self.risk_metrics

        try:
            # Calculate Value at Risk (VaR)
            returns = self.market_data.groupby('pair')['price'].pct_change()
            position_values = {
                pair: pos['size'] * self.market_data[self.market_data['pair'] == pair]['price'].iloc[-1]
                for pair, pos in self.portfolio_state['positions'].items()
            }
            
            portfolio_var = self._calculate_var(returns, position_values)
            
            # Update correlation matrix
            self.correlation_matrix = returns.pivot(columns='pair').corr().values
            
            # Calculate concentration metrics
            total_value = sum(position_values.values())
            concentration = max(value / total_value for value in position_values.values()) if total_value > 0 else 0
            
            # Update risk metrics
            self.risk_metrics.update({
                'var': portfolio_var,
                'position_exposure': position_values,
                'concentration': concentration,
                'correlation_matrix': self.correlation_matrix.tolist(),
                'liquidity_score': self._calculate_liquidity_score()
            })
            
            return self.risk_metrics
            
        except Exception as e:
            self.risk_metrics['calculation_error'] = str(e)
            return self.risk_metrics

    def validate_trade(self, trade_params: Dict) -> Tuple[bool, Dict]:
        """
        Validate proposed trade against risk limits and market conditions.
        
        Args:
            trade_params (Dict): Trade parameters including pair, size, and price
        
        Returns:
            Tuple[bool, Dict]: (Validation result, Risk metrics)
        """
        validation_result = True
        risk_metrics = {}
        
        try:
            # Validate trade size
            portfolio_value = self.portfolio_state['equity']
            trade_value = trade_params['size'] * trade_params['price']
            position_size_bps = (trade_value / portfolio_value) * 10000
            
            if position_size_bps < self.risk_limits['min_position_size_bps'] or \
               position_size_bps > self.risk_limits['max_position_size_bps']:
                validation_result = False
                risk_metrics['size_error'] = 'Position size outside allowed limits'
            
            # Estimate slippage
            if self.market_data is not None:
                volume_data = self.market_data[self.market_data['pair'] == trade_params['pair']]['volume'].iloc[-100:]
                avg_volume = volume_data.mean()
                estimated_slippage = (trade_value / avg_volume) * 0.01
                
                if estimated_slippage > MAX_TRADE_SLIPPAGE:
                    validation_result = False
                    risk_metrics['slippage_error'] = 'Estimated slippage too high'
            
            # Check portfolio concentration
            new_position_value = trade_value
            if trade_params['pair'] in self.portfolio_state['positions']:
                new_position_value += self.portfolio_state['positions'][trade_params['pair']]['value']
            
            concentration = new_position_value / portfolio_value
            if concentration > 0.5:  # Max 50% in single position
                validation_result = False
                risk_metrics['concentration_error'] = 'Position would exceed concentration limits'
            
            risk_metrics.update({
                'position_size_bps': position_size_bps,
                'estimated_slippage': estimated_slippage if 'estimated_slippage' in locals() else None,
                'concentration': concentration
            })
            
            return validation_result, risk_metrics
            
        except Exception as e:
            return False, {'error': str(e)}

    def _calculate_var(self, returns: pd.DataFrame, position_values: Dict) -> float:
        """
        Calculate Value at Risk using historical simulation method.
        
        Args:
            returns (pd.DataFrame): Historical returns data
            position_values (Dict): Current position values
            
        Returns:
            float: Portfolio VaR at configured confidence level
        """
        portfolio_returns = sum(returns[pair] * value for pair, value in position_values.items())
        var = np.percentile(portfolio_returns, (1 - self.risk_limits['var_confidence_level']) * 100)
        return abs(var)

    def _calculate_liquidity_score(self) -> float:
        """
        Calculate portfolio liquidity score based on position sizes and market volumes.
        
        Returns:
            float: Liquidity score between 0 and 1
        """
        if self.market_data is None:
            return 0.0
            
        try:
            liquidity_scores = []
            for pair, position in self.portfolio_state['positions'].items():
                pair_data = self.market_data[self.market_data['pair'] == pair]
                avg_volume = pair_data['volume'].mean()
                position_volume = position['size']
                liquidity_scores.append(min(1.0, avg_volume / position_volume))
            
            return np.mean(liquidity_scores) if liquidity_scores else 1.0
            
        except Exception:
            return 0.0

    @abstractmethod
    def execute(self) -> Dict:
        """
        Abstract method for strategy execution to be implemented by concrete strategy classes.
        
        Returns:
            Dict: Execution results including trades, metrics, and performance data
        
        Raises:
            NotImplementedError: Must be implemented by concrete strategy classes
        """
        raise NotImplementedError("Strategy execution must be implemented by concrete strategy classes")