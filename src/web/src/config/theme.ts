/**
 * Core theme configuration for the AI-Powered Solana Trading Bot
 * Implements WCAG 2.1 Level AA compliant dark theme optimized for trading interfaces
 * @version 1.0.0
 */

// Color palette with WCAG 2.1 AA compliance (minimum contrast ratio 4.5:1 for normal text, 3:1 for large text)
export const palette = {
  // Core background colors
  background: '#121212', // Main app background
  paper: '#1E1E1E',     // Elevated surfaces
  
  // Primary action colors with sufficient contrast
  primary: '#00C853',   // Green - Success, positive trends
  secondary: '#FF3D00', // Red - Warnings, negative trends
  
  // Text colors meeting WCAG AA contrast requirements
  textPrimary: '#FFFFFF',   // High emphasis text (contrast ratio > 15.8:1)
  textSecondary: '#B3B3B3', // Medium emphasis text (contrast ratio > 7.5:1)
  
  // Trading-specific colors
  border: '#333333',      // Component borders and dividers
  chartGrid: '#2C2C2C',   // Chart gridlines and axes
  chartUp: '#00E676',     // Positive price movements
  chartDown: '#FF1744'    // Negative price movements
};

// Typography configuration optimized for trading data readability
export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: {
    xs: '0.75rem',    // 12px - Small labels
    sm: '0.875rem',   // 14px - Secondary text
    base: '1rem',     // 16px - Body text
    lg: '1.125rem',   // 18px - Section headers
    xl: '1.25rem',    // 20px - Important numbers
    xxl: '1.5rem'     // 24px - Main headers
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700
  },
  lineHeight: {
    tight: 1.2,    // Compact for numbers
    normal: 1.5,   // Standard body text
    relaxed: 1.75  // Enhanced readability
  }
};

// Consistent spacing scale for component and layout spacing
export const spacing = {
  xs: 4,    // 4px - Minimum spacing
  sm: 8,    // 8px - Tight spacing
  md: 16,   // 16px - Standard spacing
  lg: 24,   // 24px - Component spacing
  xl: 32,   // 32px - Section spacing
  xxl: 48   // 48px - Layout spacing
};

// Responsive breakpoints supporting 1920x1080 to ultra-wide monitors
export const breakpoints = {
  xs: 0,          // Base mobile (not primary target)
  sm: 1024,       // Minimum supported
  md: 1440,       // Standard desktop
  lg: 1920,       // Full HD - Primary target
  xl: 2560,       // 2K/QHD
  xxl: 3440       // Ultra-wide
};

// Complete theme configuration object
export const darkTheme = {
  palette,
  typography,
  spacing,
  breakpoints,
  
  // Additional theme configurations
  shape: {
    borderRadius: 4,
    borderWidth: 1
  },
  
  transitions: {
    duration: {
      short: 150,
      standard: 250,
      long: 375
    }
  },
  
  // Trading-specific shadows for depth
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.5)',
    md: '0 2px 4px rgba(0, 0, 0, 0.5)',
    lg: '0 4px 8px rgba(0, 0, 0, 0.5)'
  },
  
  // Z-index scale for layering
  zIndex: {
    tooltip: 1500,
    modal: 1400,
    popover: 1300,
    dropdown: 1200,
    header: 1100,
    base: 1
  }
};