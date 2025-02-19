// React 18 core for concurrent rendering features
import React, { StrictMode } from 'react'; // v18.0.0
import { createRoot } from 'react-dom/client'; // v18.0.0

// Root application component
import App from './App';

// Global styles with dark theme optimization
import './styles/global.css';

/**
 * Validates root DOM element existence and accessibility
 * Throws detailed error if element is not found or inaccessible
 */
const validateRootElement = (): HTMLElement => {
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    throw new Error(
      'Root element not found. Ensure there is a <div id="root"></div> in your HTML.'
    );
  }

  // Validate accessibility attributes
  if (!rootElement.hasAttribute('role')) {
    rootElement.setAttribute('role', 'application');
  }
  
  if (!rootElement.hasAttribute('aria-label')) {
    rootElement.setAttribute('aria-label', 'AI-Powered Solana Trading Dashboard');
  }

  return rootElement;
};

/**
 * Initializes the React application with performance monitoring
 * and error handling configuration
 */
const initializeApp = (): void => {
  // Initialize performance monitoring
  if (typeof window !== 'undefined' && 'performance' in window) {
    performance.mark('app-init-start');
  }

  try {
    // Validate and get root element
    const rootElement = validateRootElement();

    // Create React 18 concurrent root
    const root = createRoot(rootElement);

    // Render application with StrictMode for development optimizations
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    // Record performance metrics
    if (typeof window !== 'undefined' && 'performance' in window) {
      performance.mark('app-init-end');
      performance.measure('app-initialization', 'app-init-start', 'app-init-end');
    }
  } catch (error) {
    console.error('Application initialization failed:', error);
    
    // Display user-friendly error message
    const errorElement = document.createElement('div');
    errorElement.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 20px;
      background-color: #1E1E1E;
      color: #FFFFFF;
      border-radius: 4px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    errorElement.innerHTML = `
      <h2>Application Error</h2>
      <p>Unable to initialize the trading dashboard. Please refresh the page or contact support.</p>
    `;
    document.body.appendChild(errorElement);
  }
};

// Initialize application
initializeApp();

// Enable hot module replacement for development
if (process.env.NODE_ENV === 'development' && module.hot) {
  module.hot.accept('./App', () => {
    initializeApp();
  });
}