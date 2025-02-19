import React, { useCallback, useEffect, useState } from 'react';
import styled from '@emotion/styled';
import { palette } from '../../config/theme';

// Styled components with WCAG 2.1 AA compliance
const FooterContainer = styled.footer`
  width: 100%;
  height: 48px;
  border-top: 1px solid ${palette.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background-color: ${palette.background};
  color: ${palette.textSecondary};
  font-size: 14px;
  z-index: 10;

  @container (min-width: 2560px) {
    height: 64px;
    padding: 0 32px;
    font-size: 16px;
  }
`;

const StatusIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;

  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: ${({ status }: { status: 'online' | 'degraded' | 'offline' }) => 
      status === 'online' ? palette.primary :
      status === 'degraded' ? '#FFC107' :
      palette.secondary};
    transition: background-color 0.3s ease;
  }
`;

const MetricsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
`;

const MetricItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  span {
    color: ${({ positive }: { positive?: boolean }) => 
      positive ? palette.primary : palette.secondary};
  }
`;

const VersionInfo = styled.div`
  font-size: 12px;
  letter-spacing: 0.1px;
  
  @container (min-width: 2560px) {
    font-size: 14px;
  }
`;

// Types for performance metrics
interface PerformanceMetrics {
  tradeLatency: number;
  dailyPnL: number;
  uptime: number;
  activeStrategies: number;
}

// Footer component with performance optimization
const Footer: React.FC = React.memo(() => {
  const [systemStatus, setSystemStatus] = useState<'online' | 'degraded' | 'offline'>('online');
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    tradeLatency: 0,
    dailyPnL: 0,
    uptime: 100,
    activeStrategies: 0
  });

  // Update metrics with debouncing
  const updateMetrics = useCallback(async () => {
    try {
      // TODO: Replace with actual API call
      const newMetrics = {
        tradeLatency: 235, // ms
        dailyPnL: 2.5, // %
        uptime: 99.98, // %
        activeStrategies: 3
      };
      setMetrics(newMetrics);
    } catch (error) {
      console.error('Failed to update metrics:', error);
      setSystemStatus('degraded');
    }
  }, []);

  useEffect(() => {
    const metricsInterval = setInterval(updateMetrics, 1000);
    return () => clearInterval(metricsInterval);
  }, [updateMetrics]);

  return (
    <FooterContainer role="contentinfo">
      <StatusIndicator 
        status={systemStatus}
        role="status"
        aria-live="polite"
        aria-label={`System status: ${systemStatus}`}
      >
        System {systemStatus}
      </StatusIndicator>

      <MetricsContainer aria-label="Performance metrics">
        <MetricItem aria-label="Trade latency">
          Latency: <span>{metrics.tradeLatency}ms</span>
        </MetricItem>
        <MetricItem positive={metrics.dailyPnL >= 0} aria-label="Daily profit and loss">
          24h P/L: <span>{metrics.dailyPnL >= 0 ? '+' : ''}{metrics.dailyPnL}%</span>
        </MetricItem>
        <MetricItem aria-label="System uptime">
          Uptime: <span>{metrics.uptime}%</span>
        </MetricItem>
        <MetricItem aria-label="Active trading strategies">
          Active: <span>{metrics.activeStrategies}</span>
        </MetricItem>
      </MetricsContainer>

      <VersionInfo aria-label="Version information">
        v1.0.0 | Build 20231215
      </VersionInfo>
    </FooterContainer>
  );
});

Footer.displayName = 'Footer';

export default Footer;