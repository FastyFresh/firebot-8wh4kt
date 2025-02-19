/**
 * @fileoverview Header component for the AI-Powered Solana Trading Bot dashboard
 * Provides wallet connection, theme switching, and navigation controls
 * Implements WCAG 2.1 Level AA compliance with dark theme optimization
 * @version 1.0.0
 * @package react@18.0.0
 * @package styled-components@6.0.0
 * @package @heroicons/react@2.0.0
 */

import React, { useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { Button } from '../common/Button';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';

// Props interface for the Header component
interface HeaderProps {
  className?: string;
}

// Styled components with WCAG compliance
const HeaderContainer = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  padding: 0 24px;
  background-color: ${({ theme }) => theme.palette.background};
  border-bottom: 1px solid ${({ theme }) => theme.palette.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: ${({ theme }) => theme.zIndex.header};
  transition: background-color ${({ theme }) => theme.transitions.duration.standard}ms ease;

  @media (min-width: ${({ theme }) => theme.breakpoints.lg}px) {
    height: 72px;
    padding: 0 32px;
  }
`;

const LogoContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;

  h1 {
    color: ${({ theme }) => theme.palette.textPrimary};
    font-size: ${({ theme }) => theme.typography.fontSize.lg};
    font-weight: ${({ theme }) => theme.typography.fontWeight.bold};
    margin: 0;

    @media (min-width: ${({ theme }) => theme.breakpoints.lg}px) {
      font-size: ${({ theme }) => theme.typography.fontSize.xl};
    }
  }
`;

const ActionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const StatusIndicator = styled.span<{ isConnected: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${({ isConnected, theme }) => 
    isConnected ? theme.palette.chartUp : theme.palette.chartDown};
  margin-right: 8px;
  transition: background-color 0.2s ease;
`;

/**
 * Formats wallet address for display
 * @param address - Full wallet address
 * @returns Formatted address with ellipsis
 */
const formatWalletAddress = (address: string): string => {
  if (!address || address.length < 8) return '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

/**
 * Header component for the trading dashboard
 * Provides wallet connection and theme switching functionality
 */
export const Header: React.FC<HeaderProps> = React.memo(({ className }) => {
  const { 
    isAuthenticated,
    walletAddress,
    connect,
    disconnect,
    isLoading,
    error,
    connectionStatus
  } = useAuth();

  const { isDarkMode, toggleTheme } = useTheme();

  // Memoized wallet button text
  const walletButtonText = useMemo(() => {
    if (isLoading) return 'Connecting...';
    if (isAuthenticated && walletAddress) return formatWalletAddress(walletAddress);
    return 'Connect Wallet';
  }, [isAuthenticated, walletAddress, isLoading]);

  // Handle wallet connection/disconnection
  const handleWalletClick = useCallback(() => {
    if (isAuthenticated) {
      disconnect();
    } else {
      connect();
    }
  }, [isAuthenticated, connect, disconnect]);

  // Handle theme toggle with keyboard support
  const handleThemeToggle = useCallback((
    event: React.MouseEvent | React.KeyboardEvent
  ) => {
    if (
      event.type === 'keydown' &&
      (event as React.KeyboardEvent).key !== 'Enter' &&
      (event as React.KeyboardEvent).key !== ' '
    ) {
      return;
    }
    toggleTheme();
  }, [toggleTheme]);

  return (
    <HeaderContainer className={className} role="banner">
      <LogoContainer>
        <h1>AI Trading Bot</h1>
      </LogoContainer>

      <ActionContainer>
        {error && (
          <span
            role="alert"
            aria-live="polite"
            style={{ color: 'red' }}
          >
            {error.message}
          </span>
        )}

        <Button
          variant="primary"
          size="medium"
          onClick={handleWalletClick}
          disabled={isLoading}
          aria-busy={isLoading}
          aria-label={`${isAuthenticated ? 'Disconnect' : 'Connect'} wallet`}
        >
          <StatusIndicator 
            isConnected={isAuthenticated} 
            aria-hidden="true"
          />
          {walletButtonText}
        </Button>

        <Button
          variant="secondary"
          size="medium"
          onClick={handleThemeToggle}
          onKeyDown={handleThemeToggle}
          aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
          aria-pressed={isDarkMode}
          role="switch"
        >
          {isDarkMode ? (
            <SunIcon width={20} height={20} aria-hidden="true" />
          ) : (
            <MoonIcon width={20} height={20} aria-hidden="true" />
          )}
        </Button>
      </ActionContainer>
    </HeaderContainer>
  );
});

Header.displayName = 'Header';

export default Header;