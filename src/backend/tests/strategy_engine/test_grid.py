"""
Grid Trading Strategy Test Suite

Comprehensive test suite for grid trading strategy implementation covering parameter optimization,
execution monitoring, risk management integration, and performance validation.

Dependencies:
pytest==7.3.0 - Testing framework and assertions
numpy==1.24.0 - Numerical test data generation and calculations
pandas==2.0.0 - Market data fixtures and test data manipulation
pytest_asyncio==0.21.0 - Async test support for strategy execution tests
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import pytest_asyncio

from strategy_engine.grid.calculator import GridCalculator
from strategy_engine.grid.manager import GridStrategyManager
from strategy_engine.risk.manager import RiskManager

# Test Constants
TEST_PORTFOLIO_VALUE = 100000.0  # $100k test portfolio
TEST_CONFIDENCE_LEVEL = 0.95
TEST_GRID_LEVELS = 10
TEST_GRID_SPACING = 0.01
TEST_RISK_LIMIT = 0.15
TEST_EXECUTION_TIMEOUT = 0.5  # 500ms execution timeout

@pytest.fixture
def setup_test_market_data():
    """
    Creates comprehensive test market data for grid strategy testing with volatility simulation.
    
    Returns:
        pd.DataFrame: Test market data with OHLCV structure and simulated volatility
    """
    # Generate 1000 minutes of test data
    timestamps = pd.date_range(
        start=datetime.now() - timedelta(days=1),
        end=datetime.now(),
        freq='1min'
    )
    
    # Generate price data with realistic volatility
    np.random.seed(42)
    returns = np.random.normal(0, 0.001, len(timestamps))
    price = 100 * np.exp(np.cumsum(returns))
    
    # Generate volume with time-of-day patterns
    base_volume = np.random.lognormal(10, 1, len(timestamps))
    hour_of_day = pd.Series(timestamps).dt.hour
    volume_multiplier = 1 + np.sin(hour_of_day * np.pi / 12)
    volume = base_volume * volume_multiplier
    
    # Create OHLCV DataFrame
    return pd.DataFrame({
        'timestamp': timestamps,
        'price': price,
        'open': price * (1 + np.random.normal(0, 0.0002, len(timestamps))),
        'high': price * (1 + abs(np.random.normal(0, 0.0003, len(timestamps)))),
        'low': price * (1 - abs(np.random.normal(0, 0.0003, len(timestamps)))),
        'close': price,
        'volume': volume,
        'pair': 'SOL/USDC'
    })

@pytest.fixture
def setup_test_config():
    """
    Creates detailed test configuration for grid strategy with risk parameters.
    
    Returns:
        dict: Test strategy configuration with risk limits
    """
    return {
        'portfolio_value': TEST_PORTFOLIO_VALUE,
        'grid_config': {
            'profit_target': 0.002,
            'max_positions': TEST_GRID_LEVELS,
            'risk_limits': {
                'max_drawdown': TEST_RISK_LIMIT,
                'max_position_size_bps': 5000,  # 50% max position size
                'min_position_size_bps': 100    # 1% min position size
            }
        },
        'market_constraints': {
            'min_trade_size': 0.1,
            'max_trade_size': 1000.0,
            'price_precision': 4,
            'size_precision': 2
        },
        'risk_config': {
            'confidence_level': TEST_CONFIDENCE_LEVEL,
            'lookback_period': 30,
            'emergency_threshold': 0.25
        }
    }

class TestGridCalculator:
    """
    Test suite for GridCalculator functionality including optimization and risk validation.
    """
    
    def test_grid_parameter_optimization(self, setup_test_market_data, setup_test_config):
        """Tests grid parameter optimization under various market conditions."""
        calculator = GridCalculator(
            strategy_config=setup_test_config,
            portfolio_value=TEST_PORTFOLIO_VALUE,
            market_constraints=setup_test_config['market_constraints']
        )
        
        # Test optimization with normal market conditions
        result = calculator.optimize_grid_parameters(
            market_data=setup_test_market_data,
            market_conditions={'impact_params': {'coefficient': 0.1}}
        )
        
        # Verify grid parameters are within bounds
        assert result['grid_levels'] >= 3
        assert result['grid_levels'] <= 20
        assert 0.001 <= result['grid_spacing'] <= 0.05
        assert result['position_size'] > 0
        
        # Test optimization with high volatility
        high_vol_data = setup_test_market_data.copy()
        high_vol_data['price'] *= (1 + np.random.normal(0, 0.005, len(high_vol_data)))
        
        vol_result = calculator.optimize_grid_parameters(
            market_data=high_vol_data,
            market_conditions={'impact_params': {'coefficient': 0.1}}
        )
        
        # Verify adaptation to higher volatility
        assert vol_result['grid_spacing'] > result['grid_spacing']
        assert vol_result['position_size'] < result['position_size']
    
    def test_risk_compliance(self, setup_test_market_data, setup_test_config):
        """Tests risk limit enforcement in grid calculations."""
        calculator = GridCalculator(
            strategy_config=setup_test_config,
            portfolio_value=TEST_PORTFOLIO_VALUE,
            market_constraints=setup_test_config['market_constraints']
        )
        
        result = calculator.optimize_grid_parameters(
            market_data=setup_test_market_data,
            market_conditions={'impact_params': {'coefficient': 0.1}}
        )
        
        # Verify position size limits
        max_position_value = result['position_size'] * setup_test_market_data['price'].iloc[-1]
        position_size_bps = (max_position_value / TEST_PORTFOLIO_VALUE) * 10000
        
        assert position_size_bps <= setup_test_config['grid_config']['risk_limits']['max_position_size_bps']
        assert position_size_bps >= setup_test_config['grid_config']['risk_limits']['min_position_size_bps']
        
        # Verify total exposure limits
        total_exposure = result['total_position'] * setup_test_market_data['price'].iloc[-1]
        exposure_ratio = total_exposure / TEST_PORTFOLIO_VALUE
        
        assert exposure_ratio <= 1.0  # Cannot exceed portfolio value
        assert result['risk_metrics']['var'] is not None

class TestGridStrategyManager:
    """
    Test suite for GridStrategyManager execution, monitoring, and error handling.
    """
    
    @pytest.mark.asyncio
    async def test_strategy_execution(self, setup_test_market_data, setup_test_config):
        """Tests end-to-end grid strategy execution and monitoring."""
        risk_manager = RiskManager(setup_test_config['risk_config'])
        
        manager = GridStrategyManager(
            config=setup_test_config,
            risk_manager=risk_manager,
            performance_config={'latency_threshold': TEST_EXECUTION_TIMEOUT}
        )
        
        # Test grid setup
        setup_result = await manager.setup_grid(
            trading_pair='SOL/USDC',
            market_data=setup_test_market_data,
            impact_params={'coefficient': 0.1}
        )
        
        assert setup_result['status'] == 'success'
        assert 'grid_setup' in setup_result
        assert 'levels' in setup_result['grid_setup']
        
        # Test strategy execution
        execution_result = await manager.execute()
        
        assert execution_result['status'] == 'success'
        assert 'execution_results' in execution_result
        assert 'performance_metrics' in execution_result
        
        # Verify execution latency
        assert execution_result['performance_metrics']['execution_time'] <= TEST_EXECUTION_TIMEOUT
        
        # Test grid monitoring
        await manager.monitor_and_adjust()
        assert manager.is_running
        
        # Verify risk metrics
        assert 'risk_metrics' in execution_result['performance_metrics']
        assert execution_result['performance_metrics']['risk_metrics'] is not None
    
    @pytest.mark.asyncio
    async def test_error_handling(self, setup_test_market_data, setup_test_config):
        """Tests error handling and recovery mechanisms."""
        risk_manager = RiskManager(setup_test_config['risk_config'])
        
        manager = GridStrategyManager(
            config=setup_test_config,
            risk_manager=risk_manager,
            performance_config={'latency_threshold': TEST_EXECUTION_TIMEOUT}
        )
        
        # Test invalid market data handling
        invalid_data = setup_test_market_data.copy()
        invalid_data.loc[0, 'price'] = -1.0
        
        with pytest.raises(ValueError):
            await manager.setup_grid(
                trading_pair='SOL/USDC',
                market_data=invalid_data,
                impact_params={'coefficient': 0.1}
            )
        
        # Test recovery after error
        valid_setup = await manager.setup_grid(
            trading_pair='SOL/USDC',
            market_data=setup_test_market_data,
            impact_params={'coefficient': 0.1}
        )
        assert valid_setup['status'] == 'success'
        
        # Test error state tracking
        assert manager.error_states['execution_failures'] == 0
        
        # Test emergency shutdown
        await manager.execute()  # Normal execution
        manager.risk_manager.emergency_stop = True
        
        execution_result = await manager.execute()
        assert 'error' in execution_result or execution_result['status'] != 'success'