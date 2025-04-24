import { ValidationResult } from './types';

export class LicenseAgentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LicenseAgentError';

        if (typeof Object.setPrototypeOf === 'function') {
            Object.setPrototypeOf(this, new.target.prototype);
        } else {
            (this as any).__proto__ = new.target.prototype;
        }
    }
}

export class NetworkError extends LicenseAgentError {
    originalError?: Error;
    constructor(message: string = 'Network error occurred', originalError?: Error) {
        super(message);
        this.name = 'NetworkError';
        this.originalError = originalError;
    }
}

export class InvalidConfigError extends LicenseAgentError {
    constructor(message: string = 'Invalid agent configuration') {
        super(message);
        this.name = 'InvalidConfigError';
    }
}

export class ValidationError extends LicenseAgentError {
    public reason?: string | null;
    public status?: string | null;
    public expiresAt?: Date | null;
    public allowedData?: any | null;

    constructor(message: string, result: Omit<ValidationResult, 'isValid' | 'error'>) {
        super(message);
        this.name = 'ValidationError';
        this.reason = result.reason;
        this.status = result.status;
        this.expiresAt = result.expiresAt;
        this.allowedData = result.allowedData;
    }
}
