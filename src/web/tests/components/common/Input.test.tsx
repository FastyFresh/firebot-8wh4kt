import React from 'react'; // v18.0.0
import { render, fireEvent, screen, within } from '@testing-library/react'; // v13.0.0
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'; // v29.0.0
import { axe, toHaveNoViolations } from 'jest-axe'; // v4.7.3
import { ThemeProvider, createTheme } from '@mui/material'; // v5.0.0
import { Input } from '../../src/components/common/Input';
import { validateDecimal } from '../../src/utils/validation';

// Mock validation function
jest.mock('../../src/utils/validation', () => ({
    validateDecimal: jest.fn()
}));

// Dark theme constants from Input component
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

// Create Material-UI theme with dark mode
const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: THEME.background,
            paper: THEME.background
        }
    }
});

// Test setup utilities
const renderWithTheme = (ui: React.ReactElement) => {
    return render(
        <ThemeProvider theme={darkTheme}>
            {ui}
        </ThemeProvider>
    );
};

describe('Input component', () => {
    // Common props for testing
    const defaultProps = {
        type: 'text' as const,
        value: '',
        onChange: jest.fn(),
        label: 'Test Input'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renders with proper dark theme styling', () => {
        const { container } = renderWithTheme(
            <Input {...defaultProps} />
        );

        const input = screen.getByRole('textbox');
        const computedStyle = window.getComputedStyle(input);

        // Verify dark theme compliance
        expect(computedStyle.backgroundColor).toBe(THEME.background);
        expect(computedStyle.color).toBe(THEME.text);
        expect(computedStyle.borderColor).toBe(THEME.border);

        // Verify label styling
        const label = screen.getByText('Test Input');
        expect(label).toHaveStyle({
            color: THEME.labelText
        });
    });

    test('validates high-precision numeric input', async () => {
        (validateDecimal as jest.Mock).mockReturnValue(true);

        renderWithTheme(
            <Input
                type="number"
                value="0"
                onChange={defaultProps.onChange}
                min={0}
                max={100}
                step={0.00000001}
                label="Amount"
            />
        );

        const input = screen.getByRole('spinbutton');

        // Test valid decimal input
        fireEvent.change(input, { target: { value: '12.34567890' } });
        expect(validateDecimal).toHaveBeenCalledWith('12.34567890', 0, 100, 8);
        expect(defaultProps.onChange).toHaveBeenCalled();

        // Test invalid decimal input
        (validateDecimal as jest.Mock).mockReturnValue(false);
        fireEvent.change(input, { target: { value: '999999.999999999' } });
        expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test('meets WCAG 2.1 Level AA requirements', async () => {
        const { container } = renderWithTheme(
            <Input
                {...defaultProps}
                required
                error="Error message"
                ariaLabel="Test input field"
                ariaDescribedBy="test-description"
            />
        );

        // Run accessibility audit
        const results = await axe(container);
        expect(results).toHaveNoViolations();

        // Verify ARIA attributes
        const input = screen.getByRole('textbox');
        expect(input).toHaveAttribute('aria-required', 'true');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAttribute('aria-label', 'Test input field');
        expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('test-description'));

        // Verify error message accessibility
        const errorMessage = screen.getByRole('alert');
        expect(errorMessage).toHaveTextContent('Error message');
        expect(errorMessage).toHaveAttribute('aria-live', 'polite');
    });

    test('handles keyboard navigation and focus management', () => {
        renderWithTheme(
            <>
                <Input {...defaultProps} id="first" />
                <Input {...defaultProps} id="second" />
            </>
        );

        const firstInput = screen.getByLabelText('Test Input');
        const secondInput = screen.getAllByLabelText('Test Input')[1];

        // Test keyboard navigation
        firstInput.focus();
        expect(document.activeElement).toBe(firstInput);
        
        fireEvent.keyDown(firstInput, { key: 'Tab' });
        expect(document.activeElement).toBe(secondInput);

        // Test focus styling
        expect(firstInput).toHaveStyle({
            outline: 'none'
        });
    });

    test('handles disabled state correctly', () => {
        renderWithTheme(
            <Input {...defaultProps} disabled />
        );

        const input = screen.getByRole('textbox');
        
        // Verify disabled styling
        expect(input).toBeDisabled();
        expect(input).toHaveStyle({
            backgroundColor: THEME.backgroundDisabled,
            color: THEME.textDisabled
        });

        // Verify disabled interaction
        fireEvent.change(input, { target: { value: 'test' } });
        expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test('handles error state with proper styling', () => {
        renderWithTheme(
            <Input
                {...defaultProps}
                error="Invalid input"
            />
        );

        const input = screen.getByRole('textbox');
        
        // Verify error styling
        expect(input).toHaveStyle({
            borderColor: THEME.borderError
        });

        // Verify error message
        const errorMessage = screen.getByRole('alert');
        expect(errorMessage).toHaveStyle({
            color: THEME.errorText
        });
    });
});