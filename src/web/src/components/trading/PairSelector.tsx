// react v18.0.0
import React, { useState, useMemo, useCallback, useEffect } from 'react';
// decimal.js-light v2.5.1
import Decimal from 'decimal.js-light';
// @mui/material v5.0.0
import { 
    Select, 
    MenuItem, 
    FormControl, 
    InputLabel, 
    Box, 
    Typography, 
    Chip,
    CircularProgress,
    Tooltip 
} from '@mui/material';
import { styled } from '@mui/material/styles';

// Internal imports
import { Exchange, MarketData } from '../../types/market';
import { useMarketData } from '../../hooks/useMarketData';

// Constants for pair validation and formatting
const TRADING_PAIR_REGEX = /^[A-Z0-9]+\/[A-Z0-9]+$/;
const PRICE_PRECISION = 8;
const UPDATE_DEBOUNCE_MS = 100;

// Styled components for enhanced visuals
const StyledFormControl = styled(FormControl)(({ theme }) => ({
    minWidth: 200,
    '& .MuiOutlinedInput-root': {
        backgroundColor: theme.palette.background.paper,
        '&:hover': {
            backgroundColor: theme.palette.action.hover,
        },
    },
}));

const PriceChip = styled(Chip)<{ priceChange: 'positive' | 'negative' | 'neutral' }>(
    ({ theme, priceChange }) => ({
        marginLeft: theme.spacing(1),
        backgroundColor: priceChange === 'positive' 
            ? theme.palette.success.dark 
            : priceChange === 'negative' 
                ? theme.palette.error.dark 
                : theme.palette.grey[700],
    })
);

// Component props interface
interface PairSelectorProps {
    selectedPair: string;
    selectedExchange: Exchange;
    onChange: (pair: string, exchange: Exchange) => void;
    onError?: (error: Error) => void;
    favoritesList?: string[];
    disabled?: boolean;
}

/**
 * Enhanced trading pair selector component with real-time price updates
 * and multi-DEX support for the AI trading bot interface.
 */
export const PairSelector: React.FC<PairSelectorProps> = ({
    selectedPair,
    selectedExchange,
    onChange,
    onError,
    favoritesList = [],
    disabled = false,
}) => {
    // Local state for price change tracking
    const [lastPrice, setLastPrice] = useState<Decimal | null>(null);
    const [priceChange, setPriceChange] = useState<'positive' | 'negative' | 'neutral'>('neutral');

    // Market data subscription with error handling
    const { marketData, isLoading, error } = useMarketData(selectedPair, selectedExchange, {
        batchUpdates: true,
        updateInterval: UPDATE_DEBOUNCE_MS,
        validateData: true,
    });

    // Memoized trading pairs list with favorites prioritized
    const tradingPairs = useMemo(() => {
        const allPairs = [
            ...favoritesList,
            'SOL/USDC',
            'ORCA/USDC',
            'RAY/USDC',
            'SRM/USDC',
            'MNGO/USDC',
        ];
        return Array.from(new Set(allPairs)); // Remove duplicates
    }, [favoritesList]);

    // Handle pair selection changes with validation
    const handlePairChange = useCallback((event: React.ChangeEvent<{ value: unknown }>) => {
        const newPair = event.target.value as string;
        
        if (!TRADING_PAIR_REGEX.test(newPair)) {
            onError?.(new Error(`Invalid trading pair format: ${newPair}`));
            return;
        }

        onChange(newPair, selectedExchange);
    }, [onChange, selectedExchange, onError]);

    // Format pair label with price information
    const formatPairLabel = useCallback((pair: string, data: MarketData | null, loading: boolean) => {
        if (loading) {
            return (
                <Box display="flex" alignItems="center">
                    <Typography>{pair}</Typography>
                    <CircularProgress size={16} sx={{ ml: 1 }} />
                </Box>
            );
        }

        if (!data) {
            return (
                <Box display="flex" alignItems="center">
                    <Typography>{pair}</Typography>
                    <Tooltip title="Price data unavailable">
                        <Chip label="N/A" size="small" sx={{ ml: 1 }} />
                    </Tooltip>
                </Box>
            );
        }

        return (
            <Box display="flex" alignItems="center">
                <Typography>{pair}</Typography>
                <PriceChip
                    label={`$${data.price.toFixed(PRICE_PRECISION)}`}
                    size="small"
                    priceChange={priceChange}
                />
            </Box>
        );
    }, [priceChange]);

    // Update price change indicator
    useEffect(() => {
        if (marketData?.price && lastPrice) {
            const change = marketData.price.comparedTo(lastPrice);
            setPriceChange(change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral');
        }
        if (marketData?.price) {
            setLastPrice(marketData.price);
        }
    }, [marketData?.price, lastPrice]);

    // Error handling effect
    useEffect(() => {
        if (error) {
            onError?.(error);
        }
    }, [error, onError]);

    return (
        <StyledFormControl variant="outlined" disabled={disabled}>
            <InputLabel>Trading Pair</InputLabel>
            <Select
                value={selectedPair}
                onChange={handlePairChange}
                label="Trading Pair"
                MenuProps={{
                    PaperProps: {
                        style: {
                            maxHeight: 300,
                        },
                    },
                }}
            >
                {tradingPairs.map((pair) => (
                    <MenuItem key={pair} value={pair}>
                        {formatPairLabel(pair, 
                            pair === selectedPair ? marketData : null,
                            pair === selectedPair && isLoading
                        )}
                    </MenuItem>
                ))}
            </Select>
        </StyledFormControl>
    );
};