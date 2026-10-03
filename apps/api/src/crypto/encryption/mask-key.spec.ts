import { describe, expect, it } from 'vitest';
import { maskKey } from './mask-key.js';

describe('maskKey', () => {
  it('handles empty and falsy inputs gracefully', () => {
    expect(maskKey('')).toBe('');
    expect(maskKey(null)).toBe('');
    expect(maskKey(undefined)).toBe('');
  });

  it('never reveals more than the intended suffix, including for very short inputs', () => {
    // Lengths 1 to 4 should never reveal the secret character(s)
    expect(maskKey('a')).toBe('…');
    expect(maskKey('ab')).toBe('…');
    expect(maskKey('abc')).toBe('…');
    expect(maskKey('1234')).toBe('…');

    // For length 5 with default suffix 4, only the last 4 characters are revealed
    const masked5 = maskKey('12345');
    expect(masked5).toBe('…2345');
    expect(masked5.endsWith('2345')).toBe(true);
    expect(masked5).not.toContain('1');

    // For arbitrary length, revealed suffix is never longer than suffixLength
    for (const len of [1, 2, 3, 4, 5, 8, 12, 20]) {
      const secret = 'x'.repeat(len);
      const masked = maskKey(secret);
      const suffixOnly = masked.replace(/^[^\w]*/, '').replace(/…/, '');
      expect(suffixOnly.length).toBeLessThanOrEqual(4);
    }
  });

  it('preserves recognized provider prefixes when long enough', () => {
    expect(maskKey('sk-ant-api03-secretkey123454f2a')).toBe('sk-ant-…4f2a');
    expect(maskKey('sk-proj-testkey9876543214f2a')).toBe('sk-proj-…4f2a');
    expect(maskKey('sk-standardkey123456784f2a')).toBe('sk-…4f2a');
    expect(maskKey('gsk_groqsecretkey12345674f2a')).toBe('gsk_…4f2a');
    expect(maskKey('ghp_githubpersonaltoken14f2a')).toBe('ghp_…4f2a');
  });

  it('omits prefix if the string is too short to safely reveal both prefix and suffix', () => {
    // Prefix 'sk-ant-' is 7 chars. Suffix is 4 chars.
    // A string of 8 chars like 'sk-ant-1' would overlap or expose almost the entire secret.
    const shortPrefixKey = 'sk-ant-1';
    const result = maskKey(shortPrefixKey);
    // Should NOT show 'sk-ant-…'
    expect(result).toBe('…nt-1');
  });

  it('supports custom suffixLength and customPrefix', () => {
    expect(
      maskKey('custom-prefix-supersecretkey9999', {
        customPrefix: 'custom-prefix-',
        suffixLength: 4,
      }),
    ).toBe('custom-prefix-…9999');

    expect(
      maskKey('sk-ant-abcdefghijklmnop', {
        suffixLength: 6,
      }),
    ).toBe('sk-ant-…klmnop');

    // Very short input with custom suffix length
    expect(
      maskKey('123', {
        suffixLength: 3,
      }),
    ).toBe('…');
  });
});
