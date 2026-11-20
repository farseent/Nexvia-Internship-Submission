import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PRESENCE_COLORS,
  apiEnvSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  parseEnv,
  registerRequestSchema,
  sessionCookieName,
  sessionIdParamsSchema,
  updateProfileRequestSchema,
  userResponseSchema,
} from './index.js';

const valid = { email: 'ada@example.com', password: 'twelve chars!', displayName: 'Ada' };

describe('registerRequestSchema', () => {
  it('normalizes email (trim, lower-case) and display name (trim)', () => {
    const parsed = registerRequestSchema.parse({
      ...valid,
      email: '  Ada@Example.COM ',
      displayName: '  Ada L.  ',
    });
    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.displayName).toBe('Ada L.');
  });

  it('keeps the password exactly as typed (no trimming)', () => {
    const parsed = registerRequestSchema.parse({ ...valid, password: '  spaces around me  ' });
    expect(parsed.password).toBe('  spaces around me  ');
  });

  it('enforces the password length bounds', () => {
    expect(
      registerRequestSchema.safeParse({ ...valid, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) })
        .success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ ...valid, password: 'x'.repeat(PASSWORD_MIN_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      registerRequestSchema.safeParse({ ...valid, password: 'x'.repeat(PASSWORD_MAX_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      registerRequestSchema.safeParse({ ...valid, password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it.each(['plain', 'a@b', '@example.com', 'a b@example.com', ''])('rejects email %j', (email) => {
    expect(registerRequestSchema.safeParse({ ...valid, email }).success).toBe(false);
  });

  it('rejects unknown and missing fields', () => {
    expect(registerRequestSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ email: valid.email }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('does not apply the password policy to an existing password', () => {
    expect(loginRequestSchema.safeParse({ email: valid.email, password: 'old' }).success).toBe(
      true,
    );
    expect(loginRequestSchema.safeParse({ email: valid.email, password: '' }).success).toBe(false);
  });
});

describe('changePasswordRequestSchema', () => {
  it('requires both fields and applies the policy to the new password', () => {
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'x',
        newPassword: 'a long enough one',
      }).success,
    ).toBe(true);
  });
});

describe('updateProfileRequestSchema', () => {
  it('requires at least one field', () => {
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ displayName: 'A' }).success).toBe(true);
  });

  it('upper-cases a valid colour and rejects others', () => {
    expect(updateProfileRequestSchema.parse({ presenceColor: '#aabbcc' }).presenceColor).toBe(
      '#AABBCC',
    );
    for (const color of ['aabbcc', '#abc', '#gggggg', 'red']) {
      expect(updateProfileRequestSchema.safeParse({ presenceColor: color }).success).toBe(false);
    }
  });

  it('rejects fields the user may not change', () => {
    for (const field of ['email', 'passwordHash', 'id', 'avatarAssetId']) {
      expect(updateProfileRequestSchema.safeParse({ displayName: 'A', [field]: 'x' }).success).toBe(
        false,
      );
    }
  });
});

describe('response schemas', () => {
  it('strips unknown keys, so a password hash cannot be serialized through a user', () => {
    const parsed = userResponseSchema.parse({
      success: true,
      data: {
        user: {
          id: '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11',
          email: 'a@b.co',
          displayName: 'A',
          presenceColor: '#112233',
          avatarUrl: null,
          createdAt: '2026-11-13T00:00:00.000Z',
          passwordHash: '$argon2id$secret',
        },
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('argon2');
  });
});

describe('misc', () => {
  it('validates session id params', () => {
    expect(sessionIdParamsSchema.safeParse({ sessionId: 'nope' }).success).toBe(false);
  });

  it('palette entries are valid #RRGGBB values', () => {
    for (const color of PRESENCE_COLORS) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('uses the __Host- cookie name only in production', () => {
    expect(sessionCookieName('production')).toBe('__Host-conote_session');
    expect(sessionCookieName('development')).toBe('conote_session');
    expect(sessionCookieName('test')).toBe('conote_session');
  });
});

describe('API env: session settings', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    APP_URL: 'http://localhost:3000',
  };

  it('defaults to 7-day idle, 30-day absolute and no proxy trust', () => {
    const env = parseEnv('api', apiEnvSchema, base);
    expect(env.SESSION_IDLE_TTL_DAYS).toBe(7);
    expect(env.SESSION_ABSOLUTE_TTL_DAYS).toBe(30);
    expect(env.TRUST_PROXY).toEqual([]);
  });

  it('parses overrides and rejects invalid values', () => {
    const env = parseEnv('api', apiEnvSchema, {
      ...base,
      TRUST_PROXY: 'loopback, 10.0.0.0/8',
      SESSION_IDLE_TTL_DAYS: '3',
    });
    expect(env.TRUST_PROXY).toEqual(['loopback', '10.0.0.0/8']);
    expect(env.SESSION_IDLE_TTL_DAYS).toBe(3);
    expect(() => parseEnv('api', apiEnvSchema, { ...base, TRUST_PROXY: 'yes' })).toThrow(
      /TRUST_PROXY/,
    );
    expect(() => parseEnv('api', apiEnvSchema, { ...base, SESSION_IDLE_TTL_DAYS: '0' })).toThrow(
      /SESSION_IDLE_TTL_DAYS/,
    );
  });
});
