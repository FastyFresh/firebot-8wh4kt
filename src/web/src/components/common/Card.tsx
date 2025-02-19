import React from 'react';
import { palette } from '../../config/theme';
import { Loading } from './Loading';
import '../../styles/components.css';

interface CardProps {
  /** Child elements to render inside the card */
  children: React.ReactNode;
  /** Optional card title with proper heading level */
  title?: string;
  /** Optional additional CSS classes for customization */
  className?: string;
  /** Optional loading state with aria-busy support */
  loading?: boolean;
  /** Optional shadow elevation level for visual hierarchy */
  elevation?: 'low' | 'medium' | 'high';
  /** Optional flag to remove padding for custom layouts */
  noPadding?: boolean;
  /** Optional flag to enable high contrast mode */
  highContrast?: boolean;
}

/**
 * Determines the CSS class for card elevation with dark theme optimization
 * @param elevation - The desired elevation level
 * @returns CSS class name for elevation
 */
const getElevationClass = (elevation?: 'low' | 'medium' | 'high'): string => {
  switch (elevation) {
    case 'low':
      return 'card--elevation-low';
    case 'medium':
      return 'card--elevation-medium';
    case 'high':
      return 'card--elevation-high';
    default:
      return 'card--elevation-low';
  }
};

/**
 * A reusable card component optimized for trading dashboard with dark theme
 * and WCAG 2.1 Level AA compliance.
 */
const Card: React.FC<CardProps> = ({
  children,
  title,
  className = '',
  loading = false,
  elevation = 'low',
  noPadding = false,
  highContrast = false,
}) => {
  // Combine CSS classes for the card
  const cardClasses = [
    'card',
    getElevationClass(elevation),
    noPadding ? 'card--no-padding' : '',
    highContrast ? 'high-contrast' : '',
    className
  ].filter(Boolean).join(' ');

  // Dynamic styles for high contrast and dark theme optimization
  const cardStyle = {
    backgroundColor: highContrast ? palette.paperHighContrast : palette.paper,
    borderColor: palette.border,
    padding: noPadding ? 0 : undefined,
  };

  return (
    <div
      className={cardClasses}
      style={cardStyle}
      role="region"
      aria-busy={loading}
      aria-labelledby={title ? 'card-title' : undefined}
    >
      {title && (
        <h2 
          id="card-title"
          className="card__title"
          style={{ color: palette.textPrimary }}
        >
          {title}
        </h2>
      )}
      
      {loading ? (
        <div className="card__loading">
          <Loading 
            size="md"
            overlay
            reducedMotion={false}
            text="Loading content..."
          />
        </div>
      ) : (
        <div className="card__content">
          {children}
        </div>
      )}
    </div>
  );
};

// Add CSS for reduced motion preference
const styleSheet = document.styleSheets[0];
styleSheet.insertRule(`
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none !important;
    }
  }
`, styleSheet.cssRules.length);

// Add CSS for high contrast preference
styleSheet.insertRule(`
  @media (prefers-contrast: more) {
    .card.high-contrast {
      border-width: 2px;
      box-shadow: none;
    }
  }
`, styleSheet.cssRules.length);

export default Card;