"""
Strategy Engine Initialization Module

Initializes the strategy engine module and exposes core trading strategy implementations
with comprehensive error handling, versioning support, and performance optimizations.

Dependencies:
logging==built-in - Strategy execution logging
functools==built-in - Caching and retry decorators
"""

import logging
from functools import lru_cache
from typing import Dict, Optional, Type

from strategy_engine.base import BaseStrategy, validate_market_data, validate_trade
from strategy_engine.grid.manager import GridStrategyManager
from strategy_engine.ml.models import PricePredictionModel, RLTradingAgent

# Global constants for strategy management
STRATEGY_TYPES = {
    "grid": GridStrategyManager,
    "ml": RLTradingAgent,
    "version": "1.0.0"
}

# Default strategy configuration with risk limits
DEFAULT_STRATEGY_CONFIG = {
    "risk_limits": {
        "max_position_size_bps": 5000,  # 50% of portfolio
        "min_position_size_bps": 100,   # 1% of portfolio
        "max_drawdown": 0.15,           # 15% maximum drawdown
        "correlation_limit": 0.7,        # 70% correlation limit
        "var_confidence_level": 0.95     # 95% VaR confidence level
    },
    "retry_attempts": 3,
    "cache_timeout": 300,  # 5 minutes cache timeout
    "monitoring": {
        "enabled": True,
        "update_interval": 5,  # 5 seconds update interval
        "metrics_history": 1000  # Store last 1000 metrics
    }
}

# Initialize module logger
logger = logging.getLogger(__name__)

def validate_config(func):
    """
    Decorator for validating strategy configuration parameters.
    """
    def wrapper(strategy_type: str, config: Dict, version: Optional[str] = None) -> BaseStrategy:
        if strategy_type not in STRATEGY_TYPES:
            raise ValueError(f"Invalid strategy type: {strategy_type}")
            
        if version and version != STRATEGY_TYPES["version"]:
            raise ValueError(f"Version mismatch. Required: {STRATEGY_TYPES['version']}, Got: {version}")
            
        # Merge with default config
        merged_config = DEFAULT_STRATEGY_CONFIG.copy()
        merged_config.update(config)
        
        return func(strategy_type, merged_config, version)
    return wrapper

@lru_cache(maxsize=128, typed=True)
def get_cached_strategy(strategy_type: str, config_hash: str) -> Optional[BaseStrategy]:
    """
    Retrieve cached strategy instance if available.
    
    Args:
        strategy_type: Type of strategy
        config_hash: Hash of strategy configuration
        
    Returns:
        Optional[BaseStrategy]: Cached strategy instance if found
    """
    return None  # Actual caching implementation would store strategy instances

@validate_config
def create_strategy(strategy_type: str, config: Dict, version: Optional[str] = None) -> BaseStrategy:
    """
    Factory function to create and initialize trading strategy instances with enhanced
    error handling, caching, and version management.
    
    Args:
        strategy_type (str): Type of strategy to create
        config (Dict): Strategy configuration parameters
        version (Optional[str]): Strategy version for compatibility check
        
    Returns:
        BaseStrategy: Initialized strategy instance
        
    Raises:
        ValueError: If strategy type is invalid or version is incompatible
        RuntimeError: If strategy initialization fails
    """
    try:
        # Check strategy cache
        config_hash = str(hash(frozenset(config.items())))
        cached_strategy = get_cached_strategy(strategy_type, config_hash)
        if cached_strategy:
            logger.info(f"Retrieved cached strategy instance: {strategy_type}")
            return cached_strategy
            
        # Initialize strategy class
        strategy_class: Type[BaseStrategy] = STRATEGY_TYPES[strategy_type]
        
        # Create strategy instance
        strategy_instance = strategy_class(config)
        
        # Set up monitoring if enabled
        if config["monitoring"]["enabled"]:
            logger.info(f"Initializing monitoring for strategy: {strategy_type}")
            # Monitoring setup would be implemented here
            
        # Log strategy creation
        logger.info(
            f"Created new strategy instance: {strategy_type}, "
            f"Version: {version or STRATEGY_TYPES['version']}"
        )
        
        return strategy_instance
        
    except Exception as e:
        logger.error(f"Strategy creation failed: {str(e)}")
        raise RuntimeError(f"Failed to create strategy: {str(e)}")

# Export core components
__all__ = [
    "BaseStrategy",
    "GridStrategyManager",
    "PricePredictionModel",
    "RLTradingAgent",
    "create_strategy",
    "validate_market_data",
    "validate_trade"
]

# Version information
__version__ = STRATEGY_TYPES["version"]