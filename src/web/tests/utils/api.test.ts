// jest v29.0.0 - Testing framework
import { jest } from '@jest/globals';
// axios v1.4.0 - HTTP client
import axios from 'axios';
// axios-mock-adapter v1.21.0 - Mocking Axios requests
import MockAdapter from 'axios-mock-adapter';
// mock-socket v9.2.1 - WebSocket mocking
import { WebSocket, Server } from 'mock-socket';

import { 
    handleApiError, 
    makeApiRequest, 
    buildQueryParams 
} from '../../src/utils/api';
import { 
    HttpStatusCode, 
    ApiResponse 
} from '../../src/types/api';
import { 
    ERROR_CODES, 
    ERROR_CATEGORIES, 
    API_ENDPOINTS 
} from '../../src/constants/api';

// Mock setup
const mockAxios = new MockAdapter(axios);
const mockWebSocket = new Server('wss://test.example.com');

describe('handleApiError', () => {
    const context = {
        endpoint: API_ENDPOINTS.TRADING.CREATE_ORDER,
        method: 'POST',
        startTime: Date.now(),
        retryCount: 0
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('handles AxiosError with response', () => {
        const axiosError = {
            response: {
                status: HttpStatusCode.TOO_MANY_REQUESTS,
                data: {
                    code: ERROR_CODES.RATE_LIMIT_ERROR,
                    message: 'Rate limit exceeded'
                },
                headers: {
                    'retry-after': '30'
                }
            },
            message: 'Request failed'
        };

        const result = handleApiError(axiosError as any, context);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
        expect(result.error?.retryAfter).toBe(30);
        expect(result.error?.details).toHaveProperty('endpoint');
        expect(result.error?.details).toHaveProperty('retryCount');
    });

    test('handles AxiosError without response', () => {
        const axiosError = {
            message: 'Network Error',
            code: ERROR_CODES.NETWORK_ERROR
        };

        const result = handleApiError(axiosError as any, context);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
        expect(result.error?.message).toBe('Network Error');
    });

    test('handles generic Error', () => {
        const error = new Error('Unknown error');
        const result = handleApiError(error, context);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
        expect(result.error?.message).toBe('Unknown error');
    });
});

describe('makeApiRequest', () => {
    const mockSuccessResponse: ApiResponse = {
        success: true,
        data: { test: 'data' },
        error: null,
        timestamp: new Date(),
        version: 'v1',
        rateLimit: {
            limit: 100,
            remaining: 99,
            reset: new Date()
        }
    };

    beforeEach(() => {
        mockAxios.reset();
        jest.clearAllMocks();
    });

    test('successful GET request with caching', async () => {
        mockAxios.onGet('/test').reply(200, mockSuccessResponse);

        const result = await makeApiRequest('GET', '/test', undefined, { cache: true });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ test: 'data' });
        expect(mockAxios.history.get.length).toBe(1);
    });

    test('handles circuit breaker open state', async () => {
        const result = await makeApiRequest('POST', '/test', { data: 'test' }, {
            circuitBreaker: true,
            timeout: 1000
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(HttpStatusCode.SERVICE_UNAVAILABLE);
    });

    test('handles retry mechanism', async () => {
        mockAxios
            .onPost('/test')
            .replyOnce(500)
            .onPost('/test')
            .reply(200, mockSuccessResponse);

        const result = await makeApiRequest('POST', '/test', { data: 'test' }, {
            retry: true,
            timeout: 1000
        });

        expect(result.success).toBe(true);
        expect(mockAxios.history.post.length).toBe(2);
    });

    test('respects rate limiting headers', async () => {
        mockAxios.onGet('/test').reply(429, {
            success: false,
            error: {
                code: ERROR_CODES.RATE_LIMIT_ERROR,
                message: 'Rate limit exceeded'
            }
        }, {
            'retry-after': '30'
        });

        const result = await makeApiRequest('GET', '/test');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
        expect(result.error?.retryAfter).toBe(30);
    });
});

describe('buildQueryParams', () => {
    test('handles empty parameters', () => {
        const params = {};
        const result = buildQueryParams(params);
        expect(result).toBe('');
    });

    test('handles single parameter', () => {
        const params = { key: 'value' };
        const result = buildQueryParams(params);
        expect(result).toBe('?key=value');
    });

    test('handles multiple parameters', () => {
        const params = {
            key1: 'value1',
            key2: 'value2'
        };
        const result = buildQueryParams(params);
        expect(result).toBe('?key1=value1&key2=value2');
    });

    test('handles array parameters', () => {
        const params = {
            ids: ['1', '2', '3']
        };
        const result = buildQueryParams(params);
        expect(result).toBe('?ids=1&ids=2&ids=3');
    });

    test('handles null and undefined values', () => {
        const params = {
            key1: null,
            key2: undefined,
            key3: 'value'
        };
        const result = buildQueryParams(params);
        expect(result).toBe('?key3=value');
    });

    test('handles special characters', () => {
        const params = {
            key: 'value with spaces',
            special: '!@#$%'
        };
        const result = buildQueryParams(params);
        expect(result).toBe('?key=value%20with%20spaces&special=%21%40%23%24%25');
    });
});