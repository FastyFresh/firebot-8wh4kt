import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styled from '@emotion/styled';
import { ErrorBoundary } from 'react-error-boundary';

import { ROUTES } from '../../constants/routes';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';

// Navigation item interface with accessibility properties
interface NavItem {
  path: string;
  label: string;
  icon: JSX.Element;
  ariaLabel: string;
}

// Sidebar component props
interface SidebarProps {
  className?: string;
  isCollapsed?: boolean;
}

// Styled components with dark theme optimization
const SidebarContainer = styled.aside<{ isCollapsed: boolean }>`
  display: flex;
  flex-direction: column;
  width: ${({ isCollapsed }) => (isCollapsed ? '64px' : '240px')};
  height: 100vh;
  background-color: ${({ theme }) => theme.palette.paper};
  border-right: 1px solid ${({ theme }) => theme.palette.border};
  transition: width ${({ theme }) => theme.transitions.duration.standard}ms ease;
  padding: ${({ theme }) => theme.spacing.md}px;
  overflow-y: auto;
  overflow-x: hidden;
  
  @media (max-width: ${({ theme }) => theme.breakpoints.sm}px) {
    width: ${({ isCollapsed }) => (isCollapsed ? '0' : '240px')};
  }
`;

const WalletSection = styled.div`
  padding: ${({ theme }) => theme.spacing.md}px;
  border-bottom: 1px solid ${({ theme }) => theme.palette.border};
  margin-bottom: ${({ theme }) => theme.spacing.lg}px;
`;

const WalletAddress = styled.p`
  color: ${({ theme }) => theme.palette.textPrimary};
  font-family: ${({ theme }) => theme.typography.fontFamily};
  font-size: ${({ theme }) => theme.typography.fontSize.sm};
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NavList = styled.nav`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm}px;
`;

const NavItemContainer = styled(Link)<{ isActive: boolean }>`
  display: flex;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.sm}px;
  text-decoration: none;
  border-radius: ${({ theme }) => theme.shape.borderRadius}px;
  background-color: ${({ isActive, theme }) => 
    isActive ? theme.palette.primary + '20' : 'transparent'};
  color: ${({ isActive, theme }) => 
    isActive ? theme.palette.primary : theme.palette.textPrimary};
  transition: all ${({ theme }) => theme.transitions.duration.short}ms ease;
  
  &:hover, &:focus {
    background-color: ${({ theme }) => theme.palette.primary + '10'};
    outline: none;
  }
  
  &:focus-visible {
    box-shadow: 0 0 0 2px ${({ theme }) => theme.palette.primary};
  }
`;

const NavLabel = styled.span<{ isCollapsed: boolean }>`
  margin-left: ${({ theme }) => theme.spacing.sm}px;
  font-size: ${({ theme }) => theme.typography.fontSize.base};
  font-weight: ${({ theme }) => theme.typography.fontWeight.medium};
  opacity: ${({ isCollapsed }) => (isCollapsed ? 0 : 1)};
  transition: opacity ${({ theme }) => theme.transitions.duration.standard}ms ease;
`;

// Error fallback component
const ErrorFallback = styled.div`
  padding: ${({ theme }) => theme.spacing.md}px;
  color: ${({ theme }) => theme.palette.secondary};
`;

/**
 * Sidebar component providing primary navigation and wallet status
 * Implements WCAG 2.1 Level AA compliance with keyboard navigation
 */
export const Sidebar = React.memo(({ className, isCollapsed = false }: SidebarProps) => {
  const location = useLocation();
  const { walletAddress, isAuthenticated, isLoading } = useAuth();
  const { isDarkMode, theme } = useTheme();
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Navigation items with accessibility labels
  const navItems: NavItem[] = [
    {
      path: ROUTES.DASHBOARD,
      label: 'Dashboard',
      icon: <span aria-hidden="true">📊</span>,
      ariaLabel: 'Navigate to dashboard'
    },
    {
      path: ROUTES.PORTFOLIO,
      label: 'Portfolio',
      icon: <span aria-hidden="true">💼</span>,
      ariaLabel: 'View portfolio'
    },
    {
      path: ROUTES.TRADING,
      label: 'Trading',
      icon: <span aria-hidden="true">📈</span>,
      ariaLabel: 'Access trading interface'
    },
    {
      path: ROUTES.STRATEGY,
      label: 'Strategy',
      icon: <span aria-hidden="true">🎯</span>,
      ariaLabel: 'Configure trading strategies'
    },
    {
      path: ROUTES.SETTINGS,
      label: 'Settings',
      icon: <span aria-hidden="true">⚙️</span>,
      ariaLabel: 'Adjust settings'
    }
  ];

  // Check if route is active
  const isActiveRoute = useCallback((path: string): boolean => {
    return location.pathname === path;
  }, [location]);

  // Keyboard navigation handler
  const handleKeyNavigation = useCallback((event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex(prevIndex => {
        const newIndex = event.key === 'ArrowDown'
          ? (prevIndex + 1) % navItems.length
          : (prevIndex - 1 + navItems.length) % navItems.length;
        return newIndex;
      });
    }
  }, [navItems.length]);

  // Set up keyboard navigation
  useEffect(() => {
    document.addEventListener('keydown', handleKeyNavigation);
    return () => document.removeEventListener('keydown', handleKeyNavigation);
  }, [handleKeyNavigation]);

  // Focus management
  useEffect(() => {
    if (focusedIndex >= 0) {
      const element = document.querySelector(`[data-nav-index="${focusedIndex}"]`);
      if (element instanceof HTMLElement) {
        element.focus();
      }
    }
  }, [focusedIndex]);

  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => (
        <ErrorFallback>
          Navigation error: {error.message}
        </ErrorFallback>
      )}
    >
      <SidebarContainer
        className={className}
        isCollapsed={isCollapsed}
        role="navigation"
        aria-label="Main navigation"
      >
        <WalletSection role="status" aria-label="Wallet status">
          {isLoading ? (
            <WalletAddress>Loading wallet...</WalletAddress>
          ) : isAuthenticated && walletAddress ? (
            <WalletAddress title={walletAddress}>
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </WalletAddress>
          ) : (
            <WalletAddress>Not connected</WalletAddress>
          )}
        </WalletSection>

        <NavList>
          {navItems.map((item, index) => (
            <NavItemContainer
              key={item.path}
              to={item.path}
              isActive={isActiveRoute(item.path)}
              aria-label={item.ariaLabel}
              aria-current={isActiveRoute(item.path) ? 'page' : undefined}
              data-nav-index={index}
              tabIndex={0}
            >
              {item.icon}
              <NavLabel isCollapsed={isCollapsed}>
                {item.label}
              </NavLabel>
            </NavItemContainer>
          ))}
        </NavList>
      </SidebarContainer>
    </ErrorBoundary>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;