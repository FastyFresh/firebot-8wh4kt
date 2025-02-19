import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import asyncio
from typing import Dict

from strategy_engine.risk.calculator import RiskCalculator
from strategy_engine.risk.manager import RiskManager

# Test constants
TEST_CONFIDENCE_LEVEL = 0.95
TEST_LOOKBACK_PERIOD = 30
TEST_PORTFOLIO_VALUE = 1000000  # $1M USDC
TEST_TRADING_PAIRS = ['SOL/USDC', 'ORCA/USDC', 'RAY/USDC']

@pytest.fixture
def market_data() -> pd.DataFrame:
    """Generate synthetic market data for testing."""
    dates = pd.date_range(start='2024-01-01', periods=100, freq='1H')
    data = []
    
    for pair in TEST_TRADING_PAIRS:
        # Generate realistic price movements with some volatility
        base_price = 100.0
        prices = [base_price]
        for _ in range(len(dates)-1):
            price_change = np.random.normal(0, 0.02)  # 2% daily volatility
            prices.append(prices[-1] * (1 + price_change))
            
        # Generate volume data with some clustering
        volumes = np.random.lognormal(10, 1, size=len(dates))
        
        for i, date in enumerate(dates):
            data.append({
                'timestamp': date,
                'pair': pair,
                'price': prices[i],
                'volume': volumes[i],
                'liquidity': volumes[i] * prices[i]
            })
    
    return pd.DataFrame(data)

@pytest.fixture
def risk_calculator() -> RiskCalculator:
    """Initialize RiskCalculator with test configuration."""
    return RiskCalculator(
        confidence_level=TEST_CONFIDENCE_LEVEL,
        lookback_period=TEST_LOOKBACK_PERIOD,
        risk_limits={
            'max_position_size': 5000,  # 50% max position
            'min_position_size': 100,   # 1% min position
            'max_concentration': 0.25,  # 25% concentration limit
            'correlation_limit': 0.7    # 70% correlation limit
        }
    )

@pytest.fixture
def risk_manager() -> RiskManager:
    """Initialize RiskManager with test configuration."""
    config = {
        'confidence_level': TEST_CONFIDENCE_LEVEL,
        'lookback_period': TEST_LOOKBACK_PERIOD,
        'risk_limits': {
            'max_position_size': 5000,
            'min_position_size': 100,
            'max_drawdown': 0.15,
            'emergency_threshold': 0.25
        }
    }
    return RiskManager(config)

class TestRiskCalculator:
    """Test suite for risk calculation components."""
    
    def setup_method(self):
        """Initialize test environment for risk calculations."""
        self.calculator = risk_calculator()
        self.market_data = market_data()
        self.portfolio_state = {
            'positions': {
                'SOL/USDC': {'value': 200000, 'size': 2000},
                'ORCA/USDC': {'value': 150000, 'size': 1500},
                'RAY/USDC': {'value': 100000, 'size': 1000}
            },
            'total_value': TEST_PORTFOLIO_VALUE
        }
    
    def test_value_at_risk_calculation(self):
        """Test VaR calculations under various scenarios."""
        # Calculate returns for VaR computation
        returns = self.market_data.pivot(
            columns='pair', 
            values='price'
        ).pct_change().dropna()
        
        # Test historical VaR
        var_metrics = self.calculator.calculate_value_at_risk(
            returns,
            {'volatility': returns.std()},
            'historical'
        )
        
        # Validate VaR metrics
        assert isinstance(var_metrics, dict)
        assert all(timeframe in var_metrics for timeframe in ['1d', '5d', '10d'])
        assert all(var_metrics[tf]['var'] > 0 for tf in var_metrics)
        assert all(var_metrics[tf]['volatility_adjustment'] > 0 for tf in var_metrics)
        
        # Test VaR under stress conditions
        stress_var = self.calculator.calculate_value_at_risk(
            returns * 2,  # Doubled volatility
            {'volatility': returns.std() * 2},
            'historical'
        )
        
        # Verify stress VaR is higher than normal VaR
        assert all(stress_var[tf]['var'] > var_metrics[tf]['var'] for tf in var_metrics)
    
    def test_position_sizing(self):
        """Test position sizing calculations and limits."""
        market_data = {
            'volatility': 0.5,
            'average_volume': 1000000
        }
        
        # Test normal market conditions
        position_size = self.calculator.calculate_position_size(
            market_data,
            TEST_PORTFOLIO_VALUE,
            self.portfolio_state['positions'],
            {'impact_coefficient': 0.1}
        )
        
        assert isinstance(position_size, dict)
        assert 'recommended_size' in position_size
        assert 'risk_metrics' in position_size
        assert position_size['recommended_size'] > 0
        assert position_size['recommended_size'] <= TEST_PORTFOLIO_VALUE * 0.5  # Max 50%
        
        # Test high volatility scenario
        high_vol_size = self.calculator.calculate_position_size(
            {**market_data, 'volatility': 1.0},
            TEST_PORTFOLIO_VALUE,
            self.portfolio_state['positions'],
            {'impact_coefficient': 0.1}
        )
        
        assert high_vol_size['recommended_size'] < position_size['recommended_size']
        
        # Test liquidity constraints
        low_liquidity_size = self.calculator.calculate_position_size(
            {**market_data, 'average_volume': 100000},
            TEST_PORTFOLIO_VALUE,
            self.portfolio_state['positions'],
            {'impact_coefficient': 0.1}
        )
        
        assert low_liquidity_size['recommended_size'] < position_size['recommended_size']
    
    def test_portfolio_risk_metrics(self):
        """Test portfolio risk metrics calculations."""
        risk_metrics = self.calculator.calculate_portfolio_risk(
            self.portfolio_state,
            self.market_data,
            {
                'base_case': {'shock_factor': 1.0},
                'stress_case': {'shock_factor': 1.5}
            }
        )
        
        # Validate core risk metrics
        assert isinstance(risk_metrics, dict)
        assert 'var_metrics' in risk_metrics
        assert 'correlation_matrix' in risk_metrics
        assert 'concentration' in risk_metrics
        assert 'stress_test_results' in risk_metrics
        
        # Validate correlation matrix
        correlation_matrix = np.array(risk_metrics['correlation_matrix'])
        assert correlation_matrix.shape == (len(TEST_TRADING_PAIRS), len(TEST_TRADING_PAIRS))
        assert np.all(np.abs(correlation_matrix) <= 1.0)
        
        # Validate concentration metrics
        assert 0 <= risk_metrics['concentration'] <= 1.0
        
        # Validate stress test results
        assert all(scenario in risk_metrics['stress_test_results'] 
                  for scenario in ['base_case', 'stress_case'])

@pytest.mark.asyncio
class TestRiskManager:
    """Test suite for risk management functionality."""
    
    async def setup_method(self):
        """Initialize test environment for risk management tests."""
        self.manager = risk_manager()
        self.manager.market_data = market_data()
        self.manager.portfolio_state = {
            'positions': {
                'SOL/USDC': {'value': 200000, 'size': 2000},
                'ORCA/USDC': {'value': 150000, 'size': 1500},
                'RAY/USDC': {'value': 100000, 'size': 1000}
            },
            'risk_metrics': {},
            'last_update': datetime.now()
        }
    
    async def test_risk_monitoring(self):
        """Test continuous risk monitoring functionality."""
        # Start monitoring
        monitoring_started = await self.manager.start_monitoring()
        assert monitoring_started
        
        # Allow monitoring to run briefly
        await asyncio.sleep(1)
        
        # Verify risk metrics are being updated
        risk_metrics = await self.manager.assess_portfolio_risk()
        assert isinstance(risk_metrics, dict)
        assert 'current_drawdown' in risk_metrics
        assert 'liquidity_risk' in risk_metrics
        assert 'correlation_risk' in risk_metrics
        
        # Test monitoring under market stress
        self.manager.market_data['price'] *= 0.8  # Simulate 20% price drop
        stress_metrics = await self.manager.assess_portfolio_risk()
        assert stress_metrics['current_drawdown'] > risk_metrics['current_drawdown']
    
    async def test_breach_handling(self):
        """Test risk breach detection and handling."""
        # Simulate risk breach event
        risk_event = {
            'type': 'concentration_breach',
            'severity': 0.8,
            'metrics': {
                'concentration': 0.35,  # Above 25% limit
                'var': 0.12
            }
        }
        
        # Test breach handling
        response = await self.manager.handle_risk_breach(risk_event)
        assert isinstance(response, dict)
        assert 'severity' in response
        assert 'actions_taken' in response
        
        # Verify appropriate actions were taken
        assert 'reduce_exposure' in response['actions_taken']
        assert not self.manager.emergency_stop  # Should not trigger emergency stop
        
        # Test critical breach
        critical_event = {
            **risk_event,
            'severity': 0.95
        }
        
        critical_response = await self.manager.handle_risk_breach(critical_event)
        assert 'emergency_shutdown' in critical_response['actions_taken']
        assert self.manager.emergency_stop  # Should trigger emergency stop
    
    async def test_emergency_procedures(self):
        """Test emergency shutdown and recovery procedures."""
        # Trigger emergency shutdown
        trigger_event = {
            'type': 'market_crash',
            'severity': 0.9,
            'timestamp': datetime.now()
        }
        
        shutdown_success = await self.manager.emergency_shutdown(trigger_event)
        assert shutdown_success
        assert self.manager.emergency_stop
        
        # Verify trading is suspended
        trade_params = {
            'pair': 'SOL/USDC',
            'size': 1000,
            'price': 100
        }
        is_valid, validation_result = await self.manager.validate_trade(trade_params)
        assert not is_valid
        assert 'error' in validation_result
        assert 'Emergency stop active' in validation_result['error']
        
        # Verify risk state persistence
        await self.manager._persist_risk_state()
        assert len(self.manager.risk_metrics_history['alerts']) > 0