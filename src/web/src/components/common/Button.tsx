/**
 * @fileoverview Accessible button component for the AI-Powered Solana Trading Bot
 * @version 1.0.0
 * @package react@18.0.0
 * @package styled-components@6.0.0
 * @package @react-aria/interactions@3.0.0
 * @package @company/ui-components@1.0.0
 */

import React, { forwardRef } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { useKeyboardFocus } from '@react-aria/interactions';
import { LoadingSpinner } from '@company/ui-components';
import { palette } from '../../config/theme';
import { useTheme } from '../../hooks/useTheme';

// Button props interface extending HTML button attributes
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  loadingText?: string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  children: React.ReactNode;
}

// Loading animation keyframes
const rotate = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

// Styled button component with variants and states
const StyledButton = styled.button<ButtonProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  transition: all 0.2s ease-in-out;
  position: relative;
  width: ${props => props.fullWidth ? '100%' : 'auto'};

  /* Size variants */
  ${props => {
    switch(props.size) {
      case 'small':
        return css`
          padding: 8px 16px;
          font-size: 0.875rem;
          height: 32px;
          
          @media (min-width: 1920px) {
            padding: 10px 20px;
            font-size: 1rem;
            height: 36px;
          }
        `;
      case 'large':
        return css`
          padding: 16px 32px;
          font-size: 1.125rem;
          height: 48px;
          
          @media (min-width: 1920px) {
            padding: 20px 40px;
            font-size: 1.25rem;
            height: 56px;
          }
        `;
      default: // medium
        return css`
          padding: 12px 24px;
          font-size: 1rem;
          height: 40px;
          
          @media (min-width: 1920px) {
            padding: 14px 28px;
            font-size: 1.125rem;
            height: 44px;
          }
        `;
    }
  }}

  /* Color variants */
  ${props => {
    switch(props.variant) {
      case 'secondary':
        return css`
          background-color: transparent;
          border: 1px solid ${palette.secondary};
          color: ${palette.secondary};
          
          &:hover:not(:disabled) {
            background-color: rgba(255, 61, 0, 0.1);
          }
        `;
      case 'danger':
        return css`
          background-color: ${palette.danger};
          color: ${palette.background};
          
          &:hover:not(:disabled) {
            background-color: #ff1744;
          }
        `;
      default: // primary
        return css`
          background-color: ${palette.primary};
          color: ${palette.background};
          
          &:hover:not(:disabled) {
            background-color: #00e676;
          }
        `;
    }
  }}

  /* States */
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus {
    outline: none;
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px ${palette.background}, 0 0 0 4px ${palette.primary};
  }

  /* Loading state */
  ${props => props.loading && css`
    cursor: wait;
    
    .spinner {
      animation: ${rotate} 1s linear infinite;
    }
  `}
`;

// Button component implementation
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  loading = false,
  disabled = false,
  ariaLabel,
  loadingText = 'Loading...',
  icon,
  iconPosition = 'left',
  children,
  ...props
}, ref) => {
  const { isDarkMode } = useTheme();
  const { isFocusVisible, focusProps } = useKeyboardFocus();

  // Handle keyboard interaction
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.currentTarget.click();
    }
    props.onKeyDown?.(event);
  };

  return (
    <StyledButton
      ref={ref}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      loading={loading}
      disabled={disabled || loading}
      aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
      aria-busy={loading}
      aria-disabled={disabled || loading}
      data-focus-visible={isFocusVisible}
      role="button"
      {...focusProps}
      {...props}
      onKeyDown={handleKeyDown}
    >
      {loading ? (
        <>
          <LoadingSpinner
            size={size === 'small' ? 16 : size === 'large' ? 24 : 20}
            color={variant === 'secondary' ? palette.secondary : palette.background}
            className="spinner"
          />
          <span className="sr-only">{loadingText}</span>
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' && icon}
          {children}
          {icon && iconPosition === 'right' && icon}
        </>
      )}
    </StyledButton>
  );
});

Button.displayName = 'Button';

export default Button;