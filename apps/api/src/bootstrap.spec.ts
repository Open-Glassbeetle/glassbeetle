import { DEFAULT_CORS_ORIGINS } from './config/app.config.js';
import { buildCorsOptions } from './bootstrap.js';

function check(
  options: ReturnType<typeof buildCorsOptions>,
  origin: string | undefined,
) {
  const callback = vi.fn();
  options.origin(origin, callback);

  return {
    error: callback.mock.calls[0]?.[0],
    allowed: callback.mock.calls[0]?.[1],
  };
}

describe('buildCorsOptions', () => {
  const options = buildCorsOptions(DEFAULT_CORS_ORIGINS);

  it.each(DEFAULT_CORS_ORIGINS)('allows the desktop origin %s', (origin) => {
    expect(check(options, origin)).toEqual({ error: null, allowed: true });
  });

  it.each([
    'https://example.com',
    'http://evil.localhost',
    'http://localhost:4201',
    'null',
  ])('does not reflect the untrusted origin %s', (origin) => {
    // The API binds to loopback and has no authentication, so any page the user
    // visits could otherwise read their chats and agents from localhost.
    expect(check(options, origin)).toEqual({ error: null, allowed: false });
  });

  it('allows requests that carry no Origin header', () => {
    expect(check(options, undefined)).toEqual({ error: null, allowed: true });
  });

  it('rejects by omitting the header rather than by erroring', () => {
    // Throwing would turn a blocked cross-origin request into a confusing 500.
    expect(check(options, 'https://example.com').error).toBeNull();
  });

  it('honours a configured allowlist instead of the defaults', () => {
    const custom = buildCorsOptions(['http://localhost:9999']);

    expect(check(custom, 'http://localhost:9999').allowed).toBe(true);
    expect(check(custom, 'http://localhost:4200').allowed).toBe(false);
  });

  it('allows nothing when the allowlist is empty', () => {
    const locked = buildCorsOptions([]);

    expect(check(locked, 'http://localhost:4200').allowed).toBe(false);
  });

  it('does not enable credentials', () => {
    // No cookies or sessions exist; `credentials: true` alongside a permissive
    // origin is what makes a local API readable cross-origin.
    expect(options).not.toHaveProperty('credentials');
  });
});
