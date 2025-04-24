import axios from 'axios';
import { LicenseAgent, LicenseAgentConfig, ValidationError, NetworkError, InvalidConfigError } from '../src/index';
import type { ValidationApiResponse } from '../src/types';

jest.mock('axios');

const mockedAxiosInstance = {
    post: jest.fn(),
};
const mockedAxios = axios as jest.Mocked<typeof axios>;

mockedAxios.create.mockReturnValue(mockedAxiosInstance as any);

const BASE_CONFIG: LicenseAgentConfig = {
    serverUrl: 'http:localhost:8080',
    apiKey: 'prod_testprefix_testsecret',
    productName: 'TestProduct',
    cacheTTL: 1000,
    gracePeriod: 5000,
    requestTimeout: 500,
};

const VALID_RESPONSE: ValidationApiResponse = {
    is_valid: true,
    reason: 'valid',
    status: 'active',
    expires_at: new Date(Date.now() + 100000).toISOString(),
    allowed_data: { features: ['all'] },
};

const INVALID_RESPONSE_EXPIRED: ValidationApiResponse = {
    is_valid: false,
    reason: 'expired',
    status: 'active',
    expires_at: new Date(Date.now() - 100000).toISOString(),
};

const INVALID_RESPONSE_REVOKED: ValidationApiResponse = {
    is_valid: false,
    reason: 'revoked',
    status: 'revoked',
};

const INVALID_RESPONSE_NOT_FOUND: ValidationApiResponse = {
    is_valid: false,
    reason: 'not_found',
};

describe('LicenseAgent', () => {
    let agent: LicenseAgent;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedAxios.create.mockReturnValue(mockedAxiosInstance as any);
        agent = new LicenseAgent(BASE_CONFIG);
        agent.clearCache();
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should throw InvalidConfigError if required config is missing', () => {
            expect(() => new LicenseAgent({ serverUrl: 'url', apiKey: '', productName: 'p' })).toThrow(
                InvalidConfigError
            );
            expect(() => new LicenseAgent({ serverUrl: '', apiKey: 'key', productName: 'p' })).toThrow(
                InvalidConfigError
            );
            expect(() => new LicenseAgent({ serverUrl: 'url', apiKey: 'key', productName: '' })).toThrow(
                InvalidConfigError
            );
        });

        it('should set default values for optional config', () => {
            const minimalConfig: LicenseAgentConfig = {
                serverUrl: 'url',
                apiKey: 'key',
                productName: 'p',
            };
            const defaultAgent = new LicenseAgent(minimalConfig);

            expect(defaultAgent.config.cacheTTL).toBeDefined();

            expect(defaultAgent.config.gracePeriod).toBeDefined();

            expect(defaultAgent.config.requestTimeout).toBeDefined();
        });
    });

    describe('validate()', () => {
        it('should return valid result on successful API response', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });

            const result = await agent.validate();

            expect(result.isValid).toBe(true);
            expect(result.reason).toBe('valid');
            expect(result.status).toBe('active');
            expect(result.expiresAt).toBeInstanceOf(Date);
            expect(result.allowedData).toEqual({ features: ['all'] });
            expect(result.isOffline).toBeUndefined();
            expect(result.isGracePeriod).toBeUndefined();
            expect(result.error).toBeUndefined();
            expect(result.lastCheckedAt).toBeInstanceOf(Date);
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);
            expect(mockedAxiosInstance.post).toHaveBeenCalledWith('/licenses/validate', {
                license_key: BASE_CONFIG.apiKey,
                product_name: BASE_CONFIG.productName,
            });
        });

        it('should return invalid result on specific API invalid response (revoked)', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: INVALID_RESPONSE_REVOKED });

            const result = await agent.validate();

            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('revoked');
            expect(result.status).toBe('revoked');
            expect(result.expiresAt).toBeNull();
            expect(result.allowedData).toBeUndefined();
            expect(result.lastCheckedAt).toBeInstanceOf(Date);
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);
        });

        it('should return invalid result on specific API invalid response (not_found)', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: INVALID_RESPONSE_NOT_FOUND });
            const result = await agent.validate();
            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('not_found');
            expect(result.lastCheckedAt).toBeInstanceOf(Date);
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);
        });

        it('should return offline result on network error when cache is empty', async () => {
            const networkError = new Error('Network Failure');
            mockedAxiosInstance.post.mockRejectedValue(networkError);

            const result = await agent.validate();

            expect(result.isValid).toBe(false);
            expect(result.isOffline).toBe(true);
            expect(result.reason).toBe('network_error_no_cache');
            expect(result.error).toBeInstanceOf(NetworkError);
            expect((result.error as any).originalError).toBe(networkError);
            expect(result.lastCheckedAt).toBeUndefined();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);
        });

        it('should use cache if result is fresh', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });

            await agent.validate();
            const result2 = await agent.validate();

            expect(result2.isValid).toBe(true);
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);
        });

        it('should not use cache if TTL expired', async () => {
            jest.useFakeTimers();
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });

            await agent.validate();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(BASE_CONFIG.cacheTTL! + 100);

            await agent.validate();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(2);
            jest.useRealTimers();
        });

        it('should enter grace period on network error if cache is valid but stale', async () => {
            jest.useFakeTimers();

            mockedAxiosInstance.post.mockResolvedValueOnce({ data: VALID_RESPONSE });
            await agent.validate();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(BASE_CONFIG.cacheTTL! + 100);

            const networkError = new Error('Connection refused');
            mockedAxiosInstance.post.mockRejectedValueOnce(networkError);

            const result = await agent.validate();

            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(2);
            expect(result.isValid).toBe(true);
            expect(result.isOffline).toBe(true);
            expect(result.isGracePeriod).toBe(true);
            expect(result.reason).toBe('grace_period');
            expect(result.error).toBeInstanceOf(NetworkError);
            expect(result.status).toBe(VALID_RESPONSE.status);
            expect(result.lastCheckedAt).toBeInstanceOf(Date);

            jest.useRealTimers();
        });

        it('should fail validation on network error if grace period expired', async () => {
            jest.useFakeTimers();

            mockedAxiosInstance.post.mockResolvedValueOnce({ data: VALID_RESPONSE });
            await agent.validate();

            jest.advanceTimersByTime(BASE_CONFIG.gracePeriod! + 100);

            const networkError = new Error('Timeout');
            mockedAxiosInstance.post.mockRejectedValueOnce(networkError);

            const result = await agent.validate();

            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(2);
            expect(result.isValid).toBe(false);
            expect(result.isOffline).toBe(true);
            expect(result.isGracePeriod).toBe(false);
            expect(result.reason).toBe(VALID_RESPONSE.reason);
            expect(result.error).toBeInstanceOf(NetworkError);

            jest.useRealTimers();
        });

        it('should pass static and dynamic metadata', async () => {
            const staticMeta = { deviceType: 'server' };
            const dynamicMeta = { userId: 'user123' };
            const agentWithMeta = new LicenseAgent({ ...BASE_CONFIG, staticMetadata: staticMeta });
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });

            await agentWithMeta.validate({ metadata: dynamicMeta });

            expect(mockedAxiosInstance.post).toHaveBeenCalledWith(
                '/licenses/validate',
                expect.objectContaining({
                    metadata: { ...staticMeta, ...dynamicMeta },
                })
            );
        });
    });

    describe('forceValidate()', () => {
        it('should bypass cache and call API', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });

            await agent.validate();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);

            const result = await agent.forceValidate();
            expect(result.isValid).toBe(true);
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(2);
        });
    });

    describe('checkOrThrow()', () => {
        it('should not throw if license is valid', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });
            await expect(agent.checkOrThrow()).resolves.toBeUndefined();
        });

        it('should throw ValidationError if license is invalid from API', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: INVALID_RESPONSE_REVOKED });
            await expect(agent.checkOrThrow()).rejects.toThrow(ValidationError);
            await expect(agent.checkOrThrow()).rejects.toMatchObject({
                name: 'ValidationError',
                reason: 'revoked',
                status: 'revoked',
            });
        });

        it('should throw NetworkError on network failure with no cache/grace', async () => {
            const networkError = new Error('Network Failure');
            mockedAxiosInstance.post.mockRejectedValue(networkError);
            await expect(agent.checkOrThrow()).rejects.toThrow(NetworkError);
            await expect(agent.checkOrThrow()).rejects.toMatchObject({
                name: 'NetworkError',
                originalError: networkError,
            });
        });

        it('should NOT throw during grace period', async () => {
            jest.useFakeTimers();
            mockedAxiosInstance.post.mockResolvedValueOnce({ data: VALID_RESPONSE });
            await agent.validate();
            jest.advanceTimersByTime(BASE_CONFIG.cacheTTL! + 100);
            mockedAxiosInstance.post.mockRejectedValueOnce(new Error('Network Failure'));

            await expect(agent.checkOrThrow()).resolves.toBeUndefined();

            jest.useRealTimers();
        });
    });

    describe('clearCache()', () => {
        it('should force API call after clearing cache', async () => {
            mockedAxiosInstance.post.mockResolvedValue({ data: VALID_RESPONSE });
            await agent.validate();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(1);

            agent.clearCache();

            await agent.validate();
            expect(mockedAxiosInstance.post).toHaveBeenCalledTimes(2);
        });
    });
});
