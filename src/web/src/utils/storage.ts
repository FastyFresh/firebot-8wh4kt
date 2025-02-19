/**
 * @fileoverview Secure, type-safe storage utility module for encrypted localStorage operations
 * @version 1.0.0
 * @package crypto-js@4.1.1
 */

import CryptoJS from 'crypto-js';

// Storage version for data structure compatibility
const STORAGE_VERSION = '1.0';

// Maximum storage size (5MB)
const MAX_STORAGE_SIZE = 5 * 1024 * 1024;

// Encryption key from environment variables
const ENCRYPTION_KEY = process.env.REACT_APP_STORAGE_ENCRYPTION_KEY;

// Storage event name for change notifications
const STORAGE_EVENT = 'app-storage-change';

/**
 * Enumeration of storage keys for type safety
 */
export enum STORAGE_KEYS {
  AUTH_TOKEN = 'auth_token',
  REFRESH_TOKEN = 'refresh_token',
  WALLET_ADDRESS = 'wallet_address',
  USER_PREFERENCES = 'user_preferences',
  TRADING_PAIRS = 'trading_pairs',
  STRATEGY_CONFIG = 'strategy_config'
}

/**
 * Storage item metadata interface
 */
interface StorageMetadata {
  version: string;
  timestamp: number;
  encrypted: boolean;
  compressed: boolean;
}

/**
 * Storage item wrapper interface
 */
interface StorageWrapper<T> {
  data: T;
  metadata: StorageMetadata;
}

/**
 * Encrypts data using AES-256-GCM
 * @param data - Data to encrypt
 * @returns Encrypted data string with IV and auth tag
 */
const encryptData = <T>(data: T): string => {
  if (!ENCRYPTION_KEY) {
    throw new Error('Encryption key not configured');
  }

  // Generate random IV
  const iv = CryptoJS.lib.WordArray.random(12);
  
  // Convert data to string if needed
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  
  // Encrypt using AES-GCM
  const encrypted = CryptoJS.AES.encrypt(dataStr, ENCRYPTION_KEY, {
    iv: iv,
    mode: CryptoJS.mode.GCM,
    padding: CryptoJS.pad.Pkcs7
  });

  // Combine IV and ciphertext
  const combined = iv.concat(encrypted.ciphertext);
  
  // Add auth tag
  const authTag = encrypted.getAuthTag();
  const final = combined.concat(authTag);
  
  return final.toString(CryptoJS.enc.Base64);
};

/**
 * Decrypts AES-256-GCM encrypted data
 * @param encryptedData - Encrypted data string
 * @returns Decrypted and parsed data
 */
const decryptData = <T>(encryptedData: string): T => {
  if (!ENCRYPTION_KEY) {
    throw new Error('Encryption key not configured');
  }

  // Decode from Base64
  const ciphertext = CryptoJS.enc.Base64.parse(encryptedData);
  
  // Extract IV (12 bytes), auth tag (16 bytes), and encrypted data
  const iv = CryptoJS.lib.WordArray.create(ciphertext.words.slice(0, 3));
  const authTag = CryptoJS.lib.WordArray.create(ciphertext.words.slice(ciphertext.words.length - 4));
  const encrypted = CryptoJS.lib.WordArray.create(ciphertext.words.slice(3, ciphertext.words.length - 4));
  
  // Decrypt
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encrypted, salt: undefined },
    ENCRYPTION_KEY,
    {
      iv: iv,
      mode: CryptoJS.mode.GCM,
      padding: CryptoJS.pad.Pkcs7,
      tag: authTag
    }
  );
  
  const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
  return JSON.parse(decryptedStr) as T;
};

/**
 * Stores data in localStorage with optional encryption
 * @param key - Storage key
 * @param value - Data to store
 * @param encrypt - Whether to encrypt the data
 */
export const setItem = async <T>(key: string, value: T, encrypt = false): Promise<void> => {
  try {
    // Validate inputs
    if (!key || value === undefined) {
      throw new Error('Invalid storage parameters');
    }

    // Create storage wrapper
    const wrapper: StorageWrapper<T> = {
      data: value,
      metadata: {
        version: STORAGE_VERSION,
        timestamp: Date.now(),
        encrypted: encrypt,
        compressed: false
      }
    };

    // Encrypt if requested
    let storageData = JSON.stringify(wrapper);
    if (encrypt) {
      storageData = encryptData(wrapper);
    }

    // Check storage size
    if (storageData.length > MAX_STORAGE_SIZE) {
      throw new Error('Storage quota exceeded');
    }

    // Store data
    localStorage.setItem(key, storageData);

    // Emit change event
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
      detail: { key, action: 'set' }
    }));
  } catch (error) {
    console.error('Storage set error:', error);
    throw error;
  }
};

/**
 * Retrieves data from localStorage with optional decryption
 * @param key - Storage key
 * @param decrypt - Whether to decrypt the data
 * @returns Retrieved data or null if not found
 */
export const getItem = async <T>(key: string, decrypt = false): Promise<T | null> => {
  try {
    const storageData = localStorage.getItem(key);
    if (!storageData) {
      return null;
    }

    let wrapper: StorageWrapper<T>;
    
    if (decrypt) {
      wrapper = decryptData<StorageWrapper<T>>(storageData);
    } else {
      wrapper = JSON.parse(storageData) as StorageWrapper<T>;
    }

    // Validate version
    if (wrapper.metadata.version !== STORAGE_VERSION) {
      console.warn(`Storage version mismatch: ${wrapper.metadata.version}`);
    }

    return wrapper.data;
  } catch (error) {
    console.error('Storage get error:', error);
    return null;
  }
};

/**
 * Removes an item from localStorage
 * @param key - Storage key
 */
export const removeItem = async (key: string): Promise<void> => {
  try {
    localStorage.removeItem(key);
    
    // Emit change event
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
      detail: { key, action: 'remove' }
    }));
  } catch (error) {
    console.error('Storage remove error:', error);
    throw error;
  }
};

/**
 * Clears all items from localStorage
 */
export const clear = async (): Promise<void> => {
  try {
    localStorage.clear();
    
    // Emit change event
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, {
      detail: { action: 'clear' }
    }));
  } catch (error) {
    console.error('Storage clear error:', error);
    throw error;
  }
};