import React, { useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { useLocation, Link } from 'react-router-dom';

// Internal imports
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { ROUTES } from '../../constants/routes';
import { Button } from '../common/Button';

// Props interfaces
interface NavigationProps {
  className?: string;
  testId?: string;
  ariaLabel?: string;
}

interface NavLinkProps {
  to: string;
  active: boolean;
  children: React.ReactNode;
  ariaLabel?: string;
}

// Styled components
const NavContainer = styled.nav`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md}px;
  padding: ${({ theme }) => theme.spacing.lg}px;
  background-color: ${({ theme }) => theme.palette.paper};
  border-right: 1px solid ${({ theme }) => theme.palette.border};
  height: 100vh;
  width: 240px;
  position: fixed;
  left: 0;
  top: 0;
  z-index: ${({ theme }) => theme.zIndex.header};

  @media (min-width: ${({ theme }) => theme.breakpoints.xl}px) {
    width: 280px;
  }

  @media (min-width: ${({ theme }) => theme.breakpoints.xxl}px) {
    width: 320px;
  }
`;

const NavLink = styled(Link)<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm}px;
  padding: ${({ theme }) => theme.spacing.md}px;
  border-radius: ${({ theme }) => theme.shape.borderRadius}px;
  color: ${({ theme, $active }) => 
    $active ? theme.palette.primary : theme.palette.textPrimary};
  background-color: ${({ theme, $active }) => 
    $active ? `${theme.palette.primary}10` : 'transparent'};
  text-decoration: none;
  font-weight: ${({ theme }) => theme.typography.fontWeight.medium};
  transition: all ${({ theme }) => theme.transitions.duration.short}ms ease;

  &:hover {
    background-color: ${({ theme, $active }) => 
      $active ? `${theme.palette.primary}20` : `${theme.palette.background}20`};
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.palette.primary};
    outline-offset: 2px;
  }
`;

const WalletDisplay = styled.div`
  margin-top: auto;
  padding: ${({ theme }) => theme.spacing.md}px;
  border-top: 1px solid ${({ theme }) => theme.palette.border};
  font-size: ${({ theme }) => theme.typography.fontSize.sm};
  color: ${({ theme }) => theme.palette.textSecondary};
`;

const ThemeToggle = styled(Button)`
  margin-top: ${({ theme }) => theme.spacing.sm}px;
`;

// Navigation link component
const NavigationLink: React.FC<NavLinkProps> = ({ 
  to, 
  active, 
  children, 
  ariaLabel 
}) => (
  <NavLink 
    to={to} 
    $active={active}
    aria-current={active ? 'page' : undefined}
    aria-label={ariaLabel}
  >
    {children}
  </NavLink>
);

// Main navigation component
export const Navigation: React.FC<NavigationProps> = ({
  className,
  testId = 'navigation',
  ariaLabel = 'Main navigation'
}) => {
  const location = useLocation();
  const { isDarkMode, toggleTheme } = useTheme();
  const { isAuthenticated, walletAddress } = useAuthContext();

  // Format wallet address for display
  const formatWalletAddress = useCallback((address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyboardNav = (e: KeyboardEvent) => {
      if (e.altKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const routes = Object.values(ROUTES);
        const index = parseInt(e.key) - 1;
        if (routes[index]) {
          window.location.href = routes[index];
        }
      }
    };

    window.addEventListener('keydown', handleKeyboardNav);
    return () => window.removeEventListener('keydown', handleKeyboardNav);
  }, []);

  return (
    <NavContainer
      className={className}
      data-testid={testId}
      aria-label={ariaLabel}
      role="navigation"
    >
      <NavigationLink
        to={ROUTES.DASHBOARD}
        active={location.pathname === ROUTES.DASHBOARD}
        ariaLabel="Dashboard"
      >
        Dashboard
      </NavigationLink>

      {isAuthenticated && (
        <>
          <NavigationLink
            to={ROUTES.PORTFOLIO}
            active={location.pathname === ROUTES.PORTFOLIO}
            ariaLabel="Portfolio"
          >
            Portfolio
          </NavigationLink>

          <NavigationLink
            to={ROUTES.TRADING}
            active={location.pathname === ROUTES.TRADING}
            ariaLabel="Trading"
          >
            Trading
          </NavigationLink>

          <NavigationLink
            to={ROUTES.STRATEGY}
            active={location.pathname === ROUTES.STRATEGY}
            ariaLabel="Strategy"
          >
            Strategy
          </NavigationLink>
        </>
      )}

      <NavigationLink
        to={ROUTES.SETTINGS}
        active={location.pathname === ROUTES.SETTINGS}
        ariaLabel="Settings"
      >
        Settings
      </NavigationLink>

      {isAuthenticated && walletAddress && (
        <WalletDisplay title={walletAddress}>
          Connected: {formatWalletAddress(walletAddress)}
        </WalletDisplay>
      )}

      <ThemeToggle
        variant="secondary"
        size="small"
        onClick={toggleTheme}
        ariaLabel={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
      >
        {isDarkMode ? 'Light Mode' : 'Dark Mode'}
      </ThemeToggle>
    </NavContainer>
  );
};

export default Navigation;