// @testing-library/react-hooks v8.0.1 - Testing React hooks
import { renderHook, act } from '@testing-library/react-hooks';
// jest v29.0.0 - Testing framework
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

// Internal imports
import { useAuth } from '../../src/hooks/useAuth';
import { requestAuthChallenge, verifyWalletSignature } from '../../src/services/auth';
import { ConnectionStatus } from '../../src/hooks/useAuth';

// Mock the auth service functions
jest.mock('../../src/services/auth', () => ({
    requestAuthChallenge: jest.fn(),
    verifyWalletSignature: jest.fn(),
    logout: jest.fn(),
    isAuthenticated: jest.fn()
}));

// Mock window.solana for Phantom provider
const mockPhantomProvider = {
    isPhantom: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    signMessage: jest.fn(),
    on: jest.fn(),
    removeAllListeners: jest.fn(),
    isConnected: false,
    publicKey: null
};

describe('useAuth Hook', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        
        // Clear storage
        window.sessionStorage.clear();
        window.localStorage.clear();
        
        // Setup Phantom provider mock
        (window as any).solana = mockPhantomProvider;
        
        // Reset provider state
        mockPhantomProvider.isConnected = false;
        mockPhantomProvider.publicKey = null;
        
        // Mock auth service default responses
        (requestAuthChallenge as jest.Mock).mockResolvedValue({
            challenge: 'test-challenge',
            nonce: 'test-nonce',
            expiresAt: Date.now() + 300000 // 5 minutes
        });
        
        (verifyWalletSignature as jest.Mock).mockResolvedValue({
            token: 'test-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 3600
        });
    });

    afterEach(() => {
        // Cleanup event listeners
        mockPhantomProvider.removeAllListeners.mockClear();
    });

    it('should initialize with correct default state', () => {
        const { result } = renderHook(() => useAuth());

        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.walletAddress).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
    });

    it('should handle successful wallet connection and authentication', async () => {
        // Setup successful connection response
        const mockPublicKey = 'test-wallet-address';
        mockPhantomProvider.connect.mockResolvedValue({ publicKey: mockPublicKey });
        mockPhantomProvider.signMessage.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.connect();
        });

        expect(result.current.walletAddress).toBe(mockPublicKey);
        expect(result.current.connectionStatus).toBe(ConnectionStatus.CONNECTED);
        expect(result.current.error).toBeNull();
        expect(requestAuthChallenge).toHaveBeenCalledWith(mockPublicKey);
        expect(verifyWalletSignature).toHaveBeenCalled();
    });

    it('should handle wallet connection timeout', async () => {
        // Simulate connection timeout
        mockPhantomProvider.connect.mockImplementation(() => 
            new Promise(resolve => setTimeout(resolve, 31000))
        );

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.connect();
        });

        expect(result.current.error).toMatchObject({
            code: 401,
            message: 'Connection timeout'
        });
        expect(result.current.connectionStatus).toBe(ConnectionStatus.ERROR);
    });

    it('should handle missing Phantom wallet', async () => {
        // Remove Phantom provider
        delete (window as any).solana;

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.connect();
        });

        expect(result.current.error).toMatchObject({
            code: 401,
            message: 'Phantom wallet not installed'
        });
    });

    it('should handle signature verification failure', async () => {
        mockPhantomProvider.connect.mockResolvedValue({ publicKey: 'test-address' });
        verifyWalletSignature.mockRejectedValue(new Error('Invalid signature'));

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.connect();
        });

        expect(result.current.error).toMatchObject({
            code: 401,
            message: 'Invalid signature'
        });
        expect(result.current.connectionStatus).toBe(ConnectionStatus.ERROR);
    });

    it('should handle successful disconnection', async () => {
        // Setup initial connected state
        mockPhantomProvider.isConnected = true;
        mockPhantomProvider.publicKey = { toString: () => 'test-address' };

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.disconnect();
        });

        expect(result.current.walletAddress).toBeNull();
        expect(result.current.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
        expect(mockPhantomProvider.disconnect).toHaveBeenCalled();
    });

    it('should monitor suspicious wallet disconnections', async () => {
        // Setup initial connected state
        mockPhantomProvider.isConnected = true;
        mockPhantomProvider.publicKey = { toString: () => 'test-address' };

        jest.useFakeTimers();
        const { result } = renderHook(() => useAuth());

        // Simulate unexpected wallet disconnection
        mockPhantomProvider.isConnected = false;

        await act(async () => {
            jest.advanceTimersByTime(5000);
        });

        expect(result.current.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
        jest.useRealTimers();
    });

    it('should handle wallet events correctly', () => {
        const { result } = renderHook(() => useAuth());

        // Simulate wallet connection event
        const connectHandler = mockPhantomProvider.on.mock.calls.find(
            call => call[0] === 'connect'
        )[1];
        
        act(() => {
            connectHandler();
        });

        expect(result.current.connectionStatus).toBe(ConnectionStatus.CONNECTED);
        expect(result.current.error).toBeNull();

        // Simulate wallet disconnection event
        const disconnectHandler = mockPhantomProvider.on.mock.calls.find(
            call => call[0] === 'disconnect'
        )[1];
        
        act(() => {
            disconnectHandler();
        });

        expect(result.current.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
        expect(result.current.walletAddress).toBeNull();
    });
});