import React, { useCallback, useEffect, useMemo, useState } from 'react'; // v18.0.0
import Decimal from 'decimal.js-light'; // v2.5.1
import debounce from 'lodash/debounce'; // v4.0.8
import { Input } from '../common/Input';
import { Card } from '../common/Card';
import { validateDecimal, validateRange } from '../../utils/validation';
import { StrategyType, GridStrategyConfig, ArbitrageStrategyConfig, MLStrategyConfig } from '../../types/strategy';

// Global constants from strategy types
const MIN_GRID_LEVELS = 5;
const MAX_GRID_LEVELS = 100;
const MIN_POSITION_SIZE_BPS = 100;
const MAX_POSITION_SIZE_BPS = 5000;
const VALIDATION_DEBOUNCE_MS = 300;

interface ParameterConfigProps {
  type: StrategyType;
  onConfigChange: (config: GridStrategyConfig | ArbitrageStrategyConfig | MLStrategyConfig) => void;
  initialConfig?: Partial<GridStrategyConfig | ArbitrageStrategyConfig | MLStrategyConfig>;
}

interface ValidationErrors {
  [key: string]: string;
}

const ParameterConfig: React.FC<ParameterConfigProps> = React.memo(({ 
  type, 
  onConfigChange, 
  initialConfig = {} 
}) => {
  // State management
  const [config, setConfig] = useState<any>(initialConfig);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isValidating, setIsValidating] = useState(false);

  // Validation functions
  const validateGridParameters = useCallback(debounce((params: Partial<GridStrategyConfig>) => {
    const newErrors: ValidationErrors = {};

    try {
      // Validate grid levels
      if (params.gridLevels !== undefined) {
        if (!validateRange(params.gridLevels, MIN_GRID_LEVELS, MAX_GRID_LEVELS)) {
          newErrors.gridLevels = `Grid levels must be between ${MIN_GRID_LEVELS} and ${MAX_GRID_LEVELS}`;
        }
      }

      // Validate price range
      if (params.upperPrice && params.lowerPrice) {
        const upper = new Decimal(params.upperPrice);
        const lower = new Decimal(params.lowerPrice);
        
        if (upper.lte(lower)) {
          newErrors.upperPrice = 'Upper price must be greater than lower price';
        }
      }

      // Validate position size
      if (params.positionSizeBps !== undefined) {
        if (!validateRange(params.positionSizeBps, MIN_POSITION_SIZE_BPS, MAX_POSITION_SIZE_BPS)) {
          newErrors.positionSizeBps = `Position size must be between ${MIN_POSITION_SIZE_BPS/100}% and ${MAX_POSITION_SIZE_BPS/100}%`;
        }
      }
    } catch (error) {
      newErrors.general = 'Invalid parameter values';
    }

    setErrors(newErrors);
    setIsValidating(false);
    return Object.keys(newErrors).length === 0;
  }, VALIDATION_DEBOUNCE_MS), []);

  const validateArbitrageParameters = useCallback(debounce((params: Partial<ArbitrageStrategyConfig>) => {
    const newErrors: ValidationErrors = {};

    try {
      // Validate min profit
      if (params.minProfitBps !== undefined) {
        if (!validateRange(params.minProfitBps, 1, 1000)) {
          newErrors.minProfitBps = 'Minimum profit must be between 0.01% and 10%';
        }
      }

      // Validate position size
      if (params.positionSizeBps !== undefined) {
        if (!validateRange(params.positionSizeBps, MIN_POSITION_SIZE_BPS, MAX_POSITION_SIZE_BPS)) {
          newErrors.positionSizeBps = `Position size must be between ${MIN_POSITION_SIZE_BPS/100}% and ${MAX_POSITION_SIZE_BPS/100}%`;
        }
      }
    } catch (error) {
      newErrors.general = 'Invalid parameter values';
    }

    setErrors(newErrors);
    setIsValidating(false);
    return Object.keys(newErrors).length === 0;
  }, VALIDATION_DEBOUNCE_MS), []);

  const validateMLParameters = useCallback(debounce((params: Partial<MLStrategyConfig>) => {
    const newErrors: ValidationErrors = {};

    try {
      // Validate confidence threshold
      if (params.confidenceThreshold !== undefined) {
        if (!validateRange(params.confidenceThreshold, 0.6, 1)) {
          newErrors.confidenceThreshold = 'Confidence threshold must be between 0.6 and 1.0';
        }
      }

      // Validate position size
      if (params.positionSizeBps !== undefined) {
        if (!validateRange(params.positionSizeBps, MIN_POSITION_SIZE_BPS, MAX_POSITION_SIZE_BPS)) {
          newErrors.positionSizeBps = `Position size must be between ${MIN_POSITION_SIZE_BPS/100}% and ${MAX_POSITION_SIZE_BPS/100}%`;
        }
      }
    } catch (error) {
      newErrors.general = 'Invalid parameter values';
    }

    setErrors(newErrors);
    setIsValidating(false);
    return Object.keys(newErrors).length === 0;
  }, VALIDATION_DEBOUNCE_MS), []);

  // Handle parameter changes
  const handleParameterChange = useCallback((paramName: string, value: string | number) => {
    setIsValidating(true);
    const newConfig = { ...config, [paramName]: value };
    setConfig(newConfig);

    // Validate based on strategy type
    let isValid = false;
    switch (type) {
      case StrategyType.GRID:
        isValid = validateGridParameters(newConfig);
        break;
      case StrategyType.ARBITRAGE:
        isValid = validateArbitrageParameters(newConfig);
        break;
      case StrategyType.ML:
        isValid = validateMLParameters(newConfig);
        break;
    }

    if (isValid) {
      onConfigChange(newConfig);
    }
  }, [config, type, onConfigChange, validateGridParameters, validateArbitrageParameters, validateMLParameters]);

  // Render strategy-specific parameters
  const renderParameters = useMemo(() => {
    switch (type) {
      case StrategyType.GRID:
        return (
          <>
            <Input
              type="number"
              label="Grid Levels"
              value={config.gridLevels || ''}
              onChange={(value) => handleParameterChange('gridLevels', Number(value))}
              error={errors.gridLevels}
              min={MIN_GRID_LEVELS}
              max={MAX_GRID_LEVELS}
              step={1}
              aria-label="Number of grid levels"
            />
            <Input
              type="number"
              label="Upper Price"
              value={config.upperPrice || ''}
              onChange={(value) => handleParameterChange('upperPrice', value)}
              error={errors.upperPrice}
              min={0}
              step={0.01}
              aria-label="Upper price limit"
            />
            <Input
              type="number"
              label="Lower Price"
              value={config.lowerPrice || ''}
              onChange={(value) => handleParameterChange('lowerPrice', value)}
              error={errors.lowerPrice}
              min={0}
              step={0.01}
              aria-label="Lower price limit"
            />
          </>
        );

      case StrategyType.ARBITRAGE:
        return (
          <>
            <Input
              type="number"
              label="Minimum Profit (%)"
              value={config.minProfitBps ? config.minProfitBps / 100 : ''}
              onChange={(value) => handleParameterChange('minProfitBps', Number(value) * 100)}
              error={errors.minProfitBps}
              min={0.01}
              max={10}
              step={0.01}
              aria-label="Minimum profit percentage"
            />
            <Input
              type="number"
              label="Maximum Slippage (%)"
              value={config.maxSlippageBps ? config.maxSlippageBps / 100 : ''}
              onChange={(value) => handleParameterChange('maxSlippageBps', Number(value) * 100)}
              error={errors.maxSlippageBps}
              min={0.01}
              max={10}
              step={0.01}
              aria-label="Maximum slippage percentage"
            />
          </>
        );

      case StrategyType.ML:
        return (
          <>
            <Input
              type="number"
              label="Confidence Threshold"
              value={config.confidenceThreshold || ''}
              onChange={(value) => handleParameterChange('confidenceThreshold', Number(value))}
              error={errors.confidenceThreshold}
              min={0.6}
              max={1}
              step={0.01}
              aria-label="ML model confidence threshold"
            />
            <Input
              type="number"
              label="Maximum Drawdown (%)"
              value={config.maxDrawdownBps ? config.maxDrawdownBps / 100 : ''}
              onChange={(value) => handleParameterChange('maxDrawdownBps', Number(value) * 100)}
              error={errors.maxDrawdownBps}
              min={1}
              max={20}
              step={0.1}
              aria-label="Maximum drawdown percentage"
            />
          </>
        );
    }
  }, [type, config, errors, handleParameterChange]);

  // Common parameters for all strategies
  const commonParameters = (
    <Input
      type="number"
      label="Position Size (%)"
      value={config.positionSizeBps ? config.positionSizeBps / 100 : ''}
      onChange={(value) => handleParameterChange('positionSizeBps', Number(value) * 100)}
      error={errors.positionSizeBps}
      min={MIN_POSITION_SIZE_BPS / 100}
      max={MAX_POSITION_SIZE_BPS / 100}
      step={0.1}
      aria-label="Position size percentage"
    />
  );

  return (
    <Card
      title="Strategy Parameters"
      className="strategy-parameters"
      loading={isValidating}
    >
      <div role="form" aria-label={`${type} Strategy Configuration`}>
        {renderParameters}
        {commonParameters}
        {errors.general && (
          <div role="alert" className="error-message" aria-live="polite">
            {errors.general}
          </div>
        )}
      </div>
    </Card>
  );
});

ParameterConfig.displayName = 'ParameterConfig';

export default ParameterConfig;