import { format } from 'date-fns'; // v2.30.0
import { utcToZonedTime } from 'date-fns-tz'; // v2.0.0
import { ApiResponse } from '../types/api';

// Constants for timestamp validation and formatting
const MAX_TIMESTAMP_AGE_MS = 7 * 365 * 24 * 60 * 60 * 1000; // 7 years in milliseconds
const TRADE_TIME_FORMAT = 'HH:mm:ss.SSS';
const DEFAULT_FORMAT = 'yyyy-MM-dd HH:mm:ss';

// Timeframe format mapping for chart display
const TIMEFRAME_FORMATS: Record<string, string> = {
  '1m': 'HH:mm',
  '5m': 'HH:mm',
  '15m': 'HH:mm',
  '1h': 'HH:mm',
  '4h': 'HH:mm',
  '1d': 'MMM dd',
  '1w': 'MMM dd',
  '1M': 'MMM yyyy'
};

/**
 * Validates if a given timestamp is within acceptable range for trading operations
 * @param timestamp - Date object to validate
 * @returns boolean indicating if timestamp is valid
 */
export function isValidTimestamp(timestamp: Date): boolean {
  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
    return false;
  }

  const now = new Date();
  const timestampMs = timestamp.getTime();
  const nowMs = now.getTime();

  // Check if timestamp is not in future and not too old
  return timestampMs <= nowMs && 
         timestampMs >= (nowMs - MAX_TIMESTAMP_AGE_MS) && 
         Number.isInteger(timestampMs);
}

/**
 * Formats a timestamp in the user's local timezone with configurable format string
 * @param timestamp - Date object to format
 * @param formatString - Optional format string (defaults to DEFAULT_FORMAT)
 * @returns Formatted date string in local timezone
 */
export function formatTimestamp(timestamp: Date, formatString: string = DEFAULT_FORMAT): string {
  try {
    if (!isValidTimestamp(timestamp)) {
      throw new Error('Invalid timestamp');
    }

    const localTime = utcToZonedTime(timestamp, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return format(localTime, formatString);
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return format(new Date(), DEFAULT_FORMAT);
  }
}

/**
 * Formats a trade timestamp with millisecond precision for accurate latency tracking
 * @param timestamp - Trade execution timestamp
 * @returns Trade time formatted as HH:mm:ss.SSS
 */
export function formatTradeTime(timestamp: Date): string {
  try {
    if (!isValidTimestamp(timestamp)) {
      throw new Error('Invalid trade timestamp');
    }

    const localTime = utcToZonedTime(timestamp, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return format(localTime, TRADE_TIME_FORMAT);
  } catch (error) {
    console.error('Error formatting trade time:', error);
    return format(new Date(), TRADE_TIME_FORMAT);
  }
}

/**
 * Formats timestamps for chart axis display with dynamic precision based on timeframe
 * @param timestamp - Chart data point timestamp
 * @param timeframe - Trading timeframe (e.g., '1m', '5m', '1h', '1d')
 * @returns Formatted date string appropriate for chart display
 */
export function formatChartTime(timestamp: Date, timeframe: string): string {
  try {
    if (!isValidTimestamp(timestamp)) {
      throw new Error('Invalid chart timestamp');
    }

    const formatString = TIMEFRAME_FORMATS[timeframe] || DEFAULT_FORMAT;
    const localTime = utcToZonedTime(timestamp, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return format(localTime, formatString);
  } catch (error) {
    console.error('Error formatting chart time:', error);
    return format(new Date(), DEFAULT_FORMAT);
  }
}

/**
 * Calculates the start timestamp for a given timeframe period with validation
 * @param timeframe - Trading timeframe (e.g., '1m', '5m', '1h', '1d')
 * @param periods - Number of periods to look back
 * @returns Start timestamp for the timeframe
 */
export function getTimeframeStart(timeframe: string, periods: number): Date {
  try {
    if (periods <= 0 || !Number.isInteger(periods)) {
      throw new Error('Invalid periods value');
    }

    const timeframeRegex = /^(\d+)([mhdwM])$/;
    const match = timeframe.match(timeframeRegex);
    
    if (!match) {
      throw new Error('Invalid timeframe format');
    }

    const [, value, unit] = match;
    const numValue = parseInt(value, 10);

    const multipliers: Record<string, number> = {
      'm': 60 * 1000,             // minutes to milliseconds
      'h': 60 * 60 * 1000,        // hours to milliseconds
      'd': 24 * 60 * 60 * 1000,   // days to milliseconds
      'w': 7 * 24 * 60 * 60 * 1000, // weeks to milliseconds
      'M': 30 * 24 * 60 * 60 * 1000 // months to milliseconds (approximate)
    };

    const milliseconds = numValue * multipliers[unit] * periods;
    const startTime = new Date(Date.now() - milliseconds);

    if (!isValidTimestamp(startTime)) {
      throw new Error('Calculated start time is invalid');
    }

    return startTime;
  } catch (error) {
    console.error('Error calculating timeframe start:', error);
    return new Date(Date.now() - (24 * 60 * 60 * 1000)); // Default to 24 hours ago
  }
}