import React, { useMemo, useCallback, useState } from 'react';
import Decimal from 'decimal.js-light'; // v2.5.1
import { Table, ColumnConfig, SortConfig } from '../common/Table';
import { Order, OrderStatus } from '../../types/trading';
import { formatPrice, formatVolume } from '../../utils/format';

interface OrderHistoryProps {
  orders: Order[];
  onOrderCancel: (orderId: string) => Promise<void>;
  loading: boolean;
  pageSize: number;
  className?: string;
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  sortConfig?: SortConfig;
  onError?: (error: Error) => void;
  highContrastMode?: boolean;
}

const getStatusColor = (status: OrderStatus, highContrastMode: boolean): string => {
  const baseColors = {
    [OrderStatus.PENDING]: 'bg-yellow-500',
    [OrderStatus.OPEN]: 'bg-blue-500',
    [OrderStatus.FILLED]: 'bg-green-500',
    [OrderStatus.CANCELLED]: 'bg-gray-500',
    [OrderStatus.FAILED]: 'bg-red-500'
  };

  const highContrastColors = {
    [OrderStatus.PENDING]: 'bg-yellow-600',
    [OrderStatus.OPEN]: 'bg-blue-600',
    [OrderStatus.FILLED]: 'bg-green-600',
    [OrderStatus.CANCELLED]: 'bg-gray-600',
    [OrderStatus.FAILED]: 'bg-red-600'
  };

  return highContrastMode ? highContrastColors[status] : baseColors[status];
};

export const OrderHistory: React.FC<OrderHistoryProps> = ({
  orders,
  onOrderCancel,
  loading,
  pageSize,
  className = '',
  onSort,
  sortConfig,
  onError,
  highContrastMode = false
}) => {
  const [cancellingOrders, setCancellingOrders] = useState<Set<string>>(new Set());

  const handleOrderCancel = useCallback(async (orderId: string) => {
    if (cancellingOrders.has(orderId)) return;

    try {
      setCancellingOrders(prev => new Set(prev).add(orderId));
      await onOrderCancel(orderId);
    } catch (error) {
      onError?.(error as Error);
      console.error('Failed to cancel order:', error);
    } finally {
      setCancellingOrders(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  }, [cancellingOrders, onOrderCancel, onError]);

  const renderStatusCell = useCallback((status: OrderStatus) => {
    const statusColor = getStatusColor(status, highContrastMode);
    return (
      <div className="flex items-center space-x-2" role="status" aria-label={`Order status: ${status}`}>
        <div className={`w-3 h-3 rounded-full ${statusColor}`} />
        <span className="font-medium">{status}</span>
      </div>
    );
  }, [highContrastMode]);

  const renderActionCell = useCallback((order: Order) => {
    const canCancel = order.status === OrderStatus.OPEN || order.status === OrderStatus.PENDING;
    const isCancelling = cancellingOrders.has(order.id);

    return canCancel ? (
      <button
        onClick={() => handleOrderCancel(order.id)}
        disabled={isCancelling}
        className={`px-3 py-1 rounded text-sm font-medium focus:outline-none focus:ring-2 
          ${isCancelling ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 text-white'}`}
        aria-busy={isCancelling}
        aria-label={`Cancel order ${order.id}`}
      >
        {isCancelling ? 'Cancelling...' : 'Cancel'}
      </button>
    ) : null;
  }, [cancellingOrders, handleOrderCancel]);

  const columns = useMemo<ColumnConfig[]>(() => [
    {
      id: 'tradingPair',
      label: 'Trading Pair',
      accessor: 'tradingPair',
      sortable: true,
      width: 150
    },
    {
      id: 'type',
      label: 'Type',
      accessor: 'type',
      sortable: true,
      width: 100
    },
    {
      id: 'side',
      label: 'Side',
      accessor: 'side',
      sortable: true,
      width: 100,
      format: (value: string) => (
        <span className={value === 'buy' ? 'text-green-500' : 'text-red-500'}>
          {value.toUpperCase()}
        </span>
      )
    },
    {
      id: 'price',
      label: 'Price',
      accessor: 'price',
      sortable: true,
      width: 150,
      format: (value: Decimal) => formatPrice(value, 'USDC')
    },
    {
      id: 'amount',
      label: 'Amount',
      accessor: 'amount',
      sortable: true,
      width: 150,
      format: (value: Decimal) => formatVolume(value)
    },
    {
      id: 'status',
      label: 'Status',
      accessor: 'status',
      sortable: true,
      width: 150,
      format: renderStatusCell
    },
    {
      id: 'actions',
      label: 'Actions',
      accessor: (order: Order) => order,
      sortable: false,
      width: 100,
      format: renderActionCell
    }
  ], [renderStatusCell, renderActionCell]);

  return (
    <div className={`order-history ${className}`} role="region" aria-label="Order History">
      <Table
        data={orders}
        columns={columns}
        loading={loading}
        pageSize={pageSize}
        onSort={onSort}
        sortConfig={sortConfig}
        virtualized={true}
        rowHeight={48}
        ariaLabel="Orders table"
        emptyStateMessage="No orders found"
      />
    </div>
  );
};

export default OrderHistory;