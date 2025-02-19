/**
 * @fileoverview Custom React hook for theme management with dark theme optimization and WCAG 2.1 compliance
 * @version 1.0.0
 * @package react@18.0.0
 */

import { useContext, useCallback, useEffect } from 'react';
import { ThemeContext } from '../contexts/ThemeContext';
import { darkTheme } from '../config/theme';
import { STORAGE_KEYS, setItem, getItem } from '../utils/storage';

// Interface for theme error handling
interface ThemeError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Interface for hook return type
interface UseThemeReturn {
  theme: typeof darkTheme;
  isDarkMode: boolean;
  toggleTheme: () => void;
  setTheme: (theme: typeof darkTheme) => void;
  error: ThemeError | null;
}

/**
 * Custom hook for theme management with system preference detection and persistence
 * @returns {UseThemeReturn} Theme state and control functions
 */
export const useTheme = (): UseThemeReturn => {
  // Get theme context
  const { theme, isDarkMode, toggleTheme, setTheme } = useContext(ThemeContext);
  
  // State for error handling
  let error: ThemeError | null = null;

  // Memoized system preference detection
  const getSystemPreference = useCallback(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (err) {
      error = {
        code: 'SYSTEM_PREFERENCE_ERROR',
        message: 'Failed to detect system color scheme preference',
        details: { error: err }
      };
      return true; // Default to dark mode on error
    }
  }, []);

  // Memoized theme persistence handler
  const persistTheme = useCallback(async (isDark: boolean) => {
    try {
      await setItem(STORAGE_KEYS.USER_PREFERENCES, {
        isDarkMode: isDark,
        theme: isDark ? darkTheme : theme
      }, true); // Encrypt theme preferences
    } catch (err) {
      error = {
        code: 'THEME_PERSISTENCE_ERROR',
        message: 'Failed to persist theme preferences',
        details: { error: err }
      };
    }
  }, [theme]);

  // Initialize theme from storage or system preference
  useEffect(() => {
    const initializeTheme = async () => {
      try {
        const stored = await getItem<{ isDarkMode: boolean; theme: typeof darkTheme }>(
          STORAGE_KEYS.USER_PREFERENCES,
          true
        );
        
        if (stored) {
          setTheme(stored.theme);
        } else {
          const systemDark = getSystemPreference();
          persistTheme(systemDark);
        }
      } catch (err) {
        error = {
          code: 'THEME_INITIALIZATION_ERROR',
          message: 'Failed to initialize theme',
          details: { error: err }
        };
      }
    };

    initializeTheme();
  }, [getSystemPreference, persistTheme, setTheme]);

  // Handle system preference changes
  useEffect(() => {
    try {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        if (!localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)) {
          setTheme(e.matches ? darkTheme : theme);
          persistTheme(e.matches);
        }
      };

      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } catch (err) {
      error = {
        code: 'PREFERENCE_LISTENER_ERROR',
        message: 'Failed to set up system preference listener',
        details: { error: err }
      };
    }
  }, [persistTheme, setTheme, theme]);

  // Sync theme changes with storage
  useEffect(() => {
    persistTheme(isDarkMode);
  }, [isDarkMode, persistTheme]);

  // Apply WCAG-compliant theme classes
  useEffect(() => {
    try {
      document.documentElement.classList.toggle('dark-theme', isDarkMode);
      document.documentElement.classList.toggle('light-theme', !isDarkMode);
      
      // Set color-scheme for system UI elements
      document.documentElement.style.setProperty(
        'color-scheme',
        isDarkMode ? 'dark' : 'light'
      );
    } catch (err) {
      error = {
        code: 'THEME_APPLICATION_ERROR',
        message: 'Failed to apply theme classes',
        details: { error: err }
      };
    }
  }, [isDarkMode]);

  // Memoized theme toggle with error handling
  const handleThemeToggle = useCallback(() => {
    try {
      toggleTheme();
    } catch (err) {
      error = {
        code: 'THEME_TOGGLE_ERROR',
        message: 'Failed to toggle theme',
        details: { error: err }
      };
    }
  }, [toggleTheme]);

  // Memoized theme setter with error handling
  const handleSetTheme = useCallback((newTheme: typeof darkTheme) => {
    try {
      setTheme(newTheme);
    } catch (err) {
      error = {
        code: 'THEME_SET_ERROR',
        message: 'Failed to set theme',
        details: { error: err }
      };
    }
  }, [setTheme]);

  return {
    theme,
    isDarkMode,
    toggleTheme: handleThemeToggle,
    setTheme: handleSetTheme,
    error
  };
};