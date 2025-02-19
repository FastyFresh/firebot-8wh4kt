"""
Arbitrage Strategy Engine Initialization Module

High-performance arbitrage detection and execution engine for Solana DEXs with MEV optimization.
Provides comprehensive error handling, logging, and runtime validation for production operation.

Dependencies:
logging==3.11.0 - Strategy logging and monitoring
"""

import logging
from typing import Dict, Tuple, Optional
from strategy_engine.arbitrage.detector import ArbitrageDetector
from strategy_engine.arbitrage.executor import ArbitrageExecutor

# Version and strategy identification
VERSION = "1.0.0"
STRATEGY_NAME = "Arbitrage"

# Configure strategy-specific logging
logger = logging.getLogger(f"strategy_engine.{STRATEGY_NAME.lower()}")
logger.setLevel(logging.INFO)

def create_strategy(config: Dict) -> Tuple[ArbitrageDetector, ArbitrageExecutor]:
    """
    Factory function to create and configure an arbitrage strategy instance with
    comprehensive error handling and validation.

    Args:
        config (Dict): Strategy configuration including:
            - dex_configs: DEX connection parameters and endpoints
            - min_profit_threshold: Minimum profit threshold in basis points
            - risk_limits: Trading risk parameters
            - logging: Logging configuration

    Returns:
        Tuple[ArbitrageDetector, ArbitrageExecutor]: Configured strategy components

    Raises:
        ValueError: If configuration is invalid or missing required parameters
        RuntimeError: If component initialization fails
    """
    try:
        # Configure strategy logging
        log_config = config.get('logging', {})
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        if log_config.get('file_handler'):
            file_handler = logging.FileHandler(log_config['file_handler'])
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)

        # Validate core configuration
        required_configs = {'dex_configs', 'min_profit_threshold', 'risk_limits'}
        if not all(key in config for key in required_configs):
            missing = required_configs - set(config.keys())
            raise ValueError(f"Missing required configuration parameters: {missing}")

        # Validate DEX configurations
        dex_configs = config['dex_configs']
        required_dex_params = {'endpoint', 'api_version', 'timeout_ms'}
        for dex, dex_config in dex_configs.items():
            if not all(param in dex_config for param in required_dex_params):
                raise ValueError(f"Invalid DEX configuration for {dex}")

        logger.info(f"Initializing {STRATEGY_NAME} strategy v{VERSION}")

        # Initialize detector with validated config
        detector = ArbitrageDetector(
            dex_configs=dex_configs,
            min_profit_threshold=config['min_profit_threshold']
        )
        logger.info("Arbitrage detector initialized successfully")

        # Initialize executor with detector reference
        executor = ArbitrageExecutor(
            dex_configs=dex_configs,
            min_profit_threshold=config['min_profit_threshold']
        )
        logger.info("Arbitrage executor initialized successfully")

        # Verify component compatibility
        if not _verify_components(detector, executor):
            raise RuntimeError("Strategy components verification failed")

        # Configure circuit breakers and risk limits
        _configure_risk_limits(detector, executor, config['risk_limits'])
        logger.info("Risk limits and circuit breakers configured")

        # Register cleanup handlers
        import atexit
        atexit.register(_cleanup_strategy, detector, executor)
        
        logger.info(f"{STRATEGY_NAME} strategy initialization completed successfully")
        return detector, executor

    except Exception as e:
        logger.error(f"Strategy initialization failed: {str(e)}")
        raise

def _verify_components(detector: ArbitrageDetector, 
                      executor: ArbitrageExecutor) -> bool:
    """Verify compatibility and health of strategy components."""
    try:
        # Verify detector configuration
        if not hasattr(detector, 'dex_configs') or not detector.dex_configs:
            return False

        # Verify executor configuration
        if not hasattr(executor, 'dex_configs') or not executor.dex_configs:
            return False

        # Verify matching configurations
        if detector.dex_configs.keys() != executor.dex_configs.keys():
            return False

        return True

    except Exception as e:
        logger.error(f"Component verification failed: {str(e)}")
        return False

def _configure_risk_limits(detector: ArbitrageDetector,
                         executor: ArbitrageExecutor,
                         risk_limits: Dict) -> None:
    """Configure risk management parameters for strategy components."""
    try:
        # Set detector risk limits
        detector.min_profit_threshold = max(
            risk_limits.get('min_profit_threshold_bps', 20),
            detector.min_profit_threshold
        )

        # Set executor risk limits
        executor.base_strategy.risk_limits.update({
            'max_position_size_bps': risk_limits.get('max_position_size_bps', 1000),
            'min_position_size_bps': risk_limits.get('min_position_size_bps', 10),
            'max_drawdown': risk_limits.get('max_drawdown', 0.05),
            'var_confidence_level': risk_limits.get('var_confidence_level', 0.95)
        })

    except Exception as e:
        logger.error(f"Risk limit configuration failed: {str(e)}")
        raise

def _cleanup_strategy(detector: ArbitrageDetector,
                     executor: ArbitrageExecutor) -> None:
    """Perform cleanup operations on strategy shutdown."""
    try:
        logger.info("Initiating strategy cleanup")
        
        # Log final statistics
        logger.info(f"Detection stats: {detector.detection_stats}")
        logger.info(f"Execution stats: {executor.execution_stats}")
        
        # Close any open connections
        # Additional cleanup logic would go here
        
        logger.info("Strategy cleanup completed successfully")

    except Exception as e:
        logger.error(f"Strategy cleanup failed: {str(e)}")

# Export strategy components
__all__ = [
    'VERSION',
    'STRATEGY_NAME',
    'create_strategy',
    'ArbitrageDetector',
    'ArbitrageExecutor'
]