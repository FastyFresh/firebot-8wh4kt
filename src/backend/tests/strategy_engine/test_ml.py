"""
Comprehensive test suite for machine learning components of the trading strategy engine.
Tests price prediction models, RL trading agents, market prediction, and strategy optimization
with enhanced focus on production reliability and risk management.

Dependencies:
pytest==7.3.0 - Testing framework with async support
torch==2.0.0 - Deep learning framework with GPU support
numpy==1.24.0 - Numerical computations and test data generation
pandas==2.0.0 - Market data manipulation and test dataset creation
"""

import pytest
import torch
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

from strategy_engine.ml.models import PricePredictionModel, RLTradingAgent
from strategy_engine.ml.predictor import MarketPredictor
from strategy_engine.ml.optimizer import StrategyOptimizer

class TestMLFixtures:
    """Enhanced test fixtures for ML component testing."""
    
    @pytest.fixture(scope="class")
    def sample_market_data(self) -> pd.DataFrame:
        """Generate comprehensive test market data."""
        dates = pd.date_range(start='2024-01-01', periods=1000, freq='5min')
        data = pd.DataFrame({
            'timestamp': dates,
            'price': np.random.lognormal(0, 0.1, 1000).cumsum(),
            'volume': np.random.lognormal(10, 1, 1000),
            'bid_ask_spread': np.random.uniform(0.001, 0.01, 1000),
            'vwap': np.random.lognormal(0, 0.1, 1000).cumsum() * 1.001,
            'pair': 'SOL/USDC'
        })
        return data

    @pytest.fixture(scope="class")
    def sample_portfolio_state(self) -> dict:
        """Generate test portfolio state."""
        return {
            'positions': {
                'SOL/USDC': {
                    'size': 100.0,
                    'entry_price': 100.0,
                    'current_price': 102.0,
                    'pnl': 200.0
                }
            },
            'balance': 50000.0,
            'equity': 60000.0,
            'risk_limits': {
                'max_position_size_bps': 5000,
                'var_confidence_level': 0.95
            }
        }

    @pytest.fixture(scope="class")
    def sample_state_tensor(self, sample_market_data) -> torch.Tensor:
        """Generate test state tensor for model input."""
        features = sample_market_data[['price', 'volume', 'bid_ask_spread', 'vwap']].values[-24:]
        return torch.FloatTensor(features).unsqueeze(0)

@pytest.mark.asyncio
@pytest.mark.gpu
class TestPricePredictionModel:
    """Comprehensive tests for price prediction model."""

    async def test_model_initialization(self):
        """Test model initialization and version compatibility."""
        model = PricePredictionModel(
            input_size=4,
            hidden_size=128,
            num_layers=3,
            dropout_rate=0.2
        )
        assert model._version == "1.0.0"
        assert isinstance(model._lstm, torch.nn.LSTM)
        assert model._lstm.input_size == 4
        assert model._lstm.hidden_size == 128

    async def test_forward_pass(self, sample_state_tensor):
        """Test model forward pass with GPU support and memory management."""
        model = PricePredictionModel(input_size=4, hidden_size=128, num_layers=3)
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model.to(device)
        
        input_tensor = sample_state_tensor.to(device)
        predictions, confidence = model(input_tensor)
        
        assert predictions.shape == (1, 1)
        assert confidence.shape == (1, 1)
        assert 0 <= confidence.item() <= 1
        
        # Test memory cleanup
        del predictions, confidence
        torch.cuda.empty_cache() if device.type == 'cuda' else None

    async def test_numerical_stability(self, sample_state_tensor):
        """Test model numerical stability with extreme inputs."""
        model = PricePredictionModel(input_size=4, hidden_size=128, num_layers=3)
        
        # Test with very large values
        large_input = sample_state_tensor * 1e6
        predictions_large, _ = model(large_input)
        assert not torch.isnan(predictions_large).any()
        
        # Test with very small values
        small_input = sample_state_tensor * 1e-6
        predictions_small, _ = model(small_input)
        assert not torch.isnan(predictions_small).any()

@pytest.mark.asyncio
class TestRLTradingAgent:
    """Comprehensive tests for RL trading agent."""

    async def test_agent_initialization(self):
        """Test agent initialization with risk management parameters."""
        config = {
            'policy_lr': 0.001,
            'value_lr': 0.001,
            'buffer_size': 1000,
            'batch_size': 64,
            'risk_factor': 0.1
        }
        agent = RLTradingAgent(state_size=10, action_size=3, config=config)
        assert isinstance(agent.policy_network, torch.nn.Sequential)
        assert isinstance(agent.value_network, torch.nn.Sequential)

    async def test_action_selection(self, sample_state_tensor):
        """Test action selection with risk constraints."""
        config = {
            'policy_lr': 0.001,
            'value_lr': 0.001,
            'buffer_size': 1000,
            'batch_size': 64
        }
        agent = RLTradingAgent(state_size=4, action_size=3, config=config)
        
        risk_params = {'risk_factor': 0.1, 'max_position': 0.5}
        action, prob, value, metrics = agent.act(sample_state_tensor, risk_params)
        
        assert 0 <= action < 3
        assert 0 <= prob <= 1
        assert isinstance(metrics, dict)
        assert 'action_entropy' in metrics

    async def test_agent_update(self, sample_state_tensor):
        """Test agent update with experience replay."""
        config = {
            'policy_lr': 0.001,
            'value_lr': 0.001,
            'buffer_size': 1000,
            'batch_size': 64
        }
        agent = RLTradingAgent(state_size=4, action_size=3, config=config)
        
        # Generate test trajectories
        trajectories = []
        for _ in range(5):
            action, prob, value, _ = agent.act(sample_state_tensor, {'risk_factor': 0.1})
            trajectories.append({
                'state': sample_state_tensor,
                'action': action,
                'reward': torch.tensor(1.0),
                'action_prob': prob
            })
        
        metrics = agent.update(trajectories, learning_rate=0.001)
        assert 'policy_loss' in metrics
        assert 'value_loss' in metrics
        assert 'entropy' in metrics

@pytest.mark.asyncio
class TestMarketPredictor:
    """Comprehensive tests for market prediction."""

    async def test_price_movement_prediction(self, sample_market_data):
        """Test price movement prediction with confidence metrics."""
        model = PricePredictionModel(input_size=4, hidden_size=128, num_layers=3)
        config = {'feature_scaling': [1.0, 1.0, 1.0, 1.0]}
        predictor = MarketPredictor(model, config)
        
        prediction = predictor.predict_price_movement(sample_market_data)
        assert 'price_direction' in prediction
        assert 'confidence_score' in prediction
        assert 'prediction_valid' in prediction
        assert 'metrics' in prediction

    async def test_market_state_analysis(self, sample_market_data):
        """Test market state analysis with comprehensive metrics."""
        model = PricePredictionModel(input_size=4, hidden_size=128, num_layers=3)
        config = {'feature_scaling': [1.0, 1.0, 1.0, 1.0]}
        predictor = MarketPredictor(model, config)
        
        market_state = predictor.analyze_market_state(sample_market_data)
        assert 'volatility' in market_state
        assert 'trend' in market_state
        assert 'volume_trend' in market_state
        assert 'liquidity_score' in market_state

@pytest.mark.asyncio
class TestStrategyOptimizer:
    """Comprehensive tests for strategy optimization."""

    async def test_optimization_process(self, sample_market_data, sample_portfolio_state):
        """Test strategy optimization with stability validation."""
        # Initialize components
        agent_config = {
            'policy_lr': 0.001,
            'value_lr': 0.001,
            'buffer_size': 1000,
            'batch_size': 64
        }
        agent = RLTradingAgent(state_size=4, action_size=3, config=agent_config)
        
        model = PricePredictionModel(input_size=4, hidden_size=128, num_layers=3)
        predictor = MarketPredictor(model, {'feature_scaling': [1.0, 1.0, 1.0, 1.0]})
        
        optimizer_config = {
            'risk_factor': 0.1,
            'max_drawdown': -0.15,
            'validation_threshold': 0.95
        }
        optimizer = StrategyOptimizer(
            agent=agent,
            predictor=predictor,
            config=optimizer_config,
            logger=logging.getLogger(__name__),
            metrics_collector=None
        )
        
        results = optimizer.optimize_strategy(
            market_data=sample_market_data,
            portfolio_state=sample_portfolio_state
        )
        
        assert 'parameters' in results
        assert 'metrics' in results
        assert 'risk_metrics' in results
        assert results['metrics']['mean_reward'] is not None
        assert 0 <= results['metrics']['final_validation_score'] <= 1

    async def test_reward_calculation(self, sample_market_data):
        """Test reward calculation with risk adjustment."""
        model = PricePredictionModel(input_size=4, hidden_size=128, num_layers=3)
        predictor = MarketPredictor(model, {'feature_scaling': [1.0, 1.0, 1.0, 1.0]})
        
        agent = RLTradingAgent(state_size=4, action_size=3, config={
            'policy_lr': 0.001,
            'value_lr': 0.001,
            'buffer_size': 1000,
            'batch_size': 64
        })
        
        optimizer = StrategyOptimizer(
            agent=agent,
            predictor=predictor,
            config={'risk_factor': 0.1},
            logger=logging.getLogger(__name__),
            metrics_collector=None
        )
        
        action = {'size': 1.0, 'price': 100.0}
        state = {'portfolio_value': 1000.0, 'max_position_size': 2.0, 'returns': [0.01, -0.01, 0.02]}
        next_state = {'portfolio_value': 1020.0}
        market_impact = {'slippage': 0.001, 'fees': 0.002}
        
        reward = optimizer.calculate_reward(action, state, next_state, market_impact)
        assert isinstance(reward, float)
        assert reward != 0.0  # Ensure non-zero reward