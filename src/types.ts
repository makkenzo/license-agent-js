export interface LicenseAgentConfig {
    serverUrl: string;
    apiKey: string;
    licenseKey: string;
    productName: string;
    cacheTTL?: number;
    gracePeriod?: number;
    requestTimeout?: number;

    staticMetadata?: Record<string, unknown>;
}

export interface ValidationRequestPayload {
    metadata?: Record<string, unknown> | null;
}

export interface ValidationApiResponse {
    is_valid: boolean;
    status?: string | null;
    reason?: string | null;
    expires_at?: string | null;
    allowed_data?: any | null;
}

export interface ValidationResult {
    isValid: boolean;
    isOffline?: boolean;
    isGracePeriod?: boolean;
    reason?: string | null;
    status?: string | null;
    expiresAt?: Date | null;
    allowedData?: any | null;
    error?: Error | null;
    lastCheckedAt?: Date | null;
}

export interface CacheEntry {
    result: ValidationResult;
    timestamp: number;
}
