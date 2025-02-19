"""
Grid Trading Calculator Module

Implements advanced grid trading calculations with dynamic optimization for grid levels,
position sizes, and profit targets with volatility-based adaptations.

Dependencies:
numpy==1.24.0 - Numerical computations for grid calculations and volatility analysis
pandas==2.0.0 - Market data analysis and grid optimization
scipy==1.10.0 - Statistical calculations for grid spacing and volatility modeling
"""

import numpy as np
import pandas as pd
from scipy import stats
from strategy_engine.base import BaseStrategy
from strategy_engine.risk.calculator import RiskCalculator

# Global constants for grid trading calculations
MIN_GRID_LEVELS = 3
MAX_GRID_LEVELS = 20
MIN_GRID_SPACING = 0.001
MAX_GRID_SPACING = 0.05
DEFAULT_GRID_PROFIT_TARGET = 0.002
VOLATILITY_WINDOW = 24
RISK_ADJUSTMENT_FACTOR = 0.8
MARKET_IMPACT_THRESHOLD = 0.01

@staticmethod
def calculate_grid_spacing(market_data: pd.DataFrame, target_profit: float, volume_profile: float) -> float:
    """
    Calculates optimal grid spacing based on market volatility, volume profile, and target profit.
    
    Args:
        market_data (pd.DataFrame): Historical market data with price and volume
        target_profit (float): Target profit percentage per grid level
        volume_profile (float): Volume profile metric for liquidity assessment
    
    Returns:
        float: Optimized grid spacing value
    """
    try:
        # Calculate volatility using exponential weighted moving average
        returns = market_data['price'].pct_change()
        volatility = returns.ewm(span=VOLATILITY_WINDOW).std().iloc[-1]
        
        # Analyze volume profile for liquidity distribution
        volume_weighted_price = (market_data['price'] * market_data['volume']).sum() / market_data['volume'].sum()
        volume_profile_factor = min(1.0, volume_profile / MARKET_IMPACT_THRESHOLD)
        
        # Calculate base grid spacing from volatility and target profit
        base_spacing = volatility * np.sqrt(VOLATILITY_WINDOW) * RISK_ADJUSTMENT_FACTOR
        
        # Adjust spacing based on volume profile and target profit
        adjusted_spacing = base_spacing * (1 + (1 - volume_profile_factor))
        profit_adjusted_spacing = max(target_profit, adjusted_spacing)
        
        # Ensure spacing is within allowed range
        final_spacing = np.clip(profit_adjusted_spacing, MIN_GRID_SPACING, MAX_GRID_SPACING)
        
        return float(final_spacing)
        
    except Exception as e:
        raise ValueError(f"Error calculating grid spacing: {str(e)}")

class GridCalculator:
    """
    Advanced calculator for grid trading strategy parameters with dynamic optimization
    and risk management integration.
    """
    
    def __init__(self, strategy_config: dict, portfolio_value: float, market_constraints: dict) -> None:
        """
        Initialize grid calculator with strategy configuration and market constraints.
        
        Args:
            strategy_config (dict): Strategy parameters and configuration
            portfolio_value (float): Current portfolio value
            market_constraints (dict): Market-specific constraints and limits
        """
        self.grid_config = strategy_config.get('grid_config', {})
        self.portfolio_value = portfolio_value
        self.market_constraints = market_constraints
        self.risk_calculator = RiskCalculator(
            confidence_level=strategy_config.get('confidence_level', 0.95),
            market_parameters=market_constraints
        )
        self.volatility_history = np.zeros(VOLATILITY_WINDOW)
        
        # Validate configuration
        if not self._validate_config():
            raise ValueError("Invalid grid strategy configuration")

    def _validate_config(self) -> bool:
        """
        Validates grid strategy configuration parameters.
        
        Returns:
            bool: True if configuration is valid, False otherwise
        """
        required_params = {'profit_target', 'max_positions', 'risk_limits'}
        return all(param in self.grid_config for param in required_params)

    def optimize_grid_parameters(self, market_data: pd.DataFrame, market_conditions: dict) -> dict:
        """
        Optimizes grid trading parameters with advanced market adaptation and risk controls.
        
        Args:
            market_data (pd.DataFrame): Recent market data for analysis
            market_conditions (dict): Current market conditions and metrics
        
        Returns:
            dict: Optimized grid parameters with risk adjustments
        """
        try:
            # Validate market data
            if not BaseStrategy.validate_market_data(market_data):
                raise ValueError("Invalid market data for grid optimization")
            
            # Update volatility history
            returns = market_data['price'].pct_change().dropna()
            current_volatility = returns.std()
            self.volatility_history = np.roll(self.volatility_history, -1)
            self.volatility_history[-1] = current_volatility
            
            # Calculate volume profile
            volume_profile = market_data['volume'].mean() / market_data['volume'].max()
            
            # Calculate optimal grid spacing
            grid_spacing = calculate_grid_spacing(
                market_data,
                self.grid_config.get('profit_target', DEFAULT_GRID_PROFIT_TARGET),
                volume_profile
            )
            
            # Determine optimal number of grid levels based on volatility
            volatility_factor = np.mean(self.volatility_history) / current_volatility
            base_levels = (MAX_GRID_LEVELS + MIN_GRID_LEVELS) // 2
            grid_levels = int(np.clip(
                base_levels * volatility_factor,
                MIN_GRID_LEVELS,
                MAX_GRID_LEVELS
            ))
            
            # Calculate position sizes with risk adjustment
            position_size = self.risk_calculator.calculate_position_size(
                market_data={
                    'volatility': current_volatility,
                    'average_volume': market_data['volume'].mean()
                },
                portfolio_value=self.portfolio_value,
                existing_positions={},
                market_impact_params=self.market_constraints
            )
            
            # Apply market impact constraints
            max_position_size = position_size['recommended_size']
            per_grid_size = max_position_size / grid_levels
            
            # Validate final grid setup
            risk_validation = self.risk_calculator.validate_trade(
                {
                    'size': per_grid_size,
                    'price': market_data['price'].iloc[-1]
                },
                {'positions': {}},
                market_data,
                {'base_scenario': {'shock_factor': 1.0}}
            )
            
            if not risk_validation[0]:
                raise ValueError("Grid setup failed risk validation")
            
            return {
                'grid_levels': grid_levels,
                'grid_spacing': grid_spacing,
                'position_size': per_grid_size,
                'total_position': max_position_size,
                'risk_metrics': risk_validation[1],
                'market_metrics': {
                    'volatility': current_volatility,
                    'volume_profile': volume_profile,
                    'market_impact': position_size['risk_metrics']['market_impact']
                }
            }
            
        except Exception as e:
            raise ValueError(f"Error optimizing grid parameters: {str(e)}")