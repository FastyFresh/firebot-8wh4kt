import React from 'react'; // v18.0.0
import classNames from 'classnames'; // v2.3.2
import { useDebounce } from 'use-debounce'; // v9.0.4
import { validateDecimal } from '../../utils/validation';

// Input component props interface with comprehensive accessibility support
export interface InputProps {
    type: 'text' | 'number' | 'password' | 'email';
    value: string | number;
    onChange: (value: string | number) => void;
    placeholder?: string;
    label?: string;
    error?: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    id?: string;
    name?: string;
    required?: boolean;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    maxLength?: number;
    onBlur?: () => void;
    onFocus?: () => void;
    pattern?: string;
    autoComplete?: boolean;
}

// Dark theme constants for WCAG 2.1 Level AA compliance
const THEME = {
    background: '#1E1E1E',
    backgroundHover: '#2C2C2C',
    backgroundDisabled: '#141414',
    text: '#FFFFFF',
    textDisabled: '#666666',
    border: '#333333',
    borderFocus: '#00C853',
    borderError: '#FF3D00',
    labelText: '#B3B3B3',
    errorText: '#FF3D00',
    placeholderText: '#666666'
};

// Memoized input component with enhanced accessibility and validation
export const Input = React.memo<InputProps>(({
    type,
    value,
    onChange,
    placeholder,
    label,
    error,
    disabled = false,
    min,
    max,
    step,
    className,
    id,
    name,
    required = false,
    ariaLabel,
    ariaDescribedBy,
    maxLength,
    onBlur,
    onFocus,
    pattern,
    autoComplete
}) => {
    // Debounce numeric validation for performance
    const [debouncedValidation] = useDebounce(
        (val: string | number) => {
            if (type === 'number' && min !== undefined && max !== undefined) {
                return validateDecimal(val, min, max, (step?.toString().split('.')[1]?.length || 0));
            }
            return true;
        },
        300
    );

    // Handle input changes with validation
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = type === 'number' ? parseFloat(e.target.value) : e.target.value;
        
        if (type === 'number' && isNaN(newValue)) {
            return;
        }

        if (debouncedValidation(newValue)) {
            onChange(newValue);
        }
    };

    // Handle keyboard events for accessibility
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (type === 'number') {
            // Prevent non-numeric input while allowing navigation keys
            if (!/[\d\-+.e]/.test(e.key) && 
                !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
                e.preventDefault();
            }
        }
    };

    // Generate unique ID for input-label association
    const inputId = id || `input-${name || Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
        <div className={classNames('input-container', className)}>
            {label && (
                <label
                    htmlFor={inputId}
                    className="input-label"
                    style={{
                        color: THEME.labelText,
                        marginBottom: '0.5rem',
                        display: 'block',
                        fontSize: '0.875rem',
                        fontWeight: 500
                    }}
                >
                    {label}
                    {required && <span aria-hidden="true" style={{ color: THEME.errorText }}> *</span>}
                </label>
            )}
            
            <input
                id={inputId}
                type={type}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onBlur={onBlur}
                onFocus={onFocus}
                disabled={disabled}
                min={min}
                max={max}
                step={step}
                name={name}
                required={required}
                pattern={pattern}
                maxLength={maxLength}
                autoComplete={autoComplete ? 'on' : 'off'}
                aria-label={ariaLabel || label}
                aria-invalid={!!error}
                aria-required={required}
                aria-describedby={classNames(ariaDescribedBy, errorId)}
                style={{
                    backgroundColor: disabled ? THEME.backgroundDisabled : THEME.background,
                    color: disabled ? THEME.textDisabled : THEME.text,
                    border: `1px solid ${error ? THEME.borderError : THEME.border}`,
                    borderRadius: '4px',
                    padding: '0.75rem',
                    width: '100%',
                    fontSize: '1rem',
                    lineHeight: '1.5',
                    transition: 'all 0.2s ease',
                    outline: 'none'
                }}
                className={classNames('input', {
                    'input-error': error,
                    'input-disabled': disabled
                })}
            />
            
            {error && (
                <div
                    id={errorId}
                    role="alert"
                    aria-live="polite"
                    className="input-error-message"
                    style={{
                        color: THEME.errorText,
                        fontSize: '0.75rem',
                        marginTop: '0.25rem'
                    }}
                >
                    {error}
                </div>
            )}
        </div>
    );
});

Input.displayName = 'Input';