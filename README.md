```js
import { LicenseAgent, ValidationResult, ValidationError } from '@your-org/license-agent';

const agent = new LicenseAgent({
    serverUrl: 'http://your-license-server.com/api/v1',
    apiKey: 'lm_yourprefix_yoursecret',
    productName: 'YourAwesomeApp',
    cacheTTL: 10 * 60 * 1000, // 10 минут
    gracePeriod: 2 * 60 * 60 * 1000, // 2 часа
});

// Простая проверка
async function checkLicense() {
    try {
        const result: ValidationResult = await agent.validate();
        console.log('Validation Result:', result);
        if (result.isValid) {
            console.log('License is valid!');
            // Разрешить работу приложения, использовать result.allowedData
        } else {
            console.warn('License is invalid:', result.reason);
            // Ограничить функционал или заблокировать приложение
        }
    } catch (error) {
        // Обработка ошибок самого агента (не результат валидации)
        console.error('License Agent error:', error);
    }
}

// Проверка с выбросом исключения
async function checkLicenseStrict() {
    try {
        await agent.checkOrThrow();
        console.log('License check passed!');
        // Продолжить работу
    } catch (error) {
        if (error instanceof ValidationError) {
            console.error(`License validation failed: ${error.message} (Reason: ${error.reason})`);
            // Блокировать приложение
        } else if (error instanceof NetworkError) {
            console.error(`Network error during license check: ${error.message}. Trying to operate offline...`);
            // Возможно, показать уведомление пользователю, но не блокировать сразу
        } else {
            console.error('Unexpected error during license check:', error);
        }
    }
}

checkLicense();
// ИЛИ
// checkLicenseStrict();

// Периодическая проверка (пример)
// setInterval(checkLicense, agent.config.cacheTTL / 2); // Проверять чаще, чем TTL кэша
```
