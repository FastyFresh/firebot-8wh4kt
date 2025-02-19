"""
Arbitrage Detector Module

High-performance arbitrage opportunity detection across multiple Solana DEXs with
parallel processing and comprehensive validation capabilities.

Dependencies:
numpy==1.24.0 - High-performance numerical computations for price analysis
pandas==2.0.0 - Efficient market data manipulation and analysis
asyncio==3.11.0 - Asynchronous processing for parallel opportunity detection
"""

import numpy as np
import pandas as pd
import asyncio
from typing import Dict, List, Tuple, Optional
from strategy_engine.base import BaseStrategy

# Global constants for arbitrage detection configuration
MIN_PRICE_DIFFERENCE_BPS = 20  # Minimum price difference in basis points
MAX_DETECTION_LATENCY_MS = 100  # Maximum allowed detection latency
MIN_LIQUIDITY_REQUIREMENT = 1000  # Minimum liquidity in USDC
MAX_PATH_LENGTH = 3  # Maximum number of hops in arbitrage path

class ArbitrageDetector:
    """
    High-performance arbitrage opportunity detector with parallel processing
    and real-time validation capabilities.
    """
    
    def __init__(self, dex_configs: Dict, min_profit_threshold: float) -> None:
        """
        Initialize arbitrage detector with comprehensive configuration and monitoring.

        Args:
            dex_configs (Dict): Configuration for connected DEXs including endpoints and parameters
            min_profit_threshold (float): Minimum profit threshold in basis points
        """
        self.dex_configs = self._validate_dex_configs(dex_configs)
        self.market_data = pd.DataFrame()
        self.detection_stats = {
            'opportunities_found': 0,
            'opportunities_validated': 0,
            'average_detection_latency': 0.0,
            'execution_success_rate': 0.0
        }
        self.min_profit_threshold = max(min_profit_threshold, MIN_PRICE_DIFFERENCE_BPS)
        self.event_loop = asyncio.get_event_loop()
        self.performance_metrics = {
            'detection_latency': [],
            'validation_latency': [],
            'success_rate': 0.0
        }

    def _validate_dex_configs(self, configs: Dict) -> Dict:
        """Validate DEX configurations for required parameters."""
        required_params = {'endpoint', 'api_version', 'timeout_ms'}
        for dex, config in configs.items():
            if not all(param in config for param in required_params):
                raise ValueError(f"Missing required configuration for DEX {dex}")
        return configs

    @staticmethod
    def calculate_price_difference(price_a: float, price_b: float) -> float:
        """
        Calculate percentage price difference between two DEXs using optimized numpy operations.

        Args:
            price_a (float): Price from first DEX
            price_b (float): Price from second DEX

        Returns:
            float: Price difference in basis points
        """
        if price_a <= 0 or price_b <= 0:
            raise ValueError("Invalid price values")

        # Use numpy for optimized calculation
        prices = np.array([price_a, price_b], dtype=np.float64)
        diff = np.abs(prices[1] - prices[0])
        avg_price = np.mean(prices)
        
        # Convert to basis points with precision handling
        bps_diff = (diff / avg_price) * 10000
        
        return np.round(bps_diff, decimals=2)

    @staticmethod
    def validate_liquidity(market_data: Dict, required_volume: float) -> bool:
        """
        Validate if sufficient liquidity exists for arbitrage execution.

        Args:
            market_data (Dict): Order book and market depth data
            required_volume (float): Required volume for execution

        Returns:
            bool: True if sufficient liquidity exists
        """
        try:
            # Extract order book depths
            bid_depth = np.array(market_data['bids'], dtype=np.float64)
            ask_depth = np.array(market_data['asks'], dtype=np.float64)

            # Calculate cumulative volumes
            cum_bid_volume = np.cumsum(bid_depth[:, 1])
            cum_ask_volume = np.cumsum(ask_depth[:, 1])

            # Check if required volume is available
            has_bid_liquidity = np.any(cum_bid_volume >= required_volume)
            has_ask_liquidity = np.any(cum_ask_volume >= required_volume)

            # Calculate estimated price impact
            if has_bid_liquidity and has_ask_liquidity:
                bid_impact = np.abs(bid_depth[0, 0] - bid_depth[-1, 0]) / bid_depth[0, 0]
                ask_impact = np.abs(ask_depth[-1, 0] - ask_depth[0, 0]) / ask_depth[0, 0]
                
                # Return true if price impact is acceptable (less than 1%)
                return bid_impact < 0.01 and ask_impact < 0.01

            return False

        except Exception:
            return False

    async def detect_opportunities(self, market_data: pd.DataFrame) -> List[Dict]:
        """
        Detect arbitrage opportunities using parallel processing and advanced validation.

        Args:
            market_data (pd.DataFrame): Current market data across all DEXs

        Returns:
            List[Dict]: List of validated arbitrage opportunities
        """
        try:
            # Validate market data
            if not BaseStrategy.validate_market_data(market_data):
                return []

            # Update internal market data
            self.update_market_data(market_data)

            # Create price matrix for efficient computation
            price_matrix = market_data.pivot(
                columns='dex',
                values='price',
                index='pair'
            ).values

            # Calculate all price differences using vectorized operations
            dex_combinations = np.array(list(self.dex_configs.keys()))
            price_diffs = np.subtract.outer(price_matrix, price_matrix)
            
            # Find opportunities exceeding threshold
            opportunities = []
            mask = np.abs(price_diffs) >= self.min_profit_threshold
            
            if not np.any(mask):
                return []

            # Process opportunities in parallel
            opportunity_coords = np.where(mask)
            validation_tasks = []
            
            for i, j in zip(*opportunity_coords):
                opp = {
                    'pair': market_data['pair'].unique()[i],
                    'dex_buy': dex_combinations[j],
                    'dex_sell': dex_combinations[i],
                    'price_difference': float(price_diffs[i, j]),
                    'timestamp': pd.Timestamp.now()
                }
                validation_tasks.append(self.validate_opportunity(opp))

            # Execute validations in parallel
            validation_results = await asyncio.gather(*validation_tasks)
            
            # Filter valid opportunities
            opportunities = [
                opp for opp, (is_valid, metrics) in zip(
                    [dict(zip(['pair', 'dex_buy', 'dex_sell', 'price_difference'],
                            [market_data['pair'].unique()[i],
                             dex_combinations[j],
                             dex_combinations[i],
                             float(price_diffs[i, j])])) 
                     for i, j in zip(*opportunity_coords)],
                    validation_results
                ) if is_valid
            ]

            # Update detection statistics
            self._update_detection_stats(len(opportunities))

            return opportunities

        except Exception as e:
            self.detection_stats['errors'] = str(e)
            return []

    async def validate_opportunity(self, opportunity: Dict) -> Tuple[bool, Dict]:
        """
        Perform comprehensive validation of detected arbitrage opportunities.

        Args:
            opportunity (Dict): Detected arbitrage opportunity

        Returns:
            Tuple[bool, Dict]: Validation result and detailed metrics
        """
        validation_metrics = {
            'timestamp': pd.Timestamp.now(),
            'validation_latency_ms': 0,
            'price_difference_bps': 0,
            'estimated_profit_usdc': 0,
            'execution_probability': 0.0
        }

        start_time = pd.Timestamp.now()

        try:
            # Validate price difference
            price_diff = self.calculate_price_difference(
                self.market_data[
                    (self.market_data['dex'] == opportunity['dex_buy']) &
                    (self.market_data['pair'] == opportunity['pair'])
                ]['price'].iloc[0],
                self.market_data[
                    (self.market_data['dex'] == opportunity['dex_sell']) &
                    (self.market_data['pair'] == opportunity['pair'])
                ]['price'].iloc[0]
            )

            if price_diff < self.min_profit_threshold:
                return False, validation_metrics

            # Validate liquidity
            required_volume = MIN_LIQUIDITY_REQUIREMENT / self.market_data[
                (self.market_data['dex'] == opportunity['dex_buy']) &
                (self.market_data['pair'] == opportunity['pair'])
            ]['price'].iloc[0]

            if not all(self.validate_liquidity(
                self.market_data[
                    (self.market_data['dex'] == dex) &
                    (self.market_data['pair'] == opportunity['pair'])
                ]['orderbook'].iloc[0],
                required_volume
            ) for dex in [opportunity['dex_buy'], opportunity['dex_sell']]):
                return False, validation_metrics

            # Calculate execution metrics
            validation_metrics.update({
                'price_difference_bps': float(price_diff),
                'estimated_profit_usdc': float(price_diff * MIN_LIQUIDITY_REQUIREMENT / 10000),
                'execution_probability': 0.95,
                'validation_latency_ms': (pd.Timestamp.now() - start_time).total_seconds() * 1000
            })

            return True, validation_metrics

        except Exception:
            return False, validation_metrics

    def update_market_data(self, new_data: pd.DataFrame) -> bool:
        """
        Update internal market data with latest prices and depths efficiently.

        Args:
            new_data (pd.DataFrame): New market data

        Returns:
            bool: Update success status
        """
        try:
            # Validate new data format
            if not {'dex', 'pair', 'price', 'timestamp', 'orderbook'}.issubset(new_data.columns):
                return False

            # Update market data efficiently
            self.market_data = new_data.copy()
            
            # Calculate update latency
            update_latency = (pd.Timestamp.now() - new_data['timestamp'].max()).total_seconds() * 1000
            
            # Update performance metrics
            self.performance_metrics['detection_latency'].append(update_latency)
            if len(self.performance_metrics['detection_latency']) > 1000:
                self.performance_metrics['detection_latency'] = self.performance_metrics['detection_latency'][-1000:]

            return update_latency <= MAX_DETECTION_LATENCY_MS

        except Exception:
            return False

    def _update_detection_stats(self, num_opportunities: int) -> None:
        """Update internal detection statistics."""
        self.detection_stats['opportunities_found'] += num_opportunities
        self.detection_stats['average_detection_latency'] = np.mean(
            self.performance_metrics['detection_latency'][-100:]
        ) if self.performance_metrics['detection_latency'] else 0.0