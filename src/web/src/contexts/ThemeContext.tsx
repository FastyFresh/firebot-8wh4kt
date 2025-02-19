import { createContext, useState, useCallback, ReactNode } from 'react'; // v18.0.0
import { darkTheme } from '../config/theme';

// WCAG 2.1 Level AA contrast validation
const validateContrastRatio = (backgroundColor: string, textColor: string): boolean => {
  const hexToRgb = (hex: string): number[] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [0, 0, 0];
  };

  const getLuminance = (r: number, g: number, b: number): number => {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const [bgR, bgG, bgB] = hexToRgb(backgroundColor);
  const [txtR, txtG, txtB] = hexToRgb(textColor);
  
  const bgLuminance = getLuminance(bgR, bgG, bgB);
  const txtLuminance = getLuminance(txtR, txtG, txtB);
  
  const ratio = (Math.max(bgLuminance, txtLuminance) + 0.05) / 
                (Math.min(bgLuminance, txtLuminance) + 0.05);
                
  return ratio >= 4.5; // WCAG 2.1 Level AA requirement for normal text
};

// Theme context type definition with comprehensive tokens
interface ThemeContextType {
  theme: typeof darkTheme;
  isDarkMode: boolean;
  toggleTheme: () => void;
  setTheme: (theme: typeof darkTheme) => void;
}

// Provider props interface
interface ThemeProviderProps {
  children: ReactNode;
}

// Create theme context with default values
export const ThemeContext = createContext<ThemeContextType>({
  theme: darkTheme,
  isDarkMode: true,
  toggleTheme: () => {},
  setTheme: () => {}
});

// Theme provider component with WCAG compliance and performance optimizations
export const ThemeProvider = ({ children }: ThemeProviderProps): JSX.Element => {
  // Initialize theme state with WCAG validation
  const [theme, setThemeState] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('tradingBotTheme');
      if (savedTheme) {
        const parsedTheme = JSON.parse(savedTheme);
        // Validate contrast ratios
        const isValid = validateContrastRatio(
          parsedTheme.palette.background,
          parsedTheme.palette.textPrimary
        );
        return isValid ? parsedTheme : darkTheme;
      }
      return darkTheme;
    } catch (error) {
      console.error('Theme initialization error:', error);
      return darkTheme;
    }
  });

  // Dark mode state with persistence
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('tradingBotDarkMode');
      return saved ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Memoized theme toggle with performance optimization
  const toggleTheme = useCallback(() => {
    setIsDarkMode(prev => {
      const newValue = !prev;
      try {
        localStorage.setItem('tradingBotDarkMode', JSON.stringify(newValue));
      } catch (error) {
        console.error('Error saving dark mode preference:', error);
      }
      return newValue;
    });
  }, []);

  // Memoized theme setter with WCAG validation
  const setTheme = useCallback((newTheme: typeof darkTheme) => {
    try {
      // Validate contrast ratios for critical color combinations
      const isValidContrast = validateContrastRatio(
        newTheme.palette.background,
        newTheme.palette.textPrimary
      );

      if (!isValidContrast) {
        console.error('Theme contrast ratio does not meet WCAG 2.1 Level AA requirements');
        return;
      }

      setThemeState(newTheme);
      localStorage.setItem('tradingBotTheme', JSON.stringify(newTheme));
    } catch (error) {
      console.error('Error setting theme:', error);
    }
  }, []);

  // Performance monitoring for theme changes
  const themeValue = useCallback(() => ({
    theme,
    isDarkMode,
    toggleTheme,
    setTheme
  }), [theme, isDarkMode, toggleTheme, setTheme]);

  return (
    <ThemeContext.Provider value={themeValue()}>
      {children}
    </ThemeContext.Provider>
  );
};