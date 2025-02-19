"""
Machine Learning Models Module

Implements advanced neural network and reinforcement learning models for market prediction
and trading strategy optimization with enhanced stability features and risk management.

Dependencies:
torch==2.0.0 - Deep learning framework for model implementation
numpy==1.24.0 - Numerical computations for data processing
pandas==2.0.0 - Market data manipulation and analysis
"""

import os
from typing import Tuple, Dict, List

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import pandas as pd

from strategy_engine.base import BaseStrategy

# Global configuration constants
INPUT_FEATURES = ["price", "volume", "bid_ask_spread", "vwap"]
SEQUENCE_LENGTH = 24
HIDDEN_SIZE = 128
NUM_LAYERS = 3
MODEL_VERSION = "1.0.0"
CHECKPOINT_DIR = "./checkpoints"

@torch.jit.script
class PricePredictionModel(nn.Module):
    """
    Enhanced neural network model for market price prediction with stability features
    and confidence estimation capabilities.
    """
    
    def __init__(self, input_size: int, hidden_size: int, num_layers: int, dropout_rate: float = 0.2):
        """
        Initialize the price prediction model with advanced architecture.

        Args:
            input_size: Number of input features
            hidden_size: Size of hidden layers
            num_layers: Number of LSTM layers
            dropout_rate: Dropout probability for regularization
        """
        super().__init__()
        
        # Bidirectional LSTM layers
        self._lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout_rate if num_layers > 1 else 0
        )
        
        # Batch normalization for training stability
        self._batch_norm = nn.BatchNorm1d(hidden_size * 2)
        
        # Residual layers for deep architecture
        self._residual_layers = nn.ModuleList([
            nn.Linear(hidden_size * 2, hidden_size * 2)
            for _ in range(2)
        ])
        
        # Dropout for regularization
        self._dropout = nn.Dropout(dropout_rate)
        
        # Prediction heads
        self._fc = nn.Linear(hidden_size * 2, 1)
        self._confidence_fc = nn.Linear(hidden_size * 2, 1)
        
        # Model version tracking
        self._version = MODEL_VERSION
        
        # Initialize weights
        self._initialize_weights()
        
        # Create checkpoint directory
        os.makedirs(CHECKPOINT_DIR, exist_ok=True)

    def _initialize_weights(self):
        """Initialize model weights using Xavier initialization."""
        for name, param in self.named_parameters():
            if 'weight' in name:
                nn.init.xavier_normal_(param)
            elif 'bias' in name:
                nn.init.zeros_(param)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass with enhanced stability and confidence estimation.

        Args:
            x: Input tensor of shape (batch_size, sequence_length, input_size)

        Returns:
            Tuple of (predictions, confidence_scores)
        """
        # LSTM processing
        lstm_out, _ = self._lstm(x)
        
        # Take last timestep output
        hidden = lstm_out[:, -1, :]
        
        # Apply batch normalization
        hidden = self._batch_norm(hidden)
        
        # Process through residual layers
        residual = hidden
        for layer in self._residual_layers:
            hidden = layer(hidden)
            hidden = F.relu(hidden + residual)
            residual = hidden
        
        # Apply dropout
        hidden = self._dropout(hidden)
        
        # Generate predictions and confidence scores
        predictions = self._fc(hidden)
        confidence = torch.sigmoid(self._confidence_fc(hidden))
        
        return predictions, confidence

    def save_checkpoint(self, path: str, metadata: Dict) -> bool:
        """
        Save model checkpoint with metadata.

        Args:
            path: Path to save checkpoint
            metadata: Additional metadata to save

        Returns:
            bool: Success status
        """
        try:
            checkpoint = {
                'model_state': self.state_dict(),
                'version': self._version,
                'metadata': metadata,
                'architecture': {
                    'input_size': self._lstm.input_size,
                    'hidden_size': self._lstm.hidden_size,
                    'num_layers': self._lstm.num_layers
                }
            }
            
            full_path = os.path.join(CHECKPOINT_DIR, path)
            torch.save(checkpoint, full_path)
            
            # Verify saved checkpoint
            loaded = torch.load(full_path)
            if loaded['version'] != self._version:
                raise ValueError("Checkpoint verification failed")
                
            return True
            
        except Exception as e:
            print(f"Error saving checkpoint: {str(e)}")
            return False


class RLTradingAgent:
    """
    Advanced reinforcement learning agent using PPO algorithm for trading optimization
    with comprehensive risk management.
    """
    
    def __init__(self, state_size: int, action_size: int, config: Dict):
        """
        Initialize the RL trading agent with enhanced architecture.

        Args:
            state_size: Dimension of state space
            action_size: Dimension of action space
            config: Agent configuration parameters
        """
        # Policy network with advanced architecture
        self.policy_network = nn.Sequential(
            nn.Linear(state_size, HIDDEN_SIZE),
            nn.LayerNorm(HIDDEN_SIZE),
            nn.ReLU(),
            nn.Linear(HIDDEN_SIZE, HIDDEN_SIZE),
            nn.LayerNorm(HIDDEN_SIZE),
            nn.ReLU(),
            nn.Linear(HIDDEN_SIZE, action_size),
            nn.Softmax(dim=-1)
        )
        
        # Value network for state evaluation
        self.value_network = nn.Sequential(
            nn.Linear(state_size, HIDDEN_SIZE),
            nn.LayerNorm(HIDDEN_SIZE),
            nn.ReLU(),
            nn.Linear(HIDDEN_SIZE, HIDDEN_SIZE),
            nn.LayerNorm(HIDDEN_SIZE),
            nn.ReLU(),
            nn.Linear(HIDDEN_SIZE, 1)
        )
        
        # Initialize optimizer with learning rate schedule
        self.optimizer = torch.optim.Adam([
            {'params': self.policy_network.parameters(), 'lr': config['policy_lr']},
            {'params': self.value_network.parameters(), 'lr': config['value_lr']}
        ])
        
        # Experience replay buffer
        self._replay_buffer = ReplayBuffer(
            capacity=config['buffer_size'],
            batch_size=config['batch_size']
        )
        
        # Training configuration
        self._training_config = {
            'gamma': config.get('gamma', 0.99),
            'gae_lambda': config.get('gae_lambda', 0.95),
            'clip_ratio': config.get('clip_ratio', 0.2),
            'max_grad_norm': config.get('max_grad_norm', 0.5),
            'risk_factor': config.get('risk_factor', 0.1)
        }
        
        # Initialize training metrics
        self._metrics = {
            'policy_loss': [],
            'value_loss': [],
            'entropy': [],
            'risk_adjusted_returns': []
        }

    def act(self, state: torch.Tensor, risk_params: Dict) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, Dict]:
        """
        Select trading action with risk consideration.

        Args:
            state: Current state tensor
            risk_params: Risk management parameters

        Returns:
            Tuple of (action, action_probability, state_value, risk_metrics)
        """
        with torch.no_grad():
            # Get action probabilities
            action_probs = self.policy_network(state)
            
            # Calculate state value
            state_value = self.value_network(state)
            
            # Apply risk-aware action selection
            risk_adjusted_probs = self._adjust_for_risk(
                action_probs, 
                risk_params
            )
            
            # Sample action from adjusted probabilities
            action_distribution = torch.distributions.Categorical(risk_adjusted_probs)
            action = action_distribution.sample()
            
            # Calculate risk metrics
            risk_metrics = {
                'action_entropy': action_distribution.entropy().item(),
                'max_prob': risk_adjusted_probs.max().item(),
                'risk_adjustment': (action_probs - risk_adjusted_probs).abs().mean().item()
            }
            
            return action, risk_adjusted_probs[action], state_value, risk_metrics

    def update(self, trajectories: List[Dict], learning_rate: float) -> Dict:
        """
        Update agent's policy using PPO algorithm with risk-adjusted rewards.

        Args:
            trajectories: List of experience trajectories
            learning_rate: Current learning rate

        Returns:
            Dict of training metrics
        """
        # Update learning rates
        for param_group in self.optimizer.param_groups:
            param_group['lr'] = learning_rate
        
        # Process trajectories
        states = torch.stack([t['state'] for t in trajectories])
        actions = torch.stack([t['action'] for t in trajectories])
        rewards = torch.stack([t['reward'] for t in trajectories])
        old_probs = torch.stack([t['action_prob'] for t in trajectories])
        
        # Calculate advantages using GAE
        advantages = self._compute_gae(
            rewards,
            states,
            self._training_config['gamma'],
            self._training_config['gae_lambda']
        )
        
        # Normalize advantages
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
        
        # PPO update loop
        for _ in range(self._training_config.get('update_epochs', 3)):
            # Get current action probabilities and state values
            current_probs = self.policy_network(states)
            current_values = self.value_network(states)
            
            # Calculate PPO policy loss
            ratio = torch.exp(torch.log(current_probs) - torch.log(old_probs))
            clip_ratio = self._training_config['clip_ratio']
            
            policy_loss = -torch.min(
                ratio * advantages,
                torch.clamp(ratio, 1 - clip_ratio, 1 + clip_ratio) * advantages
            ).mean()
            
            # Calculate value loss
            value_loss = F.mse_loss(current_values, rewards)
            
            # Calculate entropy bonus
            entropy = -torch.sum(current_probs * torch.log(current_probs + 1e-10), dim=-1).mean()
            
            # Total loss with entropy regularization
            total_loss = policy_loss + 0.5 * value_loss - 0.01 * entropy
            
            # Optimize
            self.optimizer.zero_grad()
            total_loss.backward()
            
            # Clip gradients
            torch.nn.utils.clip_grad_norm_(
                self.policy_network.parameters(),
                self._training_config['max_grad_norm']
            )
            
            self.optimizer.step()
            
            # Update metrics
            self._metrics['policy_loss'].append(policy_loss.item())
            self._metrics['value_loss'].append(value_loss.item())
            self._metrics['entropy'].append(entropy.item())
        
        return {
            'policy_loss': np.mean(self._metrics['policy_loss']),
            'value_loss': np.mean(self._metrics['value_loss']),
            'entropy': np.mean(self._metrics['entropy']),
            'learning_rate': learning_rate
        }

    def _adjust_for_risk(self, action_probs: torch.Tensor, risk_params: Dict) -> torch.Tensor:
        """
        Adjust action probabilities based on risk parameters.
        
        Args:
            action_probs: Original action probabilities
            risk_params: Risk management parameters
            
        Returns:
            Risk-adjusted action probabilities
        """
        risk_factor = risk_params.get('risk_factor', self._training_config['risk_factor'])
        max_position = risk_params.get('max_position', 1.0)
        
        # Apply risk-based scaling
        scaled_probs = action_probs * (1 - risk_factor * torch.arange(len(action_probs)))
        
        # Ensure no action exceeds position limits
        scaled_probs = torch.clamp(scaled_probs, 0, max_position)
        
        # Renormalize probabilities
        return F.softmax(scaled_probs, dim=-1)

    def _compute_gae(self, rewards: torch.Tensor, states: torch.Tensor, 
                    gamma: float, gae_lambda: float) -> torch.Tensor:
        """
        Compute Generalized Advantage Estimation.
        
        Args:
            rewards: Trajectory rewards
            states: Trajectory states
            gamma: Discount factor
            gae_lambda: GAE parameter
            
        Returns:
            Advantage estimates
        """
        with torch.no_grad():
            values = self.value_network(states)
            advantages = torch.zeros_like(rewards)
            last_advantage = 0
            
            for t in reversed(range(len(rewards))):
                if t == len(rewards) - 1:
                    next_value = 0
                else:
                    next_value = values[t + 1]
                
                delta = rewards[t] + gamma * next_value - values[t]
                advantages[t] = delta + gamma * gae_lambda * last_advantage
                last_advantage = advantages[t]
            
            return advantages


class ReplayBuffer:
    """Prioritized experience replay buffer for training stability."""
    
    def __init__(self, capacity: int, batch_size: int):
        self.capacity = capacity
        self.batch_size = batch_size
        self.buffer = []
        self.priorities = np.zeros(capacity, dtype=np.float32)
        self.position = 0
    
    def add(self, experience: Dict, priority: float):
        """Add experience to buffer with priority."""
        if len(self.buffer) < self.capacity:
            self.buffer.append(experience)
        else:
            self.buffer[self.position] = experience
        
        self.priorities[self.position] = priority
        self.position = (self.position + 1) % self.capacity
    
    def sample(self) -> List[Dict]:
        """Sample batch of experiences based on priorities."""
        if len(self.buffer) < self.batch_size:
            return self.buffer
        
        probs = self.priorities[:len(self.buffer)] / np.sum(self.priorities[:len(self.buffer)])
        indices = np.random.choice(len(self.buffer), self.batch_size, p=probs)
        
        return [self.buffer[idx] for idx in indices]