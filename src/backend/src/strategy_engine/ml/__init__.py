"""
Machine Learning Module Initialization

Production-grade initialization of ML components for the trading strategy engine with
comprehensive error handling, resource management, and monitoring capabilities.

Dependencies:
torch==2.0.0 - Deep learning framework with GPU support
numpy==1.24.0 - Numerical computations and array operations
"""

import logging
import os
import sys
from typing import Dict, Tuple, Optional
from functools import wraps

import torch
import numpy as np

from strategy_engine.ml.models import PricePredictionModel, RLTradingAgent
from strategy_engine.ml.predictor import MarketPredictor
from strategy_engine.ml.optimizer import StrategyOptimizer

# Global ML configuration
ML_CONFIG = {
    'LEARNING_RATE': 0.001,
    'BATCH_SIZE': 64,
    'HIDDEN_SIZE': 128,
    'MAX_EPOCHS': 1000,
    'PREDICTION_WINDOW': 24,
    'CONFIDENCE_THRESHOLD': 0.75,
    'MODEL_CHECKPOINT_PATH': '/opt/trading/checkpoints',
    'ERROR_THRESHOLDS': {
        'MAX_PREDICTION_ERROR': 0.05,
        'MAX_OPTIMIZATION_TIME': 300,
        'MIN_CONFIDENCE_SCORE': 0.8
    },
    'MONITORING_CONFIG': {
        'METRICS_INTERVAL': 60,
        'ALERT_THRESHOLD': 0.9,
        'LOG_LEVEL': 'INFO'
    },
    'RESOURCE_LIMITS': {
        'MAX_GPU_MEMORY': '8GB',
        'MAX_CPU_USAGE': '80%',
        'MAX_DISK_USAGE': '90%'
    }
}

VERSION = '1.0.0'

# Configure logging
logging.basicConfig(
    level=getattr(logging, ML_CONFIG['MONITORING_CONFIG']['LOG_LEVEL']),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def validate_resources(func):
    """Decorator for validating system resources before component initialization."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            # Check GPU availability and memory
            if torch.cuda.is_available():
                gpu_memory = torch.cuda.get_device_properties(0).total_memory
                memory_usage = torch.cuda.memory_allocated() / gpu_memory
                if memory_usage > 0.9:  # 90% threshold
                    logger.warning("GPU memory usage too high, falling back to CPU")
                    torch.cuda.empty_cache()
            
            # Check disk space
            disk_usage = os.statvfs('/').f_bfree / os.statvfs('/').f_blocks
            if disk_usage < 0.1:  # Less than 10% free
                raise ResourceWarning("Insufficient disk space")
            
            # Ensure checkpoint directory exists
            os.makedirs(ML_CONFIG['MODEL_CHECKPOINT_PATH'], exist_ok=True)
            
            return func(*args, **kwargs)
            
        except Exception as e:
            logger.error(f"Resource validation failed: {str(e)}")
            raise
    return wrapper

def monitor_initialization(func):
    """Decorator for monitoring component initialization."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            start_time = torch.cuda.Event(enable_timing=True)
            end_time = torch.cuda.Event(enable_timing=True)
            
            start_time.record()
            result = func(*args, **kwargs)
            end_time.record()
            
            torch.cuda.synchronize()
            initialization_time = start_time.elapsed_time(end_time)
            
            logger.info(f"Component initialization completed in {initialization_time:.2f}ms")
            return result
            
        except Exception as e:
            logger.error(f"Initialization monitoring failed: {str(e)}")
            raise
    return wrapper

def handle_errors(func):
    """Decorator for comprehensive error handling during initialization."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ValueError as e:
            logger.error(f"Validation error: {str(e)}")
            raise
        except RuntimeError as e:
            logger.error(f"Runtime error: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            raise
    return wrapper

@validate_resources
@monitor_initialization
@handle_errors
def initialize_ml_components(config: Dict) -> Tuple[MarketPredictor, RLTradingAgent, StrategyOptimizer, bool]:
    """
    Initialize all ML components with comprehensive validation and monitoring.
    
    Args:
        config: Configuration dictionary for ML components
        
    Returns:
        Tuple containing initialized predictor, agent, optimizer instances and validation status
        
    Raises:
        ValueError: If configuration validation fails
        RuntimeError: If component initialization fails
        ResourceWarning: If system resources are insufficient
    """
    try:
        # Validate configuration
        if not all(k in config for k in ['model_params', 'agent_params', 'optimizer_params']):
            raise ValueError("Incomplete configuration parameters")
        
        # Set device with error handling
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {device}")
        
        # Initialize price prediction model
        model = PricePredictionModel(
            input_size=len(config['model_params']['feature_columns']),
            hidden_size=ML_CONFIG['HIDDEN_SIZE'],
            num_layers=config['model_params'].get('num_layers', 3)
        ).to(device)
        
        # Validate model checksum
        if not model.validate_checksum():
            raise ValueError("Model checksum validation failed")
        
        # Initialize market predictor
        predictor = MarketPredictor(model, config['model_params'])
        
        # Initialize RL trading agent
        agent = RLTradingAgent(
            state_size=config['agent_params']['state_size'],
            action_size=config['agent_params']['action_size'],
            config=config['agent_params']
        )
        
        # Validate agent state
        if not agent.validate_state():
            raise ValueError("Agent state validation failed")
        
        # Initialize strategy optimizer with metrics collector
        optimizer = StrategyOptimizer(
            agent=agent,
            predictor=predictor,
            config=config['optimizer_params'],
            logger=logger,
            metrics_collector=config.get('metrics_collector')
        )
        
        # Validate resource monitoring
        if not optimizer.monitor_resource_usage():
            raise ResourceWarning("Resource monitoring initialization failed")
        
        # Setup performance monitoring
        logger.info("Setting up performance monitoring...")
        monitoring_config = ML_CONFIG['MONITORING_CONFIG']
        
        # Validate all components
        validation_status = all([
            predictor.validate_predictions(),
            agent.validate_state(),
            optimizer.evaluate_performance() > monitoring_config['ALERT_THRESHOLD']
        ])
        
        if not validation_status:
            logger.warning("Component validation incomplete")
        
        return predictor, agent, optimizer, validation_status
        
    except Exception as e:
        logger.error(f"ML component initialization failed: {str(e)}")
        raise

# Export components and configuration
__all__ = [
    'PricePredictionModel',
    'RLTradingAgent',
    'MarketPredictor',
    'StrategyOptimizer',
    'initialize_ml_components',
    'ML_CONFIG',
    'VERSION'
]