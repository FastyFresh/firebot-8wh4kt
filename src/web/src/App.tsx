import React, { Suspense, useEffect, useState, useCallback } from 'react'; // v18.0.0
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'; // v6.0.0
import { CssBaseline, CircularProgress, Box } from '@mui/material'; // v5.0.0
import { ErrorBoundary } from 'react-error-boundary'; // v4.0.0

// Internal providers and contexts
import { ThemeProvider, theme } from './contexts/ThemeContext';
import { WebSocketProvider, useConnectionHealth } from './contexts/WebSocketContext';

// Lazy-loaded components for performance optimization
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Portfolio = React.lazy(() => import('./pages/Portfolio'));
const Trading = React.lazy(() => import('./pages/Trading'));
const Strategies = React.lazy(() => import('./pages/Strategies'));
const Settings = React.lazy(() => import('./pages/Settings'));

// Error fallback component with WCAG 2.1 compliance
const ErrorFallback: React.FC<{ error: Error; resetErrorBoundary: () => void }> = ({ 
  error, 
  resetErrorBoundary 
}) => (
  <Box
    role="alert"
    aria-live="assertive"
    sx={{
      p: 3,
      color: theme.palette.error.main,
      backgroundColor: theme.palette.background.paper
    }}
  >
    <h2>An error has occurred</h2>
    <p>{error.message}</p>
    <button
      onClick={resetErrorBoundary}
      style={{ padding: '8px 16px', cursor: 'pointer' }}
    >
      Try again
    </button>
  </Box>
);

// Loading component with accessibility support
const LoadingFallback: React.FC = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      backgroundColor: theme.palette.background.default
    }}
  >
    <CircularProgress
      aria-label="Loading application"
      size={48}
      thickness={4}
      sx={{ color: theme.palette.primary.main }}
    />
  </Box>
);

// Enhanced App component with comprehensive error handling and monitoring
const App: React.FC = React.memo(() => {
  const [isInitialized, setIsInitialized] = useState(false);
  const { isConnected, reconnectAttempts } = useConnectionHealth();

  // Initialize performance monitoring
  useEffect(() => {
    if (typeof window !== 'undefined' && 'performance' in window) {
      performance.mark('app-init-start');
    }
    
    return () => {
      if (typeof window !== 'undefined' && 'performance' in window) {
        performance.mark('app-init-end');
        performance.measure('app-initialization', 'app-init-start', 'app-init-end');
      }
    };
  }, []);

  // Monitor WebSocket connection health
  useEffect(() => {
    if (!isConnected && reconnectAttempts > 3) {
      console.error('WebSocket connection unstable');
    }
  }, [isConnected, reconnectAttempts]);

  // Initialize application state
  const initializeApp = useCallback(async () => {
    try {
      // Add initialization logic here
      setIsInitialized(true);
    } catch (error) {
      console.error('Application initialization failed:', error);
      setIsInitialized(false);
    }
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  if (!isInitialized) {
    return <LoadingFallback />;
  }

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => window.location.reload()}
      onError={(error) => {
        console.error('Application error:', error);
        // Add error reporting logic here
      }}
    >
      <ThemeProvider>
        <CssBaseline />
        <WebSocketProvider>
          <BrowserRouter>
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/trading" element={<Trading />} />
                <Route path="/strategies" element={<Strategies />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </WebSocketProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
});

App.displayName = 'App';

export default App;