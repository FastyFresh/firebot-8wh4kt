import React, { useState, useCallback, useEffect } from 'react'; // ^18.0.0
import Decimal from 'decimal.js-light'; // ^2.5.1
import debounce from 'lodash/debounce'; // ^4.0.8
import { Input } from '../common/Input';
import { GridStrategyConfig } from '../../types/strategy';
import { useStrategy } from '../../hooks/useStrategy';
import { validateDecimal } from '../../utils/validation';

// Constants for grid strategy configuration limits
const MIN_GRID_LEVELS = 5;
const MAX_GRID_LEVELS = 100;
const MIN_POSITION_SIZE_BPS = 100;
const MAX_POSITION_SIZE_BPS = 5000;
const UPDATE_DEBOUNCE_MS = 500;

// Props interface for the GridSettings component
interface GridSettingsProps {
    strategyId: string;
    initialConfig: GridStrategyConfig;
    onUpdate: (config: GridStrategyConfig) => void;
    onError: (errors: Record<string, string>) => void;
}

// Validation interface for grid settings
interface ValidationResult {
    isValid: boolean;
    errors: Record<string, string>;
}

/**
 * Validates grid strategy configuration parameters
 */
const validateGridSettings = (config: Partial<GridStrategyConfig>): ValidationResult => {
    const errors: Record<string, string> = {};

    // Validate grid levels
    if (!config.gridLevels || 
        config.gridLevels < MIN_GRID_LEVELS || 
        config.gridLevels > MAX_GRID_LEVELS) {
        errors.gridLevels = `Grid levels must be between ${MIN_GRID_LEVELS} and ${MAX_GRID_LEVELS}`;
    }

    // Validate price range
    if (config.upperPrice && config.lowerPrice) {
        try {
            const upper = new Decimal(config.upperPrice);
            const lower = new Decimal(config.lowerPrice);
            
            if (upper.lte(lower)) {
                errors.priceRange = 'Upper price must be greater than lower price';
            }

            // Validate minimum price spread
            const spread = upper.sub(lower).div(lower).mul(100);
            if (spread.lt(1)) {
                errors.priceRange = 'Minimum price spread of 1% required';
            }
        } catch (error) {
            errors.priceRange = 'Invalid price values';
        }
    }

    // Validate position size
    if (!config.positionSizeBps || 
        config.positionSizeBps < MIN_POSITION_SIZE_BPS || 
        config.positionSizeBps > MAX_POSITION_SIZE_BPS) {
        errors.positionSizeBps = `Position size must be between ${MIN_POSITION_SIZE_BPS/100}% and ${MAX_POSITION_SIZE_BPS/100}%`;
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

/**
 * Grid Trading Strategy Configuration Component
 * Provides interface for configuring grid trading parameters with real-time validation
 */
export const GridSettings: React.FC<GridSettingsProps> = ({
    strategyId,
    initialConfig,
    onUpdate,
    onError
}) => {
    // Local state for form values
    const [config, setConfig] = useState<GridStrategyConfig>(initialConfig);
    const [validation, setValidation] = useState<ValidationResult>({ isValid: true, errors: {} });
    
    // Strategy update hook
    const { updateStrategy, loading: isUpdating } = useStrategy();

    // Debounced update handler
    const debouncedUpdate = useCallback(
        debounce(async (newConfig: GridStrategyConfig) => {
            try {
                const updatedStrategy = await updateStrategy(strategyId, newConfig);
                onUpdate(updatedStrategy as GridStrategyConfig);
            } catch (error) {
                onError({ update: 'Failed to update strategy configuration' });
            }
        }, UPDATE_DEBOUNCE_MS),
        [strategyId, onUpdate, onError, updateStrategy]
    );

    // Handle input changes with validation
    const handleChange = useCallback((field: keyof GridStrategyConfig, value: string | number) => {
        const newConfig = { ...config };

        switch (field) {
            case 'gridLevels':
                newConfig.gridLevels = Number(value);
                break;
            case 'upperPrice':
            case 'lowerPrice':
                try {
                    newConfig[field] = new Decimal(value);
                } catch (error) {
                    return; // Invalid decimal value
                }
                break;
            case 'positionSizeBps':
                newConfig.positionSizeBps = Number(value);
                break;
        }

        const validationResult = validateGridSettings(newConfig);
        setValidation(validationResult);
        setConfig(newConfig);

        if (validationResult.isValid) {
            debouncedUpdate(newConfig);
        } else {
            onError(validationResult.errors);
        }
    }, [config, debouncedUpdate, onError]);

    // Validate initial configuration
    useEffect(() => {
        const validationResult = validateGridSettings(initialConfig);
        setValidation(validationResult);
        if (!validationResult.isValid) {
            onError(validationResult.errors);
        }
    }, [initialConfig, onError]);

    return (
        <div className="grid-settings" role="form" aria-label="Grid Strategy Settings">
            <Input
                type="number"
                value={config.gridLevels}
                onChange={(value) => handleChange('gridLevels', value)}
                label="Grid Levels"
                error={validation.errors.gridLevels}
                min={MIN_GRID_LEVELS}
                max={MAX_GRID_LEVELS}
                step={1}
                disabled={isUpdating}
                aria-describedby="gridLevels-help"
            />
            <div id="gridLevels-help" className="help-text">
                Number of price levels in the grid
            </div>

            <Input
                type="number"
                value={config.upperPrice.toString()}
                onChange={(value) => handleChange('upperPrice', value)}
                label="Upper Price"
                error={validation.errors.priceRange}
                min={0}
                step="0.000001"
                disabled={isUpdating}
                aria-describedby="upperPrice-help"
            />
            <div id="upperPrice-help" className="help-text">
                Highest price level for grid placement
            </div>

            <Input
                type="number"
                value={config.lowerPrice.toString()}
                onChange={(value) => handleChange('lowerPrice', value)}
                label="Lower Price"
                error={validation.errors.priceRange}
                min={0}
                step="0.000001"
                disabled={isUpdating}
                aria-describedby="lowerPrice-help"
            />
            <div id="lowerPrice-help" className="help-text">
                Lowest price level for grid placement
            </div>

            <Input
                type="number"
                value={config.positionSizeBps / 100} // Convert to percentage
                onChange={(value) => handleChange('positionSizeBps', Number(value) * 100)}
                label="Position Size (%)"
                error={validation.errors.positionSizeBps}
                min={MIN_POSITION_SIZE_BPS / 100}
                max={MAX_POSITION_SIZE_BPS / 100}
                step={0.1}
                disabled={isUpdating}
                aria-describedby="positionSize-help"
            />
            <div id="positionSize-help" className="help-text">
                Maximum position size as percentage of portfolio
            </div>
        </div>
    );
};

// Add display name for debugging
GridSettings.displayName = 'GridSettings';