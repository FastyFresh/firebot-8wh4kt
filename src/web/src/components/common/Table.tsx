import React, { useMemo, useCallback } from 'react';
import { Table as MuiTable, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, TableSortLabel } from '@mui/material'; // v5.0.0
import { FixedSizeList as VirtualList } from 'react-window'; // v1.8.9
import { orderBy } from 'lodash'; // v4.17.21
import { tableContainer, tableHeader, tableRow } from '../../styles/components.css';

interface ColumnConfig {
  id: string;
  label: string;
  accessor: string | ((row: any) => any);
  width?: number;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  format?: (value: any) => React.ReactNode;
  customSort?: (a: any, b: any) => number;
}

interface TableProps {
  data: Array<any>;
  columns: Array<ColumnConfig>;
  virtualized?: boolean;
  rowHeight?: number;
  sortable?: boolean;
  multiSort?: boolean;
  pagination?: boolean;
  pageSize?: number;
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  onRowSelect?: (row: any, index: number) => void;
  rowClassName?: string | ((row: any) => string);
  highlightedRows?: Array<number>;
  loading?: boolean;
  loadingRows?: number;
  emptyStateMessage?: string;
  ariaLabel?: string;
}

interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

const useTableSort = (data: Array<any>, sortConfig: SortConfig | null) => {
  return useMemo(() => {
    if (!sortConfig) return data;

    return orderBy(
      data,
      [(item) => {
        const column = columns.find(col => col.id === sortConfig.column);
        if (!column) return '';
        
        const accessor = column.accessor;
        return typeof accessor === 'function' ? accessor(item) : item[accessor];
      }],
      [sortConfig.direction]
    );
  }, [data, sortConfig]);
};

const useVirtualization = (rowHeight: number, totalRows: number) => {
  return useMemo(() => ({
    height: Math.min(totalRows * rowHeight, window.innerHeight * 0.7),
    itemSize: rowHeight,
    itemCount: totalRows,
  }), [rowHeight, totalRows]);
};

export const Table: React.FC<TableProps> = ({
  data,
  columns,
  virtualized = false,
  rowHeight = 48,
  sortable = true,
  multiSort = false,
  onSort,
  onRowSelect,
  rowClassName,
  highlightedRows = [],
  loading = false,
  loadingRows = 5,
  emptyStateMessage = 'No data available',
  ariaLabel = 'Data table',
}) => {
  const [sortConfig, setSortConfig] = React.useState<SortConfig | null>(null);
  const sortedData = useTableSort(data, sortConfig);
  const virtualConfig = useVirtualization(rowHeight, sortedData.length);

  const handleSort = useCallback((columnId: string) => {
    if (!sortable) return;

    setSortConfig((prevConfig) => {
      const newDirection = 
        prevConfig?.column === columnId && prevConfig.direction === 'asc'
          ? 'desc'
          : 'asc';
      
      const newConfig = { column: columnId, direction: newDirection };
      onSort?.(columnId, newDirection);
      return newConfig;
    });
  }, [sortable, onSort]);

  const renderHeader = useCallback(() => (
    <TableHead className={tableHeader}>
      <TableRow>
        {columns.map((column) => (
          <TableCell
            key={column.id}
            align={column.align || 'left'}
            style={{ width: column.width }}
            sortDirection={sortConfig?.column === column.id ? sortConfig.direction : false}
          >
            {column.sortable !== false && sortable ? (
              <TableSortLabel
                active={sortConfig?.column === column.id}
                direction={sortConfig?.column === column.id ? sortConfig.direction : 'asc'}
                onClick={() => handleSort(column.id)}
                aria-label={`Sort by ${column.label}`}
              >
                {column.label}
              </TableSortLabel>
            ) : (
              column.label
            )}
          </TableCell>
        ))}
      </TableRow>
    </TableHead>
  ), [columns, sortConfig, sortable, handleSort]);

  const renderRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const row = sortedData[index];
    const isHighlighted = highlightedRows.includes(index);
    const rowClass = typeof rowClassName === 'function' ? rowClassName(row) : rowClassName;

    return (
      <TableRow
        key={index}
        className={`${tableRow} ${rowClass || ''} ${isHighlighted ? 'highlighted' : ''}`}
        onClick={() => onRowSelect?.(row, index)}
        style={style}
        role="row"
        aria-rowindex={index + 1}
        tabIndex={0}
      >
        {columns.map((column) => {
          const value = typeof column.accessor === 'function'
            ? column.accessor(row)
            : row[column.accessor];
          
          return (
            <TableCell
              key={column.id}
              align={column.align || 'left'}
              role="cell"
            >
              {column.format ? column.format(value) : value}
            </TableCell>
          );
        })}
      </TableRow>
    );
  }, [sortedData, columns, highlightedRows, rowClassName, onRowSelect]);

  if (loading) {
    return (
      <TableContainer component={Paper} className={tableContainer}>
        <MuiTable aria-label={`${ariaLabel} loading`}>
          {renderHeader()}
          <TableBody>
            {Array.from({ length: loadingRows }).map((_, index) => (
              <TableRow key={index} className="loading-row">
                {columns.map((column) => (
                  <TableCell key={column.id}>
                    <div className="loading-placeholder" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </MuiTable>
      </TableContainer>
    );
  }

  if (!data.length) {
    return (
      <TableContainer component={Paper} className={tableContainer}>
        <MuiTable aria-label={ariaLabel}>
          {renderHeader()}
          <TableBody>
            <TableRow>
              <TableCell
                colSpan={columns.length}
                align="center"
                role="cell"
                aria-label={emptyStateMessage}
              >
                {emptyStateMessage}
              </TableCell>
            </TableRow>
          </TableBody>
        </MuiTable>
      </TableContainer>
    );
  }

  return (
    <TableContainer component={Paper} className={tableContainer}>
      <MuiTable aria-label={ariaLabel}>
        {renderHeader()}
        {virtualized ? (
          <VirtualList
            height={virtualConfig.height}
            itemCount={virtualConfig.itemCount}
            itemSize={virtualConfig.itemSize}
            width="100%"
          >
            {renderRow}
          </VirtualList>
        ) : (
          <TableBody>
            {sortedData.map((row, index) => renderRow({ index, style: {} }))}
          </TableBody>
        )}
      </MuiTable>
    </TableContainer>
  );
};

export type { TableProps, ColumnConfig };