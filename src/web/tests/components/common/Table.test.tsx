import React from 'react';
import { render, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ThemeProvider, createTheme } from '@mui/material';
import { Table } from '../../src/components/common/Table';

expect.extend(toHaveNoViolations);

// Mock trading data generator
const generateTradingData = (count: number) => {
  return Array.from({ length: count }, (_, index) => ({
    id: `trade-${index}`,
    pair: ['SOL/USDC', 'ORCA/USDC', 'RAY/USDC'][index % 3],
    price: 22.50 + (Math.random() * 2 - 1),
    volume: Math.round(1000 + Math.random() * 9000),
    timestamp: new Date(Date.now() - index * 1000).toISOString(),
    status: ['completed', 'pending', 'failed'][index % 3]
  }));
};

// Column configuration for trading data
const tradingColumns = [
  {
    id: 'pair',
    label: 'Trading Pair',
    accessor: 'pair',
    sortable: true,
    align: 'left' as const
  },
  {
    id: 'price',
    label: 'Price',
    accessor: 'price',
    sortable: true,
    align: 'right' as const,
    format: (value: number) => `$${value.toFixed(2)}`
  },
  {
    id: 'volume',
    label: 'Volume',
    accessor: 'volume',
    sortable: true,
    align: 'right' as const,
    format: (value: number) => value.toLocaleString()
  },
  {
    id: 'timestamp',
    label: 'Time',
    accessor: 'timestamp',
    sortable: true,
    align: 'left' as const,
    format: (value: string) => new Date(value).toLocaleTimeString()
  },
  {
    id: 'status',
    label: 'Status',
    accessor: 'status',
    sortable: true,
    align: 'left' as const
  }
];

// Theme setup for dark mode trading interface
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#121212',
      paper: '#1E1E1E'
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#B3B3B3'
    }
  }
});

// Helper function to render table with theme
const renderTable = (props: Partial<typeof Table.defaultProps> = {}) => {
  const defaultProps = {
    data: generateTradingData(10),
    columns: tradingColumns,
    virtualized: false,
    sortable: true,
    ariaLabel: 'Trading data table'
  };

  return render(
    <ThemeProvider theme={darkTheme}>
      <Table {...defaultProps} {...props} />
    </ThemeProvider>
  );
};

describe('Table Component Rendering', () => {
  it('renders empty state message when no data provided', () => {
    renderTable({ data: [] });
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('renders correct number of rows and columns', () => {
    const data = generateTradingData(5);
    renderTable({ data });
    
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(6); // header + 5 data rows
    
    const headerCells = within(rows[0]).getAllByRole('columnheader');
    expect(headerCells).toHaveLength(tradingColumns.length);
  });

  it('applies virtualization for large datasets', () => {
    const data = generateTradingData(1000);
    renderTable({ data, virtualized: true });
    
    const virtualList = screen.getByRole('grid');
    expect(virtualList).toBeInTheDocument();
    expect(virtualList.children.length).toBeLessThan(data.length);
  });

  it('updates efficiently with real-time data', () => {
    const { rerender } = renderTable();
    const initialRows = screen.getAllByRole('row');
    
    // Update with new data
    const newData = generateTradingData(10);
    rerender(
      <ThemeProvider theme={darkTheme}>
        <Table data={newData} columns={tradingColumns} />
      </ThemeProvider>
    );
    
    const updatedRows = screen.getAllByRole('row');
    expect(updatedRows.length).toBe(initialRows.length);
  });
});

describe('Table Interaction', () => {
  it('handles sorting with correct indicators', async () => {
    const onSort = jest.fn();
    renderTable({ onSort });
    
    const priceHeader = screen.getByText('Price');
    await userEvent.click(priceHeader);
    
    expect(onSort).toHaveBeenCalledWith('price', 'asc');
    expect(priceHeader.parentElement).toHaveAttribute('aria-sort', 'ascending');
  });

  it('supports keyboard navigation and sorting', async () => {
    renderTable();
    
    const headers = screen.getAllByRole('columnheader');
    headers[0].focus();
    
    await userEvent.keyboard('{enter}');
    expect(headers[0]).toHaveAttribute('aria-sort', 'ascending');
    
    await userEvent.keyboard('{enter}');
    expect(headers[0]).toHaveAttribute('aria-sort', 'descending');
  });

  it('handles row selection and click events', async () => {
    const onRowSelect = jest.fn();
    renderTable({ onRowSelect });
    
    const rows = screen.getAllByRole('row').slice(1);
    await userEvent.click(rows[0]);
    
    expect(onRowSelect).toHaveBeenCalledWith(expect.any(Object), 0);
  });
});

describe('Table Accessibility', () => {
  it('meets WCAG 2.1 Level AA requirements', async () => {
    const { container } = renderTable();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports screen reader navigation', () => {
    renderTable();
    
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('aria-label', 'Trading data table');
    
    const rows = screen.getAllByRole('row');
    rows.forEach((row, index) => {
      expect(row).toHaveAttribute('aria-rowindex', String(index));
    });
  });

  it('maintains correct ARIA attributes during updates', async () => {
    const { rerender } = renderTable();
    
    const newData = generateTradingData(10);
    rerender(
      <ThemeProvider theme={darkTheme}>
        <Table data={newData} columns={tradingColumns} />
      </ThemeProvider>
    );
    
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('aria-label', 'Trading data table');
  });
});

describe('Table Performance', () => {
  it('renders 10,000+ rows efficiently', () => {
    const data = generateTradingData(10000);
    const startTime = performance.now();
    
    renderTable({ data, virtualized: true });
    const renderTime = performance.now() - startTime;
    
    expect(renderTime).toBeLessThan(1000); // Should render in under 1 second
  });

  it('handles rapid data updates', async () => {
    const { rerender } = renderTable();
    
    // Simulate 10 rapid updates
    for (let i = 0; i < 10; i++) {
      const newData = generateTradingData(100);
      rerender(
        <ThemeProvider theme={darkTheme}>
          <Table data={newData} columns={tradingColumns} />
        </ThemeProvider>
      );
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Table should remain responsive
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('maintains smooth scrolling with virtualization', async () => {
    const data = generateTradingData(1000);
    renderTable({ data, virtualized: true });
    
    const virtualList = screen.getByRole('grid');
    fireEvent.scroll(virtualList, { target: { scrollTop: 1000 } });
    
    // Should render new items without lag
    expect(virtualList.children.length).toBeGreaterThan(0);
  });
});