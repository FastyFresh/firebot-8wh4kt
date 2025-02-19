/**
 * @fileoverview Accessible alert component for displaying system notifications, trading alerts, and error messages
 * @version 1.0.0
 * @package react@18.0.0
 * @package @emotion/styled@11.11.0
 */

import React, { useCallback } from 'react';
import styled from '@emotion/styled';
import { palette, animation } from '../../config/theme';
import { Button } from './Button';
import { useTheme } from '../../hooks/useTheme';

// Alert severity levels including trading-specific states
export type AlertSeverity = 'info' | 'success' | 'warning' | 'error' | 'trade' | 'position' | 'system';

// Alert component props interface
interface AlertProps {
  severity: AlertSeverity;
  message: string | React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  animate?: boolean;
  role?: string;
  'aria-live'?: 'polite' | 'assertive';
}

// Get severity-specific styles with WCAG compliance
const getAlertStyles = (props: {
  severity: AlertSeverity;
  animate: boolean;
  dismissible: boolean;
  theme: any;
  contrastMode: string;
}) => {
  const { severity, animate, dismissible, theme } = props;

  // Base styles with proper spacing and typography
  const baseStyles = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing.md}px`,
    borderRadius: '4px',
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.medium,
    lineHeight: theme.typography.lineHeight.normal,
    marginBottom: theme.spacing.md,
    transition: 'all 0.2s ease-in-out',
    position: 'relative' as const,
    width: dismissible ? 'calc(100% - 48px)' : '100%',
  };

  // Severity-specific styles with WCAG compliant colors
  const severityStyles = {
    info: {
      backgroundColor: '#1E88E5',
      color: '#FFFFFF',
      border: '1px solid #1565C0'
    },
    success: {
      backgroundColor: '#43A047',
      color: '#FFFFFF',
      border: '1px solid #2E7D32'
    },
    warning: {
      backgroundColor: '#FB8C00',
      color: '#000000',
      border: '1px solid #EF6C00'
    },
    error: {
      backgroundColor: '#E53935',
      color: '#FFFFFF',
      border: '1px solid #C62828'
    },
    trade: {
      backgroundColor: palette.chartUp,
      color: '#000000',
      border: `1px solid ${palette.chartUp}`
    },
    position: {
      backgroundColor: palette.chartDown,
      color: '#FFFFFF',
      border: `1px solid ${palette.chartDown}`
    },
    system: {
      backgroundColor: palette.paper,
      color: palette.textPrimary,
      border: `1px solid ${palette.border}`
    }
  };

  // Animation styles
  const animationStyles = animate ? {
    animation: `${animation.fadeIn} 0.3s ease-in-out`,
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none'
    }
  } : {};

  return {
    ...baseStyles,
    ...severityStyles[severity],
    ...animationStyles,
    '@media (min-width: 1920px)': {
      padding: `${theme.spacing.lg}px`,
      fontSize: theme.typography.fontSize.lg
    }
  };
};

// Styled alert container
const StyledAlert = styled.div<AlertProps>`
  ${props => getAlertStyles({
    severity: props.severity,
    animate: props.animate || false,
    dismissible: props.dismissible || false,
    theme: props.theme,
    contrastMode: props.theme.contrastMode
  })}
`;

// Alert component implementation
export const Alert: React.FC<AlertProps> = ({
  severity = 'info',
  message,
  dismissible = false,
  onDismiss,
  animate = true,
  role = 'alert',
  'aria-live': ariaLive = 'polite',
  ...props
}) => {
  const { theme } = useTheme();

  // Handle dismiss action
  const handleDismiss = useCallback(() => {
    if (onDismiss) {
      onDismiss();
    }
  }, [onDismiss]);

  return (
    <StyledAlert
      severity={severity}
      dismissible={dismissible}
      animate={animate}
      role={role}
      aria-live={ariaLive}
      theme={theme}
      {...props}
    >
      <div>{message}</div>
      {dismissible && (
        <Button
          variant="secondary"
          size="small"
          onClick={handleDismiss}
          aria-label="Dismiss alert"
        >
          ✕
        </Button>
      )}
    </StyledAlert>
  );
};

export default Alert;