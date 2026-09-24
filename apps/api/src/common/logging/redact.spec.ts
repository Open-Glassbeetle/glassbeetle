import { REDACTED_TEXT, redactSensitiveData } from './redact.js';

describe('redactSensitiveData', () => {
  it('leaves non-sensitive fields unchanged', () => {
    const input = {
      name: 'Claude Sonnet',
      model: 'claude-3-5',
      temperature: 0.7,
    };
    const result = redactSensitiveData(input);
    expect(result).toEqual(input);
  });

  it('redacts credential-shaped fields from a flat object', () => {
    const input = {
      name: 'OpenAI Provider',
      apiKey: 'sk-1234567890abcdef',
      api_key: 'sk-alt',
      password: 'my-super-secret-password',
      token: 'bearer-token-123',
      secret: 'shhh',
      authorization: 'Bearer secret-val',
      encrypted_value: 'enc-blob',
      nonce: 'nonce-bytes',
    };

    const result = redactSensitiveData(input);

    expect(result.name).toBe('OpenAI Provider');
    expect(result.apiKey).toBe(REDACTED_TEXT);
    expect(result.api_key).toBe(REDACTED_TEXT);
    expect(result.password).toBe(REDACTED_TEXT);
    expect(result.token).toBe(REDACTED_TEXT);
    expect(result.secret).toBe(REDACTED_TEXT);
    expect(result.authorization).toBe(REDACTED_TEXT);
    expect(result.encrypted_value).toBe(REDACTED_TEXT);
    expect(result.nonce).toBe(REDACTED_TEXT);
  });

  it('redacts sensitive fields in nested objects and arrays', () => {
    const input = {
      provider: 'anthropic',
      credentials: {
        apiKey: 'sk-ant-123',
        nonce: Buffer.from('nonce'),
      },
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer token-secret' },
      ],
    };

    const result = redactSensitiveData(input);

    expect(result.credentials).toBe(REDACTED_TEXT);
    expect(result.headers[1].value).toBe(`Bearer ${REDACTED_TEXT}`);
  });

  it('redacts raw Bearer token strings', () => {
    expect(redactSensitiveData('Bearer secret-token-value')).toBe(
      `Bearer ${REDACTED_TEXT}`,
    );
  });

  it('does not mutate the original object', () => {
    const input = { apiKey: 'original-secret', name: 'Test' };
    const result = redactSensitiveData(input);

    expect(input.apiKey).toBe('original-secret');
    expect(result.apiKey).toBe(REDACTED_TEXT);
  });
});
