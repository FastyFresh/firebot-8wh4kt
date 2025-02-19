"""
Strategy Optimizer Module

Production-grade reinforcement learning-based strategy optimization with comprehensive
risk management and reliability features for continuous strategy improvement.

Dependencies:
torch==2.0.0 - Deep learning framework for RL implementation
numpy==1.24.0 - Numerical computations for optimization
pandas==2.0.0 - Market data manipulation and analysis
"""

import logging
import sys
from typing import Dict, Optional, Tuple
import gc

import torch
import numpy as np
import pandas as pd

from strategy_engine.ml.models import RLTradingAgent
from strategy_engine.ml.predictor import MarketPredictor
from strategy_engine.base import BaseStrategy

# Global optimization constants
OPTIMIZATION_INTERVAL = 3600  # 1 hour
MIN_EPISODES = 100
MAX_EPISODES = 1000
REWARD_SCALE = 1000.0
LEARNING_RATE = 0.001
MAX_MEMORY_USAGE = 0.8
BATCH_SIZE = 64
VALIDATION_THRESHOLD = 0.95
MAX_DRAWDOWN_LIMIT = -0.15
EMERGENCY_SHUTDOWN_THRESHOLD = -0.25

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@torch.cuda.amp.autocast(enabled=True)
class StrategyOptimizer:
    """
    Production-grade reinforcement learning-based optimization of trading strategies
    with comprehensive risk management and reliability features.
    """
    
    def __init__(self, agent: RLTradingAgent, predictor: MarketPredictor, 
                 config: Dict, logger: logging.Logger, metrics_collector) -> None:
        """
        Initialize the strategy optimizer with production safeguards and monitoring.

        Args:
            agent: RL trading agent for strategy optimization
            predictor: Market predictor for optimization feedback
            config: Optimizer configuration parameters
            logger: Logger instance for monitoring
            metrics_collector: Metrics collection service
        """
        self._agent = agent
        self._predictor = predictor
        self._config = config
        self._logger = logger
        self._metrics_collector = metrics_collector
        
        # Initialize experience buffer with size limits
        self._experience_buffer = []
        
        # Initialize optimization state tracking
        self._current_state = {
            'episode': 0,
            'total_reward': 0.0,
            'best_reward': -float('inf'),
            'validation_score': 0.0
        }
        
        # Initialize GPU memory management
        if torch.cuda.is_available():
            self._device = torch.device('cuda')
            self._scaler = torch.cuda.amp.GradScaler()
            torch.cuda.set_per_process_memory_fraction(MAX_MEMORY_USAGE)
        else:
            self._device = torch.device('cpu')
            self._scaler = None
        
        # Initialize optimization metrics
        self._optimization_metrics = {
            'rewards': [],
            'losses': [],
            'validation_scores': [],
            'memory_usage': []
        }
        
        self._logger.info("Strategy optimizer initialized successfully")

    def optimize_strategy(self, market_data: pd.DataFrame, 
                         portfolio_state: Dict, force_cpu: bool = False) -> Dict:
        """
        Production-ready strategy optimization with comprehensive error handling and monitoring.

        Args:
            market_data: Market data for optimization
            portfolio_state: Current portfolio state
            force_cpu: Force CPU execution if True

        Returns:
            Dict containing optimized parameters and metrics
        """
        try:
            # Validate input data
            if not BaseStrategy.validate_market_data(market_data):
                raise ValueError("Invalid market data format")
            
            # Check system resources
            if not force_cpu and torch.cuda.is_available():
                memory_usage = torch.cuda.memory_allocated() / torch.cuda.max_memory_allocated()
                if memory_usage > MAX_MEMORY_USAGE:
                    self._logger.warning("High GPU memory usage, switching to CPU")
                    device = torch.device('cpu')
                else:
                    device = self._device
            else:
                device = torch.device('cpu')
            
            # Generate market predictions
            market_predictions = self._predictor.predict_price_movement(market_data)
            market_state = self._predictor.analyze_market_state(market_data)
            
            # Initialize optimization metrics
            episode_metrics = {
                'rewards': [],
                'losses': [],
                'validation_scores': []
            }
            
            # Run optimization episodes
            for episode in range(MIN_EPISODES, MAX_EPISODES):
                # Update current state
                state = self.update_state(market_data, portfolio_state, market_state)
                state_tensor = torch.FloatTensor(state).to(device)
                
                # Get action from agent
                action, action_prob, state_value, risk_metrics = self._agent.act(
                    state_tensor,
                    {'risk_factor': self._config.get('risk_factor', 0.1)}
                )
                
                # Execute action and calculate reward
                next_state, reward, done = self._execute_action(
                    action.cpu().numpy(),
                    state,
                    market_predictions
                )
                
                # Scale reward and add to experience buffer
                scaled_reward = reward * REWARD_SCALE
                self._experience_buffer.append({
                    'state': state_tensor,
                    'action': action,
                    'reward': torch.tensor(scaled_reward, device=device),
                    'action_prob': action_prob
                })
                
                # Update agent if buffer is full
                if len(self._experience_buffer) >= BATCH_SIZE:
                    update_metrics = self._agent.update(
                        self._experience_buffer,
                        LEARNING_RATE
                    )
                    episode_metrics['losses'].append(update_metrics['policy_loss'])
                    self._experience_buffer = []
                
                # Track rewards
                episode_metrics['rewards'].append(reward)
                
                # Validate optimization progress
                if episode % 10 == 0:
                    validation_score = self._validate_optimization(episode_metrics)
                    episode_metrics['validation_scores'].append(validation_score)
                    
                    # Check for early stopping
                    if validation_score >= VALIDATION_THRESHOLD:
                        self._logger.info(f"Optimization converged at episode {episode}")
                        break
                    
                    # Check for emergency shutdown
                    if np.mean(episode_metrics['rewards'][-10:]) < EMERGENCY_SHUTDOWN_THRESHOLD:
                        self._logger.warning("Emergency shutdown triggered")
                        break
                
                # Update optimization state
                self._current_state.update({
                    'episode': episode,
                    'total_reward': sum(episode_metrics['rewards']),
                    'validation_score': validation_score if 'validation_score' in locals() else 0.0
                })
                
                # Collect metrics
                self._metrics_collector.record_optimization_metrics({
                    'episode': episode,
                    'reward': reward,
                    'loss': update_metrics['policy_loss'] if 'update_metrics' in locals() else None,
                    'validation_score': validation_score if 'validation_score' in locals() else None
                })
            
            # Compile optimization results
            optimization_results = {
                'parameters': self._agent.policy_network.state_dict(),
                'metrics': {
                    'mean_reward': np.mean(episode_metrics['rewards']),
                    'final_validation_score': episode_metrics['validation_scores'][-1],
                    'total_episodes': episode,
                    'convergence_episode': episode
                },
                'risk_metrics': risk_metrics,
                'state': self._current_state
            }
            
            # Cleanup
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            return optimization_results
            
        except Exception as e:
            self._logger.error(f"Optimization error: {str(e)}")
            raise

    def calculate_reward(self, action: Dict, state: Dict, 
                        next_state: Dict, market_impact: Dict) -> float:
        """
        Comprehensive reward calculation incorporating risk metrics and trading costs.

        Args:
            action: Executed trading action
            state: Previous state
            next_state: Current state
            market_impact: Market impact metrics

        Returns:
            Risk-adjusted reward value
        """
        try:
            # Calculate raw PnL
            pnl = next_state['portfolio_value'] - state['portfolio_value']
            
            # Calculate risk-adjusted returns
            portfolio_risk = BaseStrategy.calculate_portfolio_risk()
            risk_adjustment = 1.0 - min(1.0, portfolio_risk['var'] / MAX_DRAWDOWN_LIMIT)
            
            # Apply position concentration penalty
            concentration_penalty = max(0, portfolio_risk['concentration'] - 0.5) * 2
            
            # Include trading costs
            trading_cost = market_impact.get('slippage', 0.0) + market_impact.get('fees', 0.0)
            
            # Calculate volatility penalty
            volatility = np.std(state['returns']) if 'returns' in state else 0.0
            volatility_penalty = max(0, volatility - 0.02) * 10
            
            # Apply position size constraints
            size_penalty = 0.0
            if action['size'] > state['max_position_size']:
                size_penalty = (action['size'] - state['max_position_size']) * 2
            
            # Calculate final reward
            reward = (pnl * risk_adjustment - 
                     trading_cost - 
                     concentration_penalty - 
                     volatility_penalty - 
                     size_penalty)
            
            # Log reward components
            self._logger.debug({
                'pnl': pnl,
                'risk_adjustment': risk_adjustment,
                'trading_cost': trading_cost,
                'concentration_penalty': concentration_penalty,
                'volatility_penalty': volatility_penalty,
                'size_penalty': size_penalty,
                'final_reward': reward
            })
            
            return float(reward)
            
        except Exception as e:
            self._logger.error(f"Reward calculation error: {str(e)}")
            return 0.0

    def update_state(self, market_data: pd.DataFrame, portfolio_state: Dict,
                    order_book_state: Dict) -> Dict:
        """
        Production-grade state update with comprehensive feature set.

        Args:
            market_data: Current market data
            portfolio_state: Portfolio state information
            order_book_state: Order book state information

        Returns:
            Updated state representation
        """
        try:
            # Validate input data
            if not all(k in portfolio_state for k in ['positions', 'balance', 'equity']):
                raise ValueError("Invalid portfolio state format")
            
            # Process market technical indicators
            technical_features = {
                'rsi': self._calculate_rsi(market_data['price']),
                'volatility': market_data['price'].pct_change().std(),
                'volume_ma': market_data['volume'].rolling(window=20).mean().iloc[-1],
                'price_ma': market_data['price'].rolling(window=50).mean().iloc[-1]
            }
            
            # Extract order book features
            order_book_features = {
                'bid_ask_spread': order_book_state.get('spread', 0.0),
                'order_imbalance': order_book_state.get('imbalance', 0.0),
                'depth': order_book_state.get('depth', 0.0)
            }
            
            # Calculate risk metrics
            risk_metrics = BaseStrategy.calculate_portfolio_risk()
            
            # Update portfolio state
            portfolio_features = {
                'total_value': portfolio_state['equity'],
                'cash_ratio': portfolio_state['balance'] / portfolio_state['equity'],
                'position_count': len(portfolio_state['positions']),
                'max_position_size': portfolio_state['equity'] * 0.5  # 50% max position
            }
            
            # Include historical performance
            returns = market_data['price'].pct_change().dropna()
            performance_features = {
                'sharpe_ratio': self._calculate_sharpe_ratio(returns),
                'max_drawdown': self._calculate_max_drawdown(returns),
                'win_rate': self._calculate_win_rate(returns)
            }
            
            # Combine all features
            state = {
                **technical_features,
                **order_book_features,
                **risk_metrics,
                **portfolio_features,
                **performance_features,
                'timestamp': pd.Timestamp.now().timestamp()
            }
            
            # Validate state completeness
            if not all(k in state for k in ['rsi', 'volatility', 'total_value', 'sharpe_ratio']):
                raise ValueError("Incomplete state generation")
            
            # Log state updates
            self._logger.debug(f"State updated: {state}")
            
            return state
            
        except Exception as e:
            self._logger.error(f"State update error: {str(e)}")
            raise

    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> float:
        """Calculate Relative Strength Index."""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs.iloc[-1]))

    def _calculate_sharpe_ratio(self, returns: pd.Series) -> float:
        """Calculate Sharpe Ratio with risk-free rate."""
        risk_free_rate = 0.02  # 2% annual risk-free rate
        excess_returns = returns - risk_free_rate / 252
        return np.sqrt(252) * (excess_returns.mean() / excess_returns.std())

    def _calculate_max_drawdown(self, returns: pd.Series) -> float:
        """Calculate maximum drawdown."""
        cumulative = (1 + returns).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = cumulative / running_max - 1
        return float(drawdown.min())

    def _calculate_win_rate(self, returns: pd.Series) -> float:
        """Calculate win rate of trades."""
        return len(returns[returns > 0]) / len(returns)

    def _validate_optimization(self, metrics: Dict) -> float:
        """
        Validate optimization progress and calculate validation score.
        
        Args:
            metrics: Optimization metrics dictionary
            
        Returns:
            Validation score between 0 and 1
        """
        try:
            # Calculate reward stability
            reward_stability = 1.0 - min(1.0, np.std(metrics['rewards'][-10:]))
            
            # Calculate loss convergence
            if len(metrics['losses']) > 1:
                loss_convergence = 1.0 - min(1.0, abs(
                    np.mean(metrics['losses'][-5:]) - np.mean(metrics['losses'][-10:-5])
                ))
            else:
                loss_convergence = 0.0
            
            # Calculate overall validation score
            validation_score = 0.6 * reward_stability + 0.4 * loss_convergence
            
            return float(validation_score)
            
        except Exception as e:
            self._logger.error(f"Validation error: {str(e)}")
            return 0.0