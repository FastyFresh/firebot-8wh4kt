import React from 'react';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import { axe, toHaveNoViolations } from 'jest-axe';
import Button from '../../src/components/common/Button';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import { palette } from '../../src/config/theme';

// Add jest-axe matchers
expect.extend(toHaveNoViolations);

// Mock theme hook
jest.mock('../../src/hooks/useTheme', () => ({
  useTheme: () => ({
    isDarkMode: true,
    theme: {
      palette
    }
  })
}));

// Helper function to render components with theme
const renderWithTheme = (ui: JSX.Element) => {
  return render(
    <ThemeProvider>
      {ui}
    </ThemeProvider>
  );
};

// Helper to create consistent test props
const createTestProps = (overrides = {}) => ({
  onClick: jest.fn(),
  children: 'Test Button',
  ...overrides
});

describe('Button Component', () => {
  let props: any;
  
  beforeEach(() => {
    props = createTestProps();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering and Styling', () => {
    it('renders with primary variant styling', () => {
      renderWithTheme(<Button {...props} variant="primary" />);
      const button = screen.getByRole('button');
      
      expect(button).toHaveStyle({
        backgroundColor: palette.primary,
        color: palette.background
      });
    });

    it('renders with secondary variant styling', () => {
      renderWithTheme(<Button {...props} variant="secondary" />);
      const button = screen.getByRole('button');
      
      expect(button).toHaveStyle({
        backgroundColor: 'transparent',
        borderColor: palette.secondary,
        color: palette.secondary
      });
    });

    it('renders with danger variant styling', () => {
      renderWithTheme(<Button {...props} variant="danger" />);
      const button = screen.getByRole('button');
      
      expect(button).toHaveStyle({
        backgroundColor: palette.danger,
        color: palette.background
      });
    });

    it('applies correct size classes', () => {
      const { rerender } = renderWithTheme(<Button {...props} size="small" />);
      let button = screen.getByRole('button');
      expect(button).toHaveStyle({ padding: '8px 16px', fontSize: '0.875rem' });

      rerender(<Button {...props} size="large" />);
      button = screen.getByRole('button');
      expect(button).toHaveStyle({ padding: '16px 32px', fontSize: '1.125rem' });
    });

    it('supports full width styling', () => {
      renderWithTheme(<Button {...props} fullWidth />);
      const button = screen.getByRole('button');
      expect(button).toHaveStyle({ width: '100%' });
    });
  });

  describe('Accessibility', () => {
    it('meets WCAG 2.1 accessibility standards', async () => {
      const { container } = renderWithTheme(<Button {...props} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has correct ARIA attributes', () => {
      renderWithTheme(<Button {...props} loading disabled />);
      const button = screen.getByRole('button');
      
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('provides screen reader information for loading state', () => {
      renderWithTheme(<Button {...props} loading loadingText="Processing..." />);
      expect(screen.getByText('Processing...')).toHaveClass('sr-only');
    });

    it('supports custom aria-label', () => {
      renderWithTheme(<Button {...props} ariaLabel="Custom Action" />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Custom Action');
    });
  });

  describe('Interaction States', () => {
    it('handles click events when enabled', () => {
      renderWithTheme(<Button {...props} />);
      fireEvent.click(screen.getByRole('button'));
      expect(props.onClick).toHaveBeenCalledTimes(1);
    });

    it('prevents click events when disabled', () => {
      renderWithTheme(<Button {...props} disabled />);
      fireEvent.click(screen.getByRole('button'));
      expect(props.onClick).not.toHaveBeenCalled();
    });

    it('prevents click events when loading', () => {
      renderWithTheme(<Button {...props} loading />);
      fireEvent.click(screen.getByRole('button'));
      expect(props.onClick).not.toHaveBeenCalled();
    });

    it('shows loading spinner when in loading state', () => {
      renderWithTheme(<Button {...props} loading />);
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('supports keyboard navigation', () => {
      renderWithTheme(<Button {...props} />);
      const button = screen.getByRole('button');
      
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(props.onClick).toHaveBeenCalledTimes(1);
      
      fireEvent.keyDown(button, { key: ' ' });
      expect(props.onClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('Icon Support', () => {
    const icon = <span data-testid="test-icon">★</span>;

    it('renders left icon correctly', () => {
      renderWithTheme(<Button {...props} icon={icon} iconPosition="left" />);
      const button = screen.getByRole('button');
      const iconElement = within(button).getByTestId('test-icon');
      expect(iconElement).toBeInTheDocument();
      expect(button).toHaveStyle({ gap: '8px' });
    });

    it('renders right icon correctly', () => {
      renderWithTheme(<Button {...props} icon={icon} iconPosition="right" />);
      const button = screen.getByRole('button');
      const iconElement = within(button).getByTestId('test-icon');
      expect(iconElement).toBeInTheDocument();
      expect(button).toHaveStyle({ gap: '8px' });
    });

    it('hides icon when loading', () => {
      renderWithTheme(<Button {...props} icon={icon} loading />);
      expect(screen.queryByTestId('test-icon')).not.toBeInTheDocument();
    });
  });

  describe('Theme Integration', () => {
    it('maintains contrast ratios in dark theme', () => {
      renderWithTheme(<Button {...props} variant="primary" />);
      const button = screen.getByRole('button');
      
      const backgroundColor = window.getComputedStyle(button).backgroundColor;
      const color = window.getComputedStyle(button).color;
      
      // Verify contrast ratio meets WCAG AA standards (4.5:1)
      expect(backgroundColor).toBe(palette.primary);
      expect(color).toBe(palette.background);
    });

    it('applies focus styles correctly', () => {
      renderWithTheme(<Button {...props} />);
      const button = screen.getByRole('button');
      
      fireEvent.focus(button);
      expect(button).toHaveStyle({
        boxShadow: `0 0 0 2px ${palette.background}, 0 0 0 4px ${palette.primary}`
      });
    });
  });
});