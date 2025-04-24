import axios, { AxiosInstance } from 'axios';
import {
    LicenseAgentConfig,
    ValidationRequestPayload,
    ValidationApiResponse,
    ValidationResult,
    CacheEntry,
} from './types';
import { InvalidConfigError, NetworkError, ValidationError } from './errors';

const DEFAULT_CACHE_TTL = 60 * 60 * 1000;
const DEFAULT_GRACE_PERIOD = 24 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT = 10000;

interface ApiValidateRequest {
    license_key: string;
    product_name: string;
    metadata?: Record<string, unknown> | null;
}

export class LicenseAgent {
    public config: Required<Omit<LicenseAgentConfig, 'staticMetadata'>> & { staticMetadata?: Record<string, unknown> };
    private apiClient: AxiosInstance;
    private cache: CacheEntry | null = null;

    constructor(config: LicenseAgentConfig) {
        if (!config.serverUrl || !config.apiKey || !config.productName) {
            throw new InvalidConfigError('serverUrl, apiKey, and productName are required');
        }

        this.config = {
            ...config,
            cacheTTL: config.cacheTTL ?? DEFAULT_CACHE_TTL,
            gracePeriod: config.gracePeriod ?? DEFAULT_GRACE_PERIOD,
            requestTimeout: config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
        };

        this.apiClient = axios.create({
            baseURL: this.config.serverUrl,
            timeout: this.config.requestTimeout,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.config.apiKey,
            },
        });
    }

    /**
     * Validates the license against the server.
     * Returns the validation result, potentially using cache or grace period.
     * @param payload Optional dynamic metadata for this specific validation check.
     * @returns Promise<ValidationResult>
     */
    public async validate(payload?: ValidationRequestPayload): Promise<ValidationResult> {
        const now = Date.now();

        if (this.cache && now - this.cache.timestamp < this.config.cacheTTL) {
            const cachedResult = { ...this.cache.result };
            return cachedResult;
        }

        try {
            const requestData: ApiValidateRequest = {
                license_key: this.config.licenseKey,
                product_name: this.config.productName,
                metadata: { ...this.config.staticMetadata, ...payload?.metadata },
            };

            if (requestData.metadata && Object.keys(requestData.metadata).length === 0) {
                if (requestData.metadata) {
                    delete requestData.metadata;
                }
            }

            const response = await this.apiClient.post<ValidationApiResponse>('/licenses/validate', requestData);
            const apiResult = response.data;

            const expiresAt = apiResult.expires_at ? new Date(apiResult.expires_at) : null;

            const result: ValidationResult = {
                isValid: apiResult.is_valid,
                reason: apiResult.reason,
                status: apiResult.status,
                expiresAt: expiresAt,
                allowedData: apiResult.allowed_data,
                lastCheckedAt: new Date(),
            };

            this.updateCache(result);

            return result;
        } catch (error) {
            const networkError = new NetworkError('Failed to connect to license server', error as Error);

            if (this.cache) {
                const timeSinceLastCheck = now - this.cache.timestamp;
                const lastValidResult = this.cache.result;

                if (lastValidResult.isValid && timeSinceLastCheck < this.config.gracePeriod) {
                    return {
                        ...lastValidResult,
                        isValid: true,
                        isOffline: true,
                        isGracePeriod: true,
                        reason: 'grace_period',
                        error: networkError,
                    };
                } else {
                    return {
                        ...lastValidResult,
                        isValid: false,
                        isOffline: true,
                        isGracePeriod: false,
                        reason: lastValidResult.reason || 'offline_validation_failed',
                        error: networkError,
                    };
                }
            } else {
                return {
                    isValid: false,
                    isOffline: true,
                    reason: 'network_error_no_cache',
                    error: networkError,
                };
            }
        }
    }

    /**
     * Force validates the license against the server, bypassing the cache.
     * Useful for initial checks or manual refresh.
     * @param payload Optional dynamic metadata.
     * @returns Promise<ValidationResult>
     */
    public async forceValidate(payload?: ValidationRequestPayload): Promise<ValidationResult> {
        this.clearCache();
        return this.validate(payload);
    }

    /**
     * Checks the license validity and throws a ValidationError if invalid.
     * @param payload Optional dynamic metadata.
     * @throws {ValidationError} If the license is not valid (excluding network errors during grace period).
     * @throws {NetworkError} If a network error occurs and grace period is not active or cache is unavailable.
     * @throws {LicenseAgentError} For other agent errors.
     */
    public async checkOrThrow(payload?: ValidationRequestPayload): Promise<void> {
        const result = await this.validate(payload);

        if (!result.isValid) {
            if (result.isGracePeriod) {
                return;
            }

            if (result.error && result.error instanceof NetworkError) {
                throw result.error;
            }

            throw new ValidationError(result.reason || 'License validation failed', result);
        }
    }

    private updateCache(result: ValidationResult): void {
        if (!result.isOffline && !result.isGracePeriod) {
            this.cache = {
                result: { ...result, error: undefined },
                timestamp: Date.now(),
            };
        }
    }

    public clearCache(): void {
        this.cache = null;
    }
}

export * from './types';
export * from './errors';
