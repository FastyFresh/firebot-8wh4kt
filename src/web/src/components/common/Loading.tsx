import React from 'react';
import { useReducedMotion } from 'framer-motion';
import '../../styles/components.css';

interface LoadingProps {
  /** Size variant of the spinner */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show the spinner in an overlay */
  overlay?: boolean;
  /** Optional loading text to display */
  text?: string;
  /** Data test id for testing */
  testId?: string;
  /** Additional CSS classes */
  className?: string;
  /** Override reduced motion preference */
  reducedMotion?: boolean;
}

const getSpinnerSize = (size: LoadingProps['size'] = 'md'): number => {
  const sizes = {
    sm: 24,
    md: 40,
    lg: 56
  };
  return sizes[size];
};

const Loading: React.FC<LoadingProps> = ({
  size = 'md',
  overlay = false,
  text,
  testId = 'loading-spinner',
  className = '',
  reducedMotion: forcedReducedMotion
}) => {
  // Check system preference for reduced motion
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = forcedReducedMotion ?? prefersReducedMotion;

  const spinnerSize = getSpinnerSize(size);
  const containerClasses = [
    'loading-container',
    overlay ? 'loading-overlay' : '',
    className
  ].filter(Boolean).join(' ');

  // Style for the spinner with dynamic size
  const spinnerStyle = {
    width: `${spinnerSize}px`,
    height: `${spinnerSize}px`,
    animation: shouldReduceMotion ? 'none' : 'spin 1s linear infinite',
    opacity: shouldReduceMotion ? 0.7 : 1
  };

  return (
    <div 
      className={containerClasses}
      role="alert"
      aria-live="polite"
      aria-busy="true"
      data-testid={testId}
    >
      <div 
        className="loading-spinner"
        style={spinnerStyle}
        aria-hidden="true"
      />
      {text && (
        <span className="loading-text">
          {text}
        </span>
      )}
      {/* Hidden text for screen readers */}
      <span className="sr-only">
        {text || 'Loading, please wait'}
      </span>
    </div>
  );
};

// Define keyframes for the spinning animation
const styleSheet = document.styleSheets[0];
styleSheet.insertRule(`
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`, styleSheet.cssRules.length);

// Add styles for reduced motion preference
styleSheet.insertRule(`
  @media (prefers-reduced-motion: reduce) {
    .loading-spinner {
      animation: none !important;
      opacity: 0.7;
    }
  }
`, styleSheet.cssRules.length);

export default Loading;