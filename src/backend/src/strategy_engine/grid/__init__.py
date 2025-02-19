"""
Grid Trading Strategy Package

Provides a comprehensive implementation of grid trading strategy with enhanced error handling,
performance monitoring, and risk management integration.

Dependencies:
trading_risk_manager==1.0.0 - Risk management and monitoring integration
trading_performance_monitor==1.0.0 - Performance monitoring and metrics tracking
"""

from strategy_engine.grid.manager import GridManager
from strategy_engine.grid.calculator import GridCalculator
from strategy_engine.base import BaseStrategy
import trading_risk_manager as risk_management
import trading_performance_monitor as performance_monitor
import uuid
import logging
from typing import Dict, List, Optional

# Strategy configuration constants
STRATEGY_NAME = "grid_trading"
STRATEGY_VERSION = "1.0.0"
MIN_GRID_LEVELS = 5
MAX_GRID_LEVELS = 100
DEFAULT_RISK_TOLERANCE = 0.02

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@performance_monitor.track_execution_time
def validate_parameters(func):
    """
    Decorator for validating strategy parameters with comprehensive error checking.
    """
    def wrapper(strategy_id: str, strategy_params: Dict, trading_pairs: List[str], risk_params: Dict):
        try:
            # Validate strategy_id format
            try:
                uuid.UUID(strategy_id)
            except ValueError:
                raise ValueError("Invalid strategy_id format - must be a valid UUID")

            # Validate trading pairs
            if not trading_pairs or not isinstance(trading_pairs, list):
                raise ValueError("trading_pairs must be a non-empty list")
            
            # Validate strategy parameters
            required_params = {'grid_levels', 'profit_target', 'max_position_size'}
            if not all(param in strategy_params for param in required_params):
                missing_params = required_params - set(strategy_params.keys())
                raise ValueError(f"Missing required strategy parameters: {missing_params}")

            # Validate grid levels
            grid_levels = strategy_params['grid_levels']
            if not MIN_GRID_LEVELS <= grid_levels <= MAX_GRID_LEVELS:
                raise ValueError(f"Grid levels must be between {MIN_GRID_LEVELS} and {MAX_GRID_LEVELS}")

            # Validate risk parameters
            required_risk_params = {'max_drawdown', 'risk_tolerance', 'emergency_stop_threshold'}
            if not all(param in risk_params for param in required_risk_params):
                missing_risk_params = required_risk_params - set(risk_params.keys())
                raise ValueError(f"Missing required risk parameters: {missing_risk_params}")

            return func(strategy_id, strategy_params, trading_pairs, risk_params)

        except Exception as e:
            logger.error(f"Parameter validation failed: {str(e)}")
            raise

    return wrapper

@validate_parameters
@performance_monitor.track_execution_time
def create_grid_strategy(
    strategy_id: str,
    strategy_params: Dict,
    trading_pairs: List[str],
    risk_params: Dict
) -> GridManager:
    """
    Enhanced factory function to create and initialize a grid trading strategy instance
    with comprehensive validation, risk management, and performance monitoring.

    Args:
        strategy_id (str): Unique identifier for the strategy instance
        strategy_params (Dict): Grid strategy configuration parameters
        trading_pairs (List[str]): List of trading pairs to monitor
        risk_params (Dict): Risk management parameters and limits

    Returns:
        GridManager: Initialized grid trading strategy instance with active monitoring

    Raises:
        ValueError: If parameter validation fails
        RuntimeError: If strategy initialization fails
    """
    try:
        logger.info(f"Initializing grid strategy {strategy_id} for pairs {trading_pairs}")

        # Initialize risk management
        risk_manager = risk_management.RiskManager(
            config={
                'strategy_id': strategy_id,
                'risk_limits': risk_params,
                'monitoring_timeframes': ["1m", "5m", "15m", "1h"],
                'emergency_threshold': risk_params.get('emergency_stop_threshold', 0.25)
            }
        )

        # Initialize performance monitoring
        performance_monitor.initialize(
            strategy_id=strategy_id,
            metrics_config={
                'execution_latency': True,
                'trade_performance': True,
                'risk_metrics': True
            }
        )

        # Create grid calculator instance
        calculator = GridCalculator(
            strategy_config=strategy_params,
            portfolio_value=strategy_params.get('portfolio_value', 0),
            market_constraints=strategy_params.get('market_constraints', {})
        )

        # Validate grid setup for each trading pair
        for pair in trading_pairs:
            setup_valid = calculator.validate_grid_setup(
                trading_pair=pair,
                grid_params=strategy_params
            )
            if not setup_valid:
                raise ValueError(f"Invalid grid setup for trading pair {pair}")

        # Create and configure grid manager
        grid_manager = GridManager(
            config={
                'strategy_id': strategy_id,
                'trading_pairs': trading_pairs,
                'grid_config': strategy_params,
                'risk_config': risk_params
            },
            risk_manager=risk_manager,
            performance_config={
                'monitoring_enabled': True,
                'metrics_interval': 60,
                'alert_thresholds': strategy_params.get('alert_thresholds', {})
            }
        )

        # Start risk monitoring
        risk_manager.start_monitoring()

        logger.info(f"Grid strategy {strategy_id} initialized successfully")
        
        return grid_manager

    except Exception as e:
        logger.error(f"Failed to create grid strategy: {str(e)}")
        raise RuntimeError(f"Strategy initialization failed: {str(e)}")

# Export strategy components
__all__ = [
    'GridManager',
    'GridCalculator',
    'create_grid_strategy',
    'STRATEGY_VERSION'
]