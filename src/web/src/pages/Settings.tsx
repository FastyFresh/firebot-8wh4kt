import React, { useState, useCallback, useEffect } from 'react';
import {
  Switch,
  Typography,
  Slider,
  FormControlLabel,
  TextField,
  Select,
  MenuItem,
  Box,
  Alert,
  Snackbar
} from '@mui/material';
import { useTheme } from '../hooks/useTheme';
import { useAuthContext } from '../contexts/AuthContext';
import Card from '../components/common/Card';
import { STORAGE_KEYS, setItem, getItem } from '../utils/storage';
import { Exchange } from '../types/market';

// Trading preferences interface
interface TradingPreferences {
  defaultSlippage: number;
  preferredDex: Exchange;
  riskLevel: number;
  maxPositionSize: number;
  autoRebalancing: boolean;
}

// Default trading preferences
const DEFAULT_PREFERENCES: TradingPreferences = {
  defaultSlippage: 0.5,
  preferredDex: Exchange.JUPITER,
  riskLevel: 5,
  maxPositionSize: 10,
  autoRebalancing: true
};

const Settings: React.FC = () => {
  // Theme and authentication hooks
  const { isDarkMode, toggleTheme, isHighContrastMode, toggleHighContrast } = useTheme();
  const { walletAddress, disconnect, connectionStatus } = useAuthContext();

  // Local state
  const [preferences, setPreferences] = useState<TradingPreferences>(DEFAULT_PREFERENCES);
  const [notification, setNotification] = useState<{ open: boolean; message: string; type: 'success' | 'error' }>({
    open: false,
    message: '',
    type: 'success'
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load saved preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const saved = await getItem<TradingPreferences>(STORAGE_KEYS.USER_PREFERENCES, true);
        if (saved) {
          setPreferences(saved);
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load preferences:', error);
        setNotification({
          open: true,
          message: 'Failed to load preferences',
          type: 'error'
        });
        setIsLoading(false);
      }
    };
    loadPreferences();
  }, []);

  // Debounced settings update handler
  const handleSettingsUpdate = useCallback(async (updates: Partial<TradingPreferences>) => {
    try {
      const updatedPreferences = { ...preferences, ...updates };
      await setItem(STORAGE_KEYS.USER_PREFERENCES, updatedPreferences, true);
      setPreferences(updatedPreferences);
      setNotification({
        open: true,
        message: 'Settings updated successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Failed to update settings:', error);
      setNotification({
        open: true,
        message: 'Failed to update settings',
        type: 'error'
      });
    }
  }, [preferences]);

  return (
    <div role="main" aria-label="Settings Page">
      {/* Appearance Settings */}
      <Card
        title="Appearance"
        elevation="medium"
        className="settings-card"
        loading={isLoading}
      >
        <FormControlLabel
          control={
            <Switch
              checked={isDarkMode}
              onChange={toggleTheme}
              inputProps={{
                'aria-label': 'Dark mode toggle',
                role: 'switch',
                'aria-checked': isDarkMode
              }}
            />
          }
          label="Dark Mode"
        />
        <FormControlLabel
          control={
            <Switch
              checked={isHighContrastMode}
              onChange={toggleHighContrast}
              inputProps={{
                'aria-label': 'High contrast mode toggle',
                role: 'switch',
                'aria-checked': isHighContrastMode
              }}
            />
          }
          label="High Contrast Mode"
        />
      </Card>

      {/* Wallet Settings */}
      <Card
        title="Wallet"
        elevation="medium"
        className="settings-card"
        loading={isLoading}
      >
        <Box sx={{ mb: 2 }}>
          <Typography variant="body1" gutterBottom>
            Connected Wallet: {walletAddress || 'Not connected'}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Status: {connectionStatus}
          </Typography>
        </Box>
        <button
          onClick={disconnect}
          className="btn-disconnect"
          aria-label="Disconnect wallet"
          disabled={!walletAddress}
        >
          Disconnect Wallet
        </button>
      </Card>

      {/* Trading Preferences */}
      <Card
        title="Trading Preferences"
        elevation="medium"
        className="settings-card"
        loading={isLoading}
      >
        <Box sx={{ mb: 3 }}>
          <Typography id="slippage-label" gutterBottom>
            Default Slippage Tolerance (%)
          </Typography>
          <Slider
            value={preferences.defaultSlippage}
            onChange={(_, value) => handleSettingsUpdate({ defaultSlippage: value as number })}
            aria-labelledby="slippage-label"
            min={0.1}
            max={5}
            step={0.1}
            marks
            valueLabelDisplay="auto"
          />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography id="dex-label" gutterBottom>
            Preferred DEX
          </Typography>
          <Select
            value={preferences.preferredDex}
            onChange={(e) => handleSettingsUpdate({ preferredDex: e.target.value as Exchange })}
            fullWidth
            inputProps={{
              'aria-labelledby': 'dex-label'
            }}
          >
            <MenuItem value={Exchange.JUPITER}>Jupiter</MenuItem>
            <MenuItem value={Exchange.PUMP_FUN}>Pump Fun</MenuItem>
            <MenuItem value={Exchange.DRIFT}>Drift</MenuItem>
          </Select>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography id="risk-label" gutterBottom>
            Risk Level (1-10)
          </Typography>
          <Slider
            value={preferences.riskLevel}
            onChange={(_, value) => handleSettingsUpdate({ riskLevel: value as number })}
            aria-labelledby="risk-label"
            min={1}
            max={10}
            step={1}
            marks
            valueLabelDisplay="auto"
          />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography id="position-size-label" gutterBottom>
            Maximum Position Size (%)
          </Typography>
          <Slider
            value={preferences.maxPositionSize}
            onChange={(_, value) => handleSettingsUpdate({ maxPositionSize: value as number })}
            aria-labelledby="position-size-label"
            min={1}
            max={25}
            step={1}
            marks
            valueLabelDisplay="auto"
          />
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={preferences.autoRebalancing}
              onChange={(e) => handleSettingsUpdate({ autoRebalancing: e.target.checked })}
              inputProps={{
                'aria-label': 'Auto rebalancing toggle'
              }}
            />
          }
          label="Enable Auto Rebalancing"
        />
      </Card>

      {/* Notification Snackbar */}
      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={() => setNotification({ ...notification, open: false })}
      >
        <Alert
          severity={notification.type}
          onClose={() => setNotification({ ...notification, open: false })}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </div>
  );
};

export default Settings;