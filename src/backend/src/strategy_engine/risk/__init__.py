"""
Risk Management Module Initialization

Exposes core risk management functionality for the AI trading system, including risk calculation,
monitoring, and control mechanisms with enhanced risk metrics and automated enforcement capabilities.

Dependencies:
numpy==1.24.0 - Vectorized numerical computations for risk calculations
pandas==2.0.0 - Market data manipulation and time-series analysis
scipy==1.10.0 - Advanced statistical functions for risk modeling
asyncio==3.4.3 - Asynchronous risk monitoring and real-time updates
"""

from strategy_engine.risk.calculator import RiskCalculator
from strategy_engine.risk.manager import RiskManager

# Global risk management constants
DEFAULT_CONFIDENCE_LEVEL = 0.95  # 95% confidence level for risk metrics
DEFAULT_LOOKBACK_PERIOD = 24 * 60  # 24 hours in minutes for historical analysis
DEFAULT_MAX_DRAWDOWN = 0.15  # 15% maximum drawdown threshold
DEFAULT_RISK_FREE_RATE = 0.02  # 2% risk-free rate for Sharpe ratio calculation
MAX_POSITION_SIZE_PERCENT = 0.25  # 25% maximum position size as percentage of portfolio
EMERGENCY_SHUTDOWN_THRESHOLD = 0.30  # 30% loss threshold for emergency shutdown

# Export core risk management components
__all__ = [
    # Risk Calculator exports
    'RiskCalculator',
    'calculate_portfolio_risk',
    'validate_trade',
    'calculate_value_at_risk',
    'calculate_sharpe_ratio',
    'calculate_max_position_size',
    'calculate_sortino_ratio',
    'calculate_beta',
    
    # Risk Manager exports
    'RiskManager',
    'monitor_portfolio_risk',
    'validate_strategy_trade',
    'emergency_shutdown',
    'adjust_risk_parameters',
    'get_risk_metrics',
    'set_risk_limits',
    
    # Global constants
    'DEFAULT_CONFIDENCE_LEVEL',
    'DEFAULT_LOOKBACK_PERIOD',
    'DEFAULT_MAX_DRAWDOWN',
    'DEFAULT_RISK_FREE_RATE',
    'MAX_POSITION_SIZE_PERCENT',
    'EMERGENCY_SHUTDOWN_THRESHOLD'
]

# Version information
__version__ = '1.0.0'
__author__ = 'AI Trading Bot Team'
__status__ = 'Production'

def get_default_risk_config():
    """
    Returns the default risk management configuration with production-ready parameters.
    
    Returns:
        dict: Default risk management configuration
    """
    return {
        'confidence_level': DEFAULT_CONFIDENCE_LEVEL,
        'lookback_period': DEFAULT_LOOKBACK_PERIOD,
        'risk_limits': {
            'max_drawdown': DEFAULT_MAX_DRAWDOWN,
            'max_position_size': MAX_POSITION_SIZE_PERCENT,
            'risk_free_rate': DEFAULT_RISK_FREE_RATE,
            'emergency_threshold': EMERGENCY_SHUTDOWN_THRESHOLD
        },
        'monitoring': {
            'update_interval': 5,  # 5 seconds
            'timeframes': ['1m', '5m', '15m', '1h'],
            'alert_levels': {
                'warning': 0.7,
                'critical': 0.9
            }
        }
    }

def initialize_risk_management(config=None):
    """
    Initializes the risk management system with the specified configuration.
    
    Args:
        config (dict, optional): Custom risk management configuration.
                               If None, uses default configuration.
    
    Returns:
        tuple: Initialized RiskCalculator and RiskManager instances
    """
    risk_config = config if config is not None else get_default_risk_config()
    
    calculator = RiskCalculator(
        confidence_level=risk_config['confidence_level'],
        lookback_period=risk_config['lookback_period'],
        risk_limits=risk_config['risk_limits']
    )
    
    manager = RiskManager(risk_config)
    
    return calculator, manager

def validate_risk_config(config):
    """
    Validates a risk management configuration for completeness and correctness.
    
    Args:
        config (dict): Risk management configuration to validate
    
    Returns:
        bool: True if configuration is valid, False otherwise
    
    Raises:
        ValueError: If configuration is invalid with detailed error message
    """
    required_fields = {
        'confidence_level': float,
        'lookback_period': int,
        'risk_limits': dict,
        'monitoring': dict
    }
    
    # Check required fields and types
    for field, field_type in required_fields.items():
        if field not in config:
            raise ValueError(f"Missing required field: {field}")
        if not isinstance(config[field], field_type):
            raise ValueError(f"Invalid type for {field}: expected {field_type.__name__}")
    
    # Validate risk limits
    required_limits = ['max_drawdown', 'max_position_size', 'risk_free_rate', 'emergency_threshold']
    for limit in required_limits:
        if limit not in config['risk_limits']:
            raise ValueError(f"Missing required risk limit: {limit}")
    
    # Validate monitoring configuration
    required_monitoring = ['update_interval', 'timeframes', 'alert_levels']
    for param in required_monitoring:
        if param not in config['monitoring']:
            raise ValueError(f"Missing required monitoring parameter: {param}")
    
    return True