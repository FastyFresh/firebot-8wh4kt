import CryptoJS from 'crypto-js'; // v4.1.1
import { ApiError } from '../types/api';

// Global constants for storage management
const STORAGE_PREFIX = 'solana_trading_bot_';
const ENCRYPTION_KEY = process.env.REACT_APP_STORAGE_ENCRYPTION_KEY;
const STORAGE_VERSION = '1.0';

// Interface for versioned storage data
interface VersionedData<T> {
    version: string;
    data: T;
    timestamp: number;
}

/**
 * Secure storage service for managing local data persistence
 * Implements AES-256 encryption for sensitive trading data
 */
class StorageService {
    /**
     * Stores data in local storage with optional encryption
     * @param key - Storage key
     * @param value - Data to store
     * @param encrypt - Whether to encrypt the data
     * @throws ApiError if storage fails
     */
    public static setItem<T>(key: string, value: T, encrypt: boolean = false): void {
        try {
            if (!key) {
                throw new Error('Storage key is required');
            }

            const prefixedKey = STORAGE_PREFIX + key;
            const versionedData: VersionedData<T> = {
                version: STORAGE_VERSION,
                data: value,
                timestamp: Date.now()
            };

            let storageValue = JSON.stringify(versionedData);

            if (encrypt) {
                storageValue = this.encryptData(storageValue);
            }

            localStorage.setItem(prefixedKey, storageValue);
        } catch (error) {
            if (error instanceof Error) {
                throw {
                    code: 500,
                    message: `Failed to store data: ${error.message}`
                } as ApiError;
            }
            throw error;
        }
    }

    /**
     * Retrieves and optionally decrypts data from local storage
     * @param key - Storage key
     * @param encrypted - Whether the data is encrypted
     * @returns Retrieved value or null if not found
     * @throws ApiError if retrieval fails
     */
    public static getItem<T>(key: string, encrypted: boolean = false): T | null {
        try {
            if (!key) {
                throw new Error('Storage key is required');
            }

            const prefixedKey = STORAGE_PREFIX + key;
            let storedValue = localStorage.getItem(prefixedKey);

            if (!storedValue) {
                return null;
            }

            if (encrypted) {
                storedValue = this.decryptData(storedValue);
            }

            const versionedData = JSON.parse(storedValue) as VersionedData<T>;

            // Version check for data compatibility
            if (versionedData.version !== STORAGE_VERSION) {
                console.warn(`Storage version mismatch. Expected ${STORAGE_VERSION}, got ${versionedData.version}`);
            }

            return versionedData.data;
        } catch (error) {
            if (error instanceof Error) {
                throw {
                    code: 500,
                    message: `Failed to retrieve data: ${error.message}`
                } as ApiError;
            }
            throw error;
        }
    }

    /**
     * Removes an item from local storage
     * @param key - Storage key
     * @throws ApiError if removal fails
     */
    public static removeItem(key: string): void {
        try {
            if (!key) {
                throw new Error('Storage key is required');
            }

            const prefixedKey = STORAGE_PREFIX + key;
            localStorage.removeItem(prefixedKey);
        } catch (error) {
            if (error instanceof Error) {
                throw {
                    code: 500,
                    message: `Failed to remove data: ${error.message}`
                } as ApiError;
            }
            throw error;
        }
    }

    /**
     * Clears all trading bot related items from local storage
     * @throws ApiError if clearing fails
     */
    public static clear(): void {
        try {
            const keys = Object.keys(localStorage);
            const tradingBotKeys = keys.filter(key => key.startsWith(STORAGE_PREFIX));

            tradingBotKeys.forEach(key => {
                localStorage.removeItem(key);
            });
        } catch (error) {
            if (error instanceof Error) {
                throw {
                    code: 500,
                    message: `Failed to clear storage: ${error.message}`
                } as ApiError;
            }
            throw error;
        }
    }

    /**
     * Encrypts data using AES-256 encryption
     * @param data - Data to encrypt
     * @returns Encrypted data string
     * @throws Error if encryption fails
     */
    private static encryptData(data: string | object): string {
        if (!ENCRYPTION_KEY) {
            throw new Error('Encryption key is not configured');
        }

        const dataString = typeof data === 'string' ? data : JSON.stringify(data);
        
        // Generate random IV for enhanced security
        const iv = CryptoJS.lib.WordArray.random(16);
        
        // Perform AES encryption
        const encrypted = CryptoJS.AES.encrypt(dataString, ENCRYPTION_KEY, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });

        // Combine IV and encrypted data
        const combined = iv.concat(encrypted.ciphertext);
        
        return combined.toString(CryptoJS.enc.Base64);
    }

    /**
     * Decrypts AES-256 encrypted data
     * @param encryptedData - Encrypted data string
     * @returns Decrypted data string
     * @throws Error if decryption fails
     */
    private static decryptData(encryptedData: string): string {
        if (!ENCRYPTION_KEY) {
            throw new Error('Encryption key is not configured');
        }

        // Decode base64 string
        const combined = CryptoJS.enc.Base64.parse(encryptedData);
        
        // Extract IV and encrypted data
        const iv = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4));
        const ciphertext = CryptoJS.lib.WordArray.create(combined.words.slice(4));

        // Perform AES decryption
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: ciphertext },
            ENCRYPTION_KEY,
            {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            }
        );

        return decrypted.toString(CryptoJS.enc.Utf8);
    }
}

export { StorageService };