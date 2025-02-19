// react v18.0.0 - React hooks for state management
import { useState, useCallback, useEffect } from 'react';
// @solana/web3.js v1.73.0 - Solana blockchain integration
import { PhantomProvider } from '@solana/web3.js';

import { 
    requestAuthChallenge, 
    verifyWalletSignature, 
    logout, 
    isAuthenticated 
} from '../services/auth';

// Connection status enum for real-time monitoring
enum ConnectionStatus {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    ERROR = 'ERROR'
}

// Interface for authentication error details
interface AuthError {
    code: number;
    message: string;
    details?: Record<string, unknown>;
}

// Interface for hook return value
interface UseAuthReturn {
    isAuthenticated: boolean;
    walletAddress: string | null;
    isLoading: boolean;
    error: AuthError | null;
    connectionStatus: ConnectionStatus;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
}

/**
 * Custom hook for managing authentication state and wallet interactions
 * Provides secure Phantom wallet integration with comprehensive error handling
 */
export const useAuth = (): UseAuthReturn => {
    // Authentication state
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<AuthError | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);

    // Detect Phantom wallet availability
    const getProvider = (): PhantomProvider | null => {
        if ('solana' in window) {
            const provider = (window as any).solana;
            if (provider.isPhantom) {
                return provider;
            }
        }
        return null;
    };

    // Monitor wallet connection status
    useEffect(() => {
        const provider = getProvider();
        if (provider) {
            provider.on('connect', () => {
                setConnectionStatus(ConnectionStatus.CONNECTED);
                setError(null);
            });

            provider.on('disconnect', () => {
                setConnectionStatus(ConnectionStatus.DISCONNECTED);
                setWalletAddress(null);
            });

            // Check initial connection state
            if (provider.isConnected) {
                setConnectionStatus(ConnectionStatus.CONNECTED);
                setWalletAddress(provider.publicKey?.toString() || null);
            }
        }

        return () => {
            if (provider) {
                provider.removeAllListeners();
            }
        };
    }, []);

    // Secure wallet connection with error handling
    const connect = useCallback(async (): Promise<void> => {
        try {
            setIsLoading(true);
            setError(null);
            setConnectionStatus(ConnectionStatus.CONNECTING);

            const provider = getProvider();
            if (!provider) {
                throw new Error('Phantom wallet not installed');
            }

            // Request wallet connection with timeout
            const connectPromise = provider.connect();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection timeout')), 30000);
            });

            await Promise.race([connectPromise, timeoutPromise]);

            // Get wallet public key
            const publicKey = provider.publicKey?.toString();
            if (!publicKey) {
                throw new Error('Failed to get wallet public key');
            }

            // Request authentication challenge
            const challenge = await requestAuthChallenge(publicKey);

            // Sign challenge message
            const encodedMessage = new TextEncoder().encode(challenge.challenge);
            const signedChallenge = await provider.signMessage(encodedMessage, 'utf8');

            // Verify signature and get tokens
            await verifyWalletSignature(
                publicKey,
                Buffer.from(signedChallenge).toString('base64'),
                challenge.nonce
            );

            setWalletAddress(publicKey);
            setConnectionStatus(ConnectionStatus.CONNECTED);
        } catch (err) {
            const authError: AuthError = {
                code: err instanceof Error ? 401 : 500,
                message: err instanceof Error ? err.message : 'Authentication failed',
                details: err instanceof Error ? { stack: err.stack } : undefined
            };
            setError(authError);
            setConnectionStatus(ConnectionStatus.ERROR);
            console.error('Authentication error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Secure wallet disconnection with state cleanup
    const disconnect = useCallback(async (): Promise<void> => {
        try {
            setIsLoading(true);
            setError(null);

            const provider = getProvider();
            if (provider && provider.isConnected) {
                await provider.disconnect();
            }

            await logout();
            setWalletAddress(null);
            setConnectionStatus(ConnectionStatus.DISCONNECTED);
        } catch (err) {
            const authError: AuthError = {
                code: err instanceof Error ? 401 : 500,
                message: err instanceof Error ? err.message : 'Disconnection failed',
                details: err instanceof Error ? { stack: err.stack } : undefined
            };
            setError(authError);
            console.error('Disconnection error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Monitor suspicious activities
    useEffect(() => {
        const suspiciousActivityCheck = setInterval(() => {
            if (walletAddress && !getProvider()?.isConnected) {
                console.warn('Suspicious activity detected: Wallet disconnected unexpectedly');
                disconnect();
            }
        }, 5000);

        return () => clearInterval(suspiciousActivityCheck);
    }, [walletAddress, disconnect]);

    return {
        isAuthenticated: isAuthenticated(),
        walletAddress,
        isLoading,
        error,
        connectionStatus,
        connect,
        disconnect
    };
};