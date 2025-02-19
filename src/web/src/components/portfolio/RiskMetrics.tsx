import React, { useMemo, useCallback } from 'react';
import Decimal from 'decimal.js-light'; // v2.5.1
import { Portfolio } from '../../types/portfolio';
import { usePortfolio } from '../../hooks/usePortfolio';
import Card from '../common/Card';

interface RiskMetricsProps {
  className?: string;
  highContrast?: boolean;
  customThresholds?: RiskThresholds;
  onRiskAlert?: (level: RiskLevel, message: string) => void;
}

interface RiskThresholds {
  warning: number;
  critical: number;
}

enum RiskLevel {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

const DEFAULT_THRESHOLDS: RiskThresholds = {
  warning: 15, // 15% drawdown
  critical: 25  // 25% drawdown
};

/**
 * Displays comprehensive portfolio risk metrics with accessibility support
 * Implements WCAG 2.1 Level AA compliance
 */
const RiskMetrics: React.FC<RiskMetricsProps> = ({
  className = '',
  highContrast = false,
  customThresholds = DEFAULT_THRESHOLDS,
  onRiskAlert
}) => {
  const { portfolio, error } = usePortfolio();

  // Calculate risk score with confidence level
  const calculateRiskScore = useCallback((portfolio: Portfolio) => {
    if (!portfolio) return null;

    const {
      metrics: {
        maxDrawdown,
        volatility,
        sharpeRatio,
        beta
      },
      riskParameters: {
        maxPositionSize,
        stopLossPercent
      }
    } = portfolio;

    // Weighted risk factors
    const drawdownFactor = maxDrawdown.div(new Decimal(customThresholds.critical));
    const volatilityFactor = volatility.div(new Decimal(30)); // 30% annualized volatility threshold
    const sharpeFactor = new Decimal(1).div(sharpeRatio.abs().plus(1));
    const betaFactor = beta.abs();
    const positionFactor = maxPositionSize.div(new Decimal(100));

    // Composite risk score (0-100)
    const riskScore = drawdownFactor
      .mul(35) // 35% weight
      .plus(volatilityFactor.mul(25)) // 25% weight
      .plus(sharpeFactor.mul(20)) // 20% weight
      .plus(betaFactor.mul(10)) // 10% weight
      .plus(positionFactor.mul(10)) // 10% weight
      .mul(100);

    return {
      score: riskScore,
      confidence: new Decimal(0.85) // 85% confidence level
    };
  }, [customThresholds]);

  // Format metric values with appropriate precision
  const formatMetric = useCallback((value: Decimal, type: string): string => {
    if (type === 'percentage') {
      return `${value.toFixed(2)}%`;
    } else if (type === 'ratio') {
      return value.toFixed(3);
    }
    return value.toFixed(2);
  }, []);

  // Determine risk level and trigger alerts
  const riskLevel = useMemo(() => {
    if (!portfolio) return RiskLevel.LOW;

    const riskScore = calculateRiskScore(portfolio);
    if (!riskScore) return RiskLevel.LOW;

    if (riskScore.score.gte(customThresholds.critical)) {
      onRiskAlert?.(RiskLevel.CRITICAL, 'Portfolio risk level critical - immediate action required');
      return RiskLevel.CRITICAL;
    } else if (riskScore.score.gte(customThresholds.warning)) {
      onRiskAlert?.(RiskLevel.HIGH, 'Portfolio risk level high - review recommended');
      return RiskLevel.HIGH;
    } else if (riskScore.score.gte(10)) {
      return RiskLevel.MODERATE;
    }
    return RiskLevel.LOW;
  }, [portfolio, calculateRiskScore, customThresholds, onRiskAlert]);

  if (error) {
    return (
      <Card 
        className={className}
        highContrast={highContrast}
        title="Risk Metrics"
      >
        <div role="alert" className="risk-metrics__error">
          Error loading risk metrics: {error.message}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`risk-metrics ${className}`}
      highContrast={highContrast}
      title="Risk Metrics"
      elevation="medium"
    >
      <div className="risk-metrics__grid">
        {/* Risk Score */}
        <div className="risk-metrics__section">
          <h3 className="risk-metrics__subtitle">Risk Level</h3>
          <div 
            className={`risk-metrics__score risk-metrics__score--${riskLevel.toLowerCase()}`}
            role="status"
            aria-label={`Current risk level is ${riskLevel}`}
          >
            {riskLevel}
          </div>
        </div>

        {/* Key Metrics */}
        <div className="risk-metrics__section">
          <h3 className="risk-metrics__subtitle">Key Metrics</h3>
          <dl className="risk-metrics__list">
            <div className="risk-metrics__item">
              <dt>Max Drawdown</dt>
              <dd>{formatMetric(portfolio?.metrics.maxDrawdown || new Decimal(0), 'percentage')}</dd>
            </div>
            <div className="risk-metrics__item">
              <dt>Volatility</dt>
              <dd>{formatMetric(portfolio?.metrics.volatility || new Decimal(0), 'percentage')}</dd>
            </div>
            <div className="risk-metrics__item">
              <dt>Sharpe Ratio</dt>
              <dd>{formatMetric(portfolio?.metrics.sharpeRatio || new Decimal(0), 'ratio')}</dd>
            </div>
            <div className="risk-metrics__item">
              <dt>Beta</dt>
              <dd>{formatMetric(portfolio?.metrics.beta || new Decimal(0), 'ratio')}</dd>
            </div>
          </dl>
        </div>

        {/* Risk Parameters */}
        <div className="risk-metrics__section">
          <h3 className="risk-metrics__subtitle">Risk Parameters</h3>
          <dl className="risk-metrics__list">
            <div className="risk-metrics__item">
              <dt>Max Position Size</dt>
              <dd>{formatMetric(portfolio?.riskParameters.maxPositionSize || new Decimal(0), 'percentage')}</dd>
            </div>
            <div className="risk-metrics__item">
              <dt>Stop Loss</dt>
              <dd>{formatMetric(portfolio?.riskParameters.stopLossPercent || new Decimal(0), 'percentage')}</dd>
            </div>
            <div className="risk-metrics__item">
              <dt>Take Profit</dt>
              <dd>{formatMetric(portfolio?.riskParameters.takeProfitPercent || new Decimal(0), 'percentage')}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Card>
  );
};

export default React.memo(RiskMetrics);