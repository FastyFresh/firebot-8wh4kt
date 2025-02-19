import React, { useMemo, useCallback, useEffect } from 'react';
import { Pie, ResponsiveContainer, Tooltip } from 'recharts';
import Decimal from 'decimal.js-light';
import { Portfolio, AssetAllocation } from '../../types/portfolio';
import { usePortfolio } from '../../hooks/usePortfolio';
import Card from '../common/Card';

// Chart color scheme optimized for dark theme and WCAG contrast requirements
const CHART_COLORS = [
  '#00C853', // Primary green
  '#FF3D00', // Secondary red
  '#2196F3', // Blue
  '#FFC107', // Amber
  '#9C27B0', // Purple
  '#607D8B'  // Blue grey
];

interface AssetAllocationProps {
  className?: string;
  showChart?: boolean;
  showTable?: boolean;
  rebalanceThreshold?: number;
}

interface ChartData {
  name: string;
  value: number;
  color: string;
  percentage: string;
}

/**
 * Calculates asset allocation with high-precision percentages
 */
const calculateAssetAllocation = (portfolio: Portfolio): AssetAllocation[] => {
  if (!portfolio || !portfolio.positions.length) return [];

  // Calculate total portfolio value with Decimal.js
  const totalValue = portfolio.positions.reduce(
    (sum, position) => sum.plus(position.size.times(position.currentPrice)),
    new Decimal(0)
  );

  // Group positions by asset
  const assetGroups = portfolio.positions.reduce((groups, position) => {
    const [asset] = position.tradingPair.split('/');
    const value = position.size.times(position.currentPrice);
    
    if (!groups[asset]) {
      groups[asset] = {
        asset,
        amount: position.size,
        value: value,
        percentage: new Decimal(0),
        targetPercentage: new Decimal(25), // Default target
        rebalanceThreshold: new Decimal(5)
      };
    } else {
      groups[asset].amount = groups[asset].amount.plus(position.size);
      groups[asset].value = groups[asset].value.plus(value);
    }
    
    return groups;
  }, {} as Record<string, AssetAllocation>);

  // Calculate percentages and sort by value
  return Object.values(assetGroups)
    .map(allocation => ({
      ...allocation,
      percentage: allocation.value.div(totalValue).times(100)
    }))
    .sort((a, b) => b.percentage.minus(a.percentage).toNumber());
};

/**
 * Formats allocation data for chart visualization
 */
const formatAllocationData = (allocations: AssetAllocation[]): ChartData[] => {
  return allocations.map((allocation, index) => ({
    name: allocation.asset,
    value: allocation.value.toNumber(),
    color: CHART_COLORS[index % CHART_COLORS.length],
    percentage: `${allocation.percentage.toFixed(2)}%`
  }));
};

const AssetAllocation: React.FC<AssetAllocationProps> = ({
  className = '',
  showChart = true,
  showTable = true,
  rebalanceThreshold = 5
}) => {
  const { portfolio } = usePortfolio();
  
  // Calculate asset allocation with memoization
  const assetAllocation = useMemo(() => {
    if (!portfolio) return [];
    return calculateAssetAllocation(portfolio);
  }, [portfolio]);

  // Format data for chart with memoization
  const chartData = useMemo(() => {
    return formatAllocationData(assetAllocation);
  }, [assetAllocation]);

  // Custom tooltip for the pie chart
  const renderTooltip = useCallback(({ payload }: any) => {
    if (!payload?.[0]) return null;
    const data = payload[0].payload;
    
    return (
      <div className="asset-allocation__tooltip" style={{ 
        backgroundColor: '#1E1E1E',
        padding: '8px',
        border: '1px solid #333333'
      }}>
        <p style={{ color: '#FFFFFF', margin: 0 }}>
          {data.name}: {data.percentage}
        </p>
        <p style={{ color: '#B3B3B3', margin: '4px 0 0 0' }}>
          Value: ${data.value.toLocaleString()}
        </p>
      </div>
    );
  }, []);

  // Check for rebalancing needs
  useEffect(() => {
    const needsRebalancing = assetAllocation.some(allocation =>
      allocation.percentage.minus(allocation.targetPercentage).abs().gt(rebalanceThreshold)
    );

    if (needsRebalancing) {
      console.warn('Portfolio requires rebalancing');
    }
  }, [assetAllocation, rebalanceThreshold]);

  return (
    <Card
      title="Asset Allocation"
      className={`asset-allocation ${className}`}
      elevation="medium"
      loading={!portfolio}
    >
      <div className="asset-allocation__content">
        {showChart && chartData.length > 0 && (
          <div className="asset-allocation__chart" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {chartData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`}
                    fill={entry.color}
                    stroke="#1E1E1E"
                    strokeWidth={2}
                  />
                ))}
                <Tooltip content={renderTooltip} />
              </Pie>
            </ResponsiveContainer>
          </div>
        )}

        {showTable && (
          <div className="asset-allocation__table" role="table" aria-label="Asset allocation breakdown">
            <div className="asset-allocation__table-header" role="row">
              <div role="columnheader">Asset</div>
              <div role="columnheader">Amount</div>
              <div role="columnheader">Value</div>
              <div role="columnheader">Allocation</div>
            </div>
            {assetAllocation.map((allocation, index) => (
              <div 
                key={allocation.asset}
                className="asset-allocation__table-row"
                role="row"
                style={{ backgroundColor: index % 2 ? '#1A1A1A' : 'transparent' }}
              >
                <div role="cell">{allocation.asset}</div>
                <div role="cell">{allocation.amount.toFixed(4)}</div>
                <div role="cell">${allocation.value.toFixed(2)}</div>
                <div role="cell">
                  <span style={{ color: CHART_COLORS[index % CHART_COLORS.length] }}>
                    {allocation.percentage.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default AssetAllocation;