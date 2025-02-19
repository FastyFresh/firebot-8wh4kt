import React, { useState, useCallback, useEffect, useMemo } from 'react'; // ^18.0.0
import classNames from 'classnames'; // ^2.3.2
import debounce from 'lodash/debounce'; // ^4.0.8
import { Input } from '../common/Input';
import { useStrategy } from '../../hooks/useStrategy';
import {
    MLStrategyConfig,
    MIN_POSITION_SIZE_BPS,
    MAX_POSITION_SIZE_BPS,
    MIN_CONFIDENCE_THRESHOLD,
    MAX_DRAWDOWN_BPS,
} from '../../types/strategy';

// Dark theme constants for WCAG 2.1 Level AA compliance
const THEME = {
    background: '#1E1E1E',
    text: '#FFFFFF',
    labelText: '#B3B3B3',
    success: '#00C853',
    warning: '#FFA000',
    error: '#FF3D00',
};

// Supported ML model types
const ML_MODEL_TYPES = [
    'LSTM',
    'TRANSFORMER',
    'RANDOM_FOREST',
    'XGBoost',
] as const;

interface MLSettingsProps {
    strategyId: string;
    initialConfig: MLStrategyConfig;
    onUpdate: (config: MLStrategyConfig) => void;
    performanceMetrics?: {
        winRate: number;
        sharpeRatio: number;
        maxDrawdown: number;
    };
}

interface ValidationState {
    modelType: string | null;
    confidenceThreshold: string | null;
    positionSizeBps: string | null;
    maxDrawdownBps: string | null;
}

export const MLSettings: React.FC<MLSettingsProps> = React.memo(({
    strategyId,
    initialConfig,
    onUpdate,
    performanceMetrics
}) => {
    // State management
    const [config, setConfig] = useState<MLStrategyConfig>(initialConfig);
    const [validation, setValidation] = useState<ValidationState>({
        modelType: null,
        confidenceThreshold: null,
        positionSizeBps: null,
        maxDrawdownBps: null
    });

    const { updateStrategy, getPerformance } = useStrategy();

    // Validation functions
    const validateModelType = useCallback((type: string): string | null => {
        return ML_MODEL_TYPES.includes(type as typeof ML_MODEL_TYPES[number])
            ? null
            : 'Invalid model type selected';
    }, []);

    const validateConfidenceThreshold = useCallback((value: number): string | null => {
        if (value < MIN_CONFIDENCE_THRESHOLD || value > 1) {
            return `Confidence threshold must be between ${MIN_CONFIDENCE_THRESHOLD} and 1`;
        }
        return null;
    }, []);

    const validatePositionSize = useCallback((value: number): string | null => {
        if (value < MIN_POSITION_SIZE_BPS || value > MAX_POSITION_SIZE_BPS) {
            return `Position size must be between ${MIN_POSITION_SIZE_BPS/100}% and ${MAX_POSITION_SIZE_BPS/100}%`;
        }
        return null;
    }, []);

    const validateDrawdown = useCallback((value: number): string | null => {
        if (value <= 0 || value > MAX_DRAWDOWN_BPS) {
            return `Maximum drawdown must be between 0% and ${MAX_DRAWDOWN_BPS/100}%`;
        }
        return null;
    }, []);

    // Debounced update function
    const debouncedUpdate = useMemo(
        () => debounce(async (newConfig: MLStrategyConfig) => {
            try {
                await updateStrategy(strategyId, newConfig);
                onUpdate(newConfig);
            } catch (error) {
                console.error('Failed to update ML strategy:', error);
            }
        }, 500),
        [strategyId, updateStrategy, onUpdate]
    );

    // Handle input changes
    const handleChange = useCallback((field: keyof MLStrategyConfig, value: string | number) => {
        const newConfig = { ...config, [field]: value };
        let validationError: string | null = null;

        switch (field) {
            case 'modelType':
                validationError = validateModelType(value as string);
                break;
            case 'confidenceThreshold':
                validationError = validateConfidenceThreshold(Number(value));
                break;
            case 'positionSizeBps':
                validationError = validatePositionSize(Number(value));
                break;
            case 'maxDrawdownBps':
                validationError = validateDrawdown(Number(value));
                break;
        }

        setValidation(prev => ({
            ...prev,
            [field]: validationError
        }));

        if (!validationError) {
            setConfig(newConfig);
            debouncedUpdate(newConfig);
        }
    }, [config, validateModelType, validateConfidenceThreshold, validatePositionSize, validateDrawdown, debouncedUpdate]);

    // Cleanup
    useEffect(() => {
        return () => {
            debouncedUpdate.cancel();
        };
    }, [debouncedUpdate]);

    return (
        <div className="ml-settings" style={{ padding: '1.5rem', background: THEME.background }}>
            <h3 style={{ color: THEME.text, marginBottom: '1.5rem' }}>ML Strategy Settings</h3>
            
            {/* Model Type Selection */}
            <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
                <Input
                    type="text"
                    label="Model Type"
                    value={config.modelType}
                    onChange={(value) => handleChange('modelType', value)}
                    error={validation.modelType || undefined}
                    required
                />
                <select
                    value={config.modelType}
                    onChange={(e) => handleChange('modelType', e.target.value)}
                    style={{
                        width: '100%',
                        padding: '0.75rem',
                        marginTop: '0.5rem',
                        background: THEME.background,
                        color: THEME.text,
                        border: '1px solid #333'
                    }}
                >
                    {ML_MODEL_TYPES.map(type => (
                        <option key={type} value={type}>{type}</option>
                    ))}
                </select>
            </div>

            {/* Confidence Threshold */}
            <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
                <Input
                    type="number"
                    label="Confidence Threshold"
                    value={config.confidenceThreshold}
                    onChange={(value) => handleChange('confidenceThreshold', value)}
                    error={validation.confidenceThreshold || undefined}
                    min={MIN_CONFIDENCE_THRESHOLD}
                    max={1}
                    step={0.01}
                    required
                />
            </div>

            {/* Position Size */}
            <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
                <Input
                    type="number"
                    label="Position Size (%)"
                    value={config.positionSizeBps / 100}
                    onChange={(value) => handleChange('positionSizeBps', Number(value) * 100)}
                    error={validation.positionSizeBps || undefined}
                    min={MIN_POSITION_SIZE_BPS / 100}
                    max={MAX_POSITION_SIZE_BPS / 100}
                    step={0.1}
                    required
                />
            </div>

            {/* Maximum Drawdown */}
            <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
                <Input
                    type="number"
                    label="Maximum Drawdown (%)"
                    value={config.maxDrawdownBps / 100}
                    onChange={(value) => handleChange('maxDrawdownBps', Number(value) * 100)}
                    error={validation.maxDrawdownBps || undefined}
                    min={0}
                    max={MAX_DRAWDOWN_BPS / 100}
                    step={0.1}
                    required
                />
            </div>

            {/* Performance Metrics Display */}
            {performanceMetrics && (
                <div className="performance-metrics" style={{ marginTop: '2rem' }}>
                    <h4 style={{ color: THEME.text, marginBottom: '1rem' }}>Performance Metrics</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                        <div className="metric">
                            <label style={{ color: THEME.labelText }}>Win Rate</label>
                            <div style={{ color: THEME.success }}>
                                {(performanceMetrics.winRate * 100).toFixed(2)}%
                            </div>
                        </div>
                        <div className="metric">
                            <label style={{ color: THEME.labelText }}>Sharpe Ratio</label>
                            <div style={{ color: performanceMetrics.sharpeRatio >= 1 ? THEME.success : THEME.warning }}>
                                {performanceMetrics.sharpeRatio.toFixed(2)}
                            </div>
                        </div>
                        <div className="metric">
                            <label style={{ color: THEME.labelText }}>Max Drawdown</label>
                            <div style={{ color: performanceMetrics.maxDrawdown <= config.maxDrawdownBps/100 ? THEME.success : THEME.error }}>
                                {(performanceMetrics.maxDrawdown * 100).toFixed(2)}%
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

MLSettings.displayName = 'MLSettings';