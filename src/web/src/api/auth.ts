// @solana/web3.js v1.73.0 - Phantom wallet integration
import { PhantomProvider } from '@solana/web3.js';
import { ApiResponse } from '../types/api';
import { makeApiRequest } from '../utils/api';
import { API_ENDPOINTS, ERROR_CODES } from '../constants/api';

// Constants for authentication
const CHALLENGE_EXPIRY = 5 * 60 * 1000; // 5 minutes in milliseconds
const TOKEN_STORAGE_KEY = 'auth_token';
const REFRESH_TOKEN_STORAGE_KEY = 'refresh_token';
const WALLET_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Interface for challenge response from the server
 */
interface ChallengeResponse {
    challenge: string;
    expiresAt: number;
    nonce: string;
}

/**
 * Interface for authentication tokens
 */
interface AuthTokens {
    token: string;
    refreshToken: string;
    expiresIn: number;
}

/**
 * Requests an authentication challenge for the provided wallet address
 * @param walletAddress - Solana wallet address
 */
export const requestChallenge = async (
    walletAddress: string
): Promise<ApiResponse<ChallengeResponse>> => {
    // Validate wallet address format
    if (!WALLET_ADDRESS_REGEX.test(walletAddress)) {
        return {
            success: false,
            data: null,
            error: {
                code: ERROR_CODES.VALIDATION_ERROR,
                message: 'Invalid wallet address format',
                details: { walletAddress },
                retryAfter: null
            },
            timestamp: new Date(),
            version: 'v1',
            rateLimit: {
                limit: 0,
                remaining: 0,
                reset: new Date()
            }
        };
    }

    return makeApiRequest<ChallengeResponse>(
        'POST',
        API_ENDPOINTS.AUTH.LOGIN,
        { walletAddress },
        {
            retry: true,
            timeout: 10000
        }
    );
};

/**
 * Verifies the signed challenge with the server
 * @param walletAddress - Solana wallet address
 * @param signedChallenge - Challenge message signed by the wallet
 * @param nonce - Security nonce from the challenge request
 */
export const verifySignature = async (
    walletAddress: string,
    signedChallenge: string,
    nonce: string
): Promise<ApiResponse<AuthTokens>> => {
    // Validate inputs
    if (!walletAddress || !signedChallenge || !nonce) {
        return {
            success: false,
            data: null,
            error: {
                code: ERROR_CODES.VALIDATION_ERROR,
                message: 'Missing required parameters',
                details: { walletAddress, signedChallenge, nonce },
                retryAfter: null
            },
            timestamp: new Date(),
            version: 'v1',
            rateLimit: {
                limit: 0,
                remaining: 0,
                reset: new Date()
            }
        };
    }

    const response = await makeApiRequest<AuthTokens>(
        'POST',
        API_ENDPOINTS.AUTH.VERIFY,
        {
            walletAddress,
            signedChallenge,
            nonce
        },
        {
            retry: true,
            timeout: 10000
        }
    );

    if (response.success && response.data) {
        // Store tokens securely
        localStorage.setItem(TOKEN_STORAGE_KEY, response.data.token);
        localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, response.data.refreshToken);
    }

    return response;
};

/**
 * Refreshes the authentication token using the refresh token
 */
export const refreshToken = async (): Promise<ApiResponse<{ token: string; expiresIn: number }>> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);

    if (!refreshToken) {
        return {
            success: false,
            data: null,
            error: {
                code: ERROR_CODES.AUTHENTICATION_ERROR,
                message: 'No refresh token available',
                details: {},
                retryAfter: null
            },
            timestamp: new Date(),
            version: 'v1',
            rateLimit: {
                limit: 0,
                remaining: 0,
                reset: new Date()
            }
        };
    }

    const response = await makeApiRequest<{ token: string; expiresIn: number }>(
        'POST',
        API_ENDPOINTS.AUTH.REFRESH,
        { refreshToken },
        {
            retry: true,
            timeout: 10000
        }
    );

    if (response.success && response.data) {
        localStorage.setItem(TOKEN_STORAGE_KEY, response.data.token);
    }

    return response;
};

/**
 * Logs out the user and cleans up authentication state
 */
export const logout = async (): Promise<ApiResponse<void>> => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);

    // Attempt to notify backend even if token is missing
    const response = await makeApiRequest<void>(
        'POST',
        API_ENDPOINTS.AUTH.LOGOUT,
        {},
        {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            retry: false,
            timeout: 5000
        }
    );

    // Clean up local storage regardless of server response
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);

    return response;
};

/**
 * Utility function to check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
    return !!localStorage.getItem(TOKEN_STORAGE_KEY);
};

/**
 * Utility function to get the current authentication token
 */
export const getAuthToken = (): string | null => {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
};