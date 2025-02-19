// React v18.0.0 - Core React functionality
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
// @solana/web3.js v1.73.0 - Solana blockchain integration
import { PhantomProvider } from '@solana/web3.js';

// Internal imports for authentication and validation
import { requestAuthChallenge, verifyWalletSignature, logout, isAuthenticated } from '../services/auth';

// Authentication rate limiting and refresh constants
const AUTH_RATE_LIMIT = 5; // Maximum auth attempts per minute
const TOKEN_REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes

// Interface for authentication context value
interface AuthContextType {
    walletAddress: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
}

// Create authentication context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Interface for AuthProvider props
interface AuthProviderProps {
    children: ReactNode;
}

/**
 * Authentication Provider component that manages wallet connection and session state
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    // State management
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isAuthenticatedState, setIsAuthenticatedState] = useState<boolean>(false);
    const [lastTokenRefresh, setLastTokenRefresh] = useState<number>(0);
    const [authAttempts, setAuthAttempts] = useState<number>(0);

    // Check for Phantom wallet availability
    const getProvider = (): PhantomProvider | undefined => {
        if ('solana' in window) {
            const provider = (window as any).solana;
            if (provider.isPhantom) {
                return provider;
            }
        }
        return undefined;
    };

    // Initialize authentication state
    useEffect(() => {
        const checkAuthStatus = async () => {
            const authenticated = await isAuthenticated();
            setIsAuthenticatedState(authenticated);
            if (authenticated) {
                const provider = getProvider();
                const publicKey = provider?.publicKey?.toBase58();
                setWalletAddress(publicKey || null);
            }
        };
        checkAuthStatus();
    }, []);

    // Token refresh mechanism
    useEffect(() => {
        let refreshTimer: NodeJS.Timeout;

        if (isAuthenticatedState && lastTokenRefresh) {
            refreshTimer = setTimeout(async () => {
                try {
                    const provider = getProvider();
                    if (provider?.publicKey) {
                        const challenge = await requestAuthChallenge(provider.publicKey.toBase58());
                        const signedMessage = await provider.signMessage(
                            new TextEncoder().encode(challenge.challenge),
                            'utf8'
                        );
                        await verifyWalletSignature(
                            provider.publicKey.toBase58(),
                            signedMessage,
                            challenge.nonce
                        );
                        setLastTokenRefresh(Date.now());
                    }
                } catch (error) {
                    console.error('Token refresh failed:', error);
                    await handleDisconnect();
                }
            }, TOKEN_REFRESH_INTERVAL);
        }

        return () => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }
        };
    }, [isAuthenticatedState, lastTokenRefresh]);

    // Rate limit reset
    useEffect(() => {
        const rateLimitTimer = setInterval(() => {
            setAuthAttempts(0);
        }, 60000); // Reset every minute

        return () => clearInterval(rateLimitTimer);
    }, []);

    // Connect wallet and authenticate
    const handleConnect = useCallback(async () => {
        if (authAttempts >= AUTH_RATE_LIMIT) {
            throw new Error('Authentication rate limit exceeded. Please try again later.');
        }

        setIsLoading(true);
        setAuthAttempts(prev => prev + 1);

        try {
            const provider = getProvider();
            if (!provider) {
                throw new Error('Phantom wallet not found. Please install Phantom wallet.');
            }

            // Request wallet connection
            await provider.connect();
            const publicKey = provider.publicKey?.toBase58();
            
            if (!publicKey) {
                throw new Error('Failed to get wallet public key');
            }

            // Request authentication challenge
            const challenge = await requestAuthChallenge(publicKey);
            
            // Sign challenge message
            const signedMessage = await provider.signMessage(
                new TextEncoder().encode(challenge.challenge),
                'utf8'
            );

            // Verify signature and get tokens
            await verifyWalletSignature(publicKey, signedMessage, challenge.nonce);

            // Update authentication state
            setWalletAddress(publicKey);
            setIsAuthenticatedState(true);
            setLastTokenRefresh(Date.now());
        } catch (error) {
            console.error('Wallet connection failed:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, [authAttempts]);

    // Disconnect wallet and cleanup
    const handleDisconnect = useCallback(async () => {
        setIsLoading(true);
        try {
            const provider = getProvider();
            if (provider) {
                await provider.disconnect();
            }
            await logout();
            setWalletAddress(null);
            setIsAuthenticatedState(false);
            setLastTokenRefresh(0);
        } catch (error) {
            console.error('Wallet disconnection failed:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Context value
    const contextValue: AuthContextType = {
        walletAddress,
        isLoading,
        isAuthenticated: isAuthenticatedState,
        connect: handleConnect,
        disconnect: handleDisconnect
    };

    return (
        <AuthContext.Provider value={contextValue}>
            {children}
        </AuthContext.Provider>
    );
};

/**
 * Custom hook to access authentication context with validation
 */
export const useAuthContext = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
};