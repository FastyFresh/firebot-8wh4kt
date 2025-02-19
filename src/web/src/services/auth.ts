// @solana/web3.js v1.73.0 - Solana blockchain integration
import { PhantomProvider } from '@solana/web3.js';
// bs58 v5.0.0 - Base58 encoding/decoding for Solana signatures
import bs58 from 'bs58';

import { ApiResponse } from '../types/api';
import { makeApiRequest, setAuthToken, clearAuthToken } from '../utils/api';
import { validateWalletAddress } from '../utils/validation';
import { API_ENDPOINTS, ERROR_CODES } from '../constants/api';

// Constants for authentication configuration
const AUTH_CHALLENGE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes before expiration
const MAX_RETRY_ATTEMPTS = 3;

// Interface for challenge response
interface AuthChallenge {
    challenge: string;
    expiresAt: number;
    nonce: string;
}

// Interface for authentication tokens
interface AuthTokens {
    token: string;
    refreshToken: string;
    expiresIn: number;
}

// Interface for token refresh timer
let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Requests an authentication challenge for wallet signature
 * @param walletAddress - Solana wallet address
 * @returns Challenge data for wallet signature
 */
export const requestAuthChallenge = async (walletAddress: string): Promise<AuthChallenge> => {
    try {
        // Validate wallet address format
        if (!validateWalletAddress(walletAddress)) {
            throw new Error('Invalid wallet address format');
        }

        const response = await makeApiRequest<AuthChallenge>(
            'POST',
            API_ENDPOINTS.AUTH.VERIFY,
            { walletAddress },
            {
                retry: true,
                timeout: 10000,
            }
        );

        if (!response.success || !response.data) {
            throw new Error(response.error?.message || 'Failed to get auth challenge');
        }

        // Store challenge nonce in session storage for verification
        sessionStorage.setItem('authNonce', response.data.nonce);
        sessionStorage.setItem('challengeExpiresAt', response.data.expiresAt.toString());

        return response.data;
    } catch (error) {
        console.error('Auth challenge request failed:', error);
        throw error;
    }
};

/**
 * Verifies wallet signature and obtains authentication tokens
 * @param walletAddress - Solana wallet address
 * @param signedChallenge - Challenge signed by wallet
 * @param nonce - Challenge nonce for verification
 * @returns Authentication tokens
 */
export const verifyWalletSignature = async (
    walletAddress: string,
    signedChallenge: string,
    nonce: string
): Promise<AuthTokens> => {
    try {
        // Verify nonce matches stored challenge
        const storedNonce = sessionStorage.getItem('authNonce');
        const expiresAt = parseInt(sessionStorage.getItem('challengeExpiresAt') || '0', 10);

        if (!storedNonce || storedNonce !== nonce || Date.now() > expiresAt) {
            throw new Error('Invalid or expired challenge');
        }

        const response = await makeApiRequest<AuthTokens>(
            'POST',
            API_ENDPOINTS.AUTH.VERIFY,
            {
                walletAddress,
                signedChallenge,
                nonce,
            },
            {
                retry: true,
                timeout: 10000,
            }
        );

        if (!response.success || !response.data) {
            throw new Error(response.error?.message || 'Signature verification failed');
        }

        // Store authentication tokens securely
        await setAuthToken(response.data.token);
        sessionStorage.setItem('refreshToken', response.data.refreshToken);

        // Clear challenge data
        sessionStorage.removeItem('authNonce');
        sessionStorage.removeItem('challengeExpiresAt');

        // Setup token refresh
        setupTokenRefresh(response.data.expiresIn);

        return response.data;
    } catch (error) {
        console.error('Signature verification failed:', error);
        throw error;
    }
};

/**
 * Refreshes authentication token before expiration
 * @param refreshToken - Current refresh token
 * @returns New authentication tokens
 */
export const refreshAuthToken = async (refreshToken: string): Promise<AuthTokens> => {
    try {
        const response = await makeApiRequest<AuthTokens>(
            'POST',
            API_ENDPOINTS.AUTH.REFRESH,
            { refreshToken },
            {
                retry: true,
                timeout: 10000,
            }
        );

        if (!response.success || !response.data) {
            throw new Error(response.error?.message || 'Token refresh failed');
        }

        // Update stored tokens
        await setAuthToken(response.data.token);
        sessionStorage.setItem('refreshToken', response.data.refreshToken);

        // Reset refresh timer
        setupTokenRefresh(response.data.expiresIn);

        return response.data;
    } catch (error) {
        console.error('Token refresh failed:', error);
        // Force logout on refresh failure
        await logout();
        throw error;
    }
};

/**
 * Sets up automatic token refresh before expiration
 * @param expiresIn - Token expiration time in seconds
 */
const setupTokenRefresh = (expiresIn: number): void => {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    const refreshTime = (expiresIn * 1000) - TOKEN_REFRESH_BUFFER;
    refreshTimer = setTimeout(async () => {
        try {
            const refreshToken = sessionStorage.getItem('refreshToken');
            if (refreshToken) {
                await refreshAuthToken(refreshToken);
            }
        } catch (error) {
            console.error('Automatic token refresh failed:', error);
            await logout();
        }
    }, refreshTime);
};

/**
 * Logs out user and cleans up authentication state
 */
export const logout = async (): Promise<void> => {
    try {
        const refreshToken = sessionStorage.getItem('refreshToken');
        if (refreshToken) {
            await makeApiRequest(
                'POST',
                API_ENDPOINTS.AUTH.LOGOUT,
                { refreshToken },
                { retry: false }
            );
        }
    } catch (error) {
        console.error('Logout request failed:', error);
    } finally {
        // Clean up authentication state
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        await clearAuthToken();
        sessionStorage.removeItem('refreshToken');
        sessionStorage.removeItem('authNonce');
        sessionStorage.removeItem('challengeExpiresAt');
    }
};

/**
 * Checks if user is currently authenticated
 * @returns Authentication status
 */
export const isAuthenticated = (): boolean => {
    try {
        const token = sessionStorage.getItem('token');
        const refreshToken = sessionStorage.getItem('refreshToken');
        return !!(token && refreshToken);
    } catch (error) {
        console.error('Auth status check failed:', error);
        return false;
    }
};