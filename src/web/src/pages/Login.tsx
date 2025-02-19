/**
 * @fileoverview Login page component with Phantom wallet authentication and WCAG 2.1 Level AA compliance
 * @version 1.0.0
 */

import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';

// Styled components with WCAG 2.1 Level AA compliance
const LoginContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: ${({ theme }) => theme.palette.background};
  padding: ${({ theme }) => theme.spacing.xl}px;

  @media (max-width: ${({ theme }) => theme.breakpoints.sm}px) {
    padding: ${({ theme }) => theme.spacing.lg}px;
  }
`;

const LoginCard = styled.div`
  background-color: ${({ theme }) => theme.palette.paper};
  border-radius: ${({ theme }) => theme.shape.borderRadius}px;
  padding: ${({ theme }) => theme.spacing.xl}px;
  width: 100%;
  max-width: 400px;
  box-shadow: ${({ theme }) => theme.shadows.md};

  @media (max-width: ${({ theme }) => theme.breakpoints.sm}px) {
    padding: ${({ theme }) => theme.spacing.lg}px;
  }
`;

const Title = styled.h1`
  color: ${({ theme }) => theme.palette.textPrimary};
  font-size: ${({ theme }) => theme.typography.fontSize.xxl};
  font-weight: ${({ theme }) => theme.typography.fontWeight.bold};
  margin-bottom: ${({ theme }) => theme.spacing.lg}px;
  text-align: center;
`;

const Description = styled.p`
  color: ${({ theme }) => theme.palette.textSecondary};
  font-size: ${({ theme }) => theme.typography.fontSize.base};
  line-height: ${({ theme }) => theme.typography.lineHeight.relaxed};
  margin-bottom: ${({ theme }) => theme.spacing.xl}px;
  text-align: center;
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.palette.secondary};
  background-color: rgba(255, 61, 0, 0.1);
  padding: ${({ theme }) => theme.spacing.md}px;
  border-radius: ${({ theme }) => theme.shape.borderRadius}px;
  margin-bottom: ${({ theme }) => theme.spacing.lg}px;
  text-align: center;
  font-size: ${({ theme }) => theme.typography.fontSize.sm};
`;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, error, connect } = useAuth();

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // Handle wallet connection with accessibility announcements
  const handleConnect = useCallback(async () => {
    try {
      await connect();
      // Screen reader announcement
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.textContent = 'Wallet connected successfully. Redirecting to dashboard.';
      document.body.appendChild(announcement);
      
      setTimeout(() => {
        document.body.removeChild(announcement);
      }, 3000);
    } catch (err) {
      // Error announcement for screen readers
      const errorAnnouncement = document.createElement('div');
      errorAnnouncement.setAttribute('role', 'alert');
      errorAnnouncement.textContent = `Connection failed: ${error?.message || 'Unknown error'}`;
      document.body.appendChild(errorAnnouncement);
      
      setTimeout(() => {
        document.body.removeChild(errorAnnouncement);
      }, 3000);
    }
  }, [connect, error]);

  // Handle keyboard navigation
  const handleKeyPress = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleConnect();
    }
  }, [handleConnect]);

  return (
    <LoginContainer role="main">
      <LoginCard>
        <Title>Welcome to AI Trading Bot</Title>
        <Description>
          Connect your Phantom wallet to start trading with AI-powered strategies
          on Solana DEXs.
        </Description>

        {error && (
          <ErrorMessage role="alert" aria-live="assertive">
            {error.message}
          </ErrorMessage>
        )}

        <Button
          variant="primary"
          size="large"
          fullWidth
          loading={isLoading}
          disabled={isLoading}
          onClick={handleConnect}
          onKeyPress={handleKeyPress}
          aria-label="Connect Phantom Wallet"
          loadingText="Connecting wallet..."
        >
          Connect Phantom Wallet
        </Button>
      </LoginCard>
    </LoginContainer>
  );
};

export default Login;