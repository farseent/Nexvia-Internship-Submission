import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_CODES,
  EnvValidationError,
  apiEnvSchema,
  collabEnvSchema,
  errorEnvelope,
  evaluateApiReadiness,
  evaluateCollabReadiness,
  isAcceptableRequestId,
  parseEnv,
  redactUrlCredentials,
  successEnvelope,
  webEnvSchema,
} from './index.js';

const validApi = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  APP_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('applies defaults and parses valid api env', () => {
    const env = parseEnv('api', apiEnvSchema, validApi);
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('parses a comma separated origin list', () => {
    const env = parseEnv('api', apiEnvSchema, {
      ...validApi,
      ALLOWED_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.ALLOWED_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('reports every invalid variable by name', () => {
    expect(() => parseEnv('api', apiEnvSchema, {})).toThrow(EnvValidationError);
    try {
      parseEnv('api', apiEnvSchema, {});
    } catch (err) {
      const names = (err as EnvValidationError).issues.map((i) => i.variable);
      expect(names).toEqual(
        expect.arrayContaining(['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'APP_URL']),
      );
    }
  });

  it('never includes secret values in the error message', () => {
    const secret = 'sup3r-s3cret-password';
    try {
      parseEnv('api', apiEnvSchema, {
        ...validApi,
        DATABASE_URL: `mysql://user:${secret}@host/db`,
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('DATABASE_URL');
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it('rejects wrong URL schemes and out-of-range ports', () => {
    expect(() =>
      parseEnv('api', apiEnvSchema, { ...validApi, REDIS_URL: 'http://localhost' }),
    ).toThrow(/REDIS_URL/);
    expect(() => parseEnv('api', apiEnvSchema, { ...validApi, PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseEnv('api', apiEnvSchema, { ...validApi, APP_URL: 'http://x.test/' })).toThrow(
      /APP_URL/,
    );
  });

  it('validates collab and web schemas', () => {
    const publicKey = { kty: 'OKP', crv: 'Ed25519', x: 'AAAA', kid: 'k1' };
    const collab = parseEnv('collab', collabEnvSchema, {
      NODE_ENV: 'production',
      DATABASE_URL: validApi.DATABASE_URL,
      REDIS_URL: validApi.REDIS_URL,
      APP_URL: 'http://localhost:3000',
      COLLAB_JWT_PUBLIC_KEYS: JSON.stringify([publicKey]),
    });
    expect(collab.COLLAB_PORT).toBe(4100);
    expect(collab.COLLAB_ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
    expect(collab.COLLAB_JWT_PUBLIC_KEYS).toEqual([publicKey]);
    expect(collab.COLLAB_STORE_DEBOUNCE_MS).toBe(2000);
    // The collaboration server never accepts private key material.
    expect(() =>
      parseEnv('collab', collabEnvSchema, {
        NODE_ENV: 'production',
        DATABASE_URL: validApi.DATABASE_URL,
        REDIS_URL: validApi.REDIS_URL,
        APP_URL: 'http://localhost:3000',
        COLLAB_JWT_PUBLIC_KEYS: JSON.stringify([{ ...publicKey, d: 'SECRET' }]),
      }),
    ).toThrow(/COLLAB_JWT_PUBLIC_KEYS/);
    expect(() => parseEnv('web', webEnvSchema, { NODE_ENV: 'test' })).toThrow(/API_INTERNAL_URL/);
  });
});

describe('collab cluster settings (Phase 9)', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: validApi.DATABASE_URL,
    REDIS_URL: validApi.REDIS_URL,
    APP_URL: 'http://localhost:3000',
    COLLAB_JWT_PUBLIC_KEYS: JSON.stringify([{ kty: 'OKP', crv: 'Ed25519', x: 'AAAA', kid: 'k1' }]),
  };

  it('defaults to cluster synchronization on, with documented intervals', () => {
    const env = parseEnv('collab', collabEnvSchema, base);
    expect(env.COLLAB_CLUSTER_ENABLED).toBe(true);
    expect(env.COLLAB_INSTANCE_ID).toBeUndefined();
    expect(env.COLLAB_REDIS_PREFIX).toBe('conote:collab');
    expect(env.COLLAB_CLUSTER_INITIAL_SYNC_TIMEOUT_MS).toBe(1000);
    expect(env.COLLAB_CLUSTER_RESYNC_INTERVAL_MS).toBe(30_000);
    expect(env.COLLAB_CLUSTER_STORE_REPLICATED).toBe(true);
    expect(env.COLLAB_CONNECTION_TIMEOUT_MS).toBe(60_000);
  });

  it('accepts true/false/1/0 for flags and 0 to switch the periodic check off', () => {
    const env = parseEnv('collab', collabEnvSchema, {
      ...base,
      COLLAB_CLUSTER_ENABLED: 'FALSE',
      COLLAB_CLUSTER_STORE_REPLICATED: '0',
      COLLAB_CLUSTER_RESYNC_INTERVAL_MS: '0',
      COLLAB_INSTANCE_ID: 'collab-eu-1',
    });
    expect(env.COLLAB_CLUSTER_ENABLED).toBe(false);
    expect(env.COLLAB_CLUSTER_STORE_REPLICATED).toBe(false);
    expect(env.COLLAB_CLUSTER_RESYNC_INTERVAL_MS).toBe(0);
    expect(env.COLLAB_INSTANCE_ID).toBe('collab-eu-1');
  });

  it('rejects values that would break the Redis protocol or make a setting ambiguous', () => {
    expect(() =>
      parseEnv('collab', collabEnvSchema, { ...base, COLLAB_CLUSTER_ENABLED: 'maybe' }),
    ).toThrow(/COLLAB_CLUSTER_ENABLED/);
    expect(() =>
      parseEnv('collab', collabEnvSchema, { ...base, COLLAB_INSTANCE_ID: 'has space' }),
    ).toThrow(/COLLAB_INSTANCE_ID/);
    expect(() =>
      parseEnv('collab', collabEnvSchema, { ...base, COLLAB_REDIS_PREFIX: 'a b' }),
    ).toThrow(/COLLAB_REDIS_PREFIX/);
    expect(() =>
      parseEnv('collab', collabEnvSchema, { ...base, COLLAB_CONNECTION_TIMEOUT_MS: '0' }),
    ).toThrow(/COLLAB_CONNECTION_TIMEOUT_MS/);
  });
});

describe('errors and envelopes', () => {
  it('AppError maps code to HTTP status', () => {
    const err = new AppError('NOT_FOUND', 'missing');
    expect(err.status).toBe(404);
    expect(ERROR_CODES.INTERNAL_ERROR).toBe(500);
  });

  it('AppError keeps cause off the envelope', () => {
    const err = new AppError('INTERNAL_ERROR', 'x', { cause: new Error('db password leaked') });
    const env = errorEnvelope({ code: err.code, message: err.message, requestId: 'req-12345678' });
    expect(JSON.stringify(env)).not.toContain('leaked');
  });

  it('builds success and error envelopes', () => {
    expect(successEnvelope({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
    expect(successEnvelope([1], { nextCursor: null })).toEqual({
      success: true,
      data: [1],
      meta: { nextCursor: null },
    });
    expect(
      errorEnvelope({
        code: 'VALIDATION_ERROR',
        message: 'bad',
        requestId: 'req-12345678',
        details: [{ path: 'email', message: 'invalid' }],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad',
        requestId: 'req-12345678',
        details: [{ path: 'email', message: 'invalid' }],
      },
    });
  });
});

describe('readiness evaluation', () => {
  it('api: only postgres decides readiness', () => {
    expect(evaluateApiReadiness({ postgres: 'healthy', redis: 'unavailable' })).toBe('ready');
    expect(evaluateApiReadiness({ postgres: 'unavailable', redis: 'healthy' })).toBe('not_ready');
  });

  it('collab: redis down is degraded, postgres down is not ready', () => {
    expect(evaluateCollabReadiness({ postgres: 'healthy', redis: 'healthy' })).toBe('ready');
    expect(evaluateCollabReadiness({ postgres: 'healthy', redis: 'unavailable' })).toBe('degraded');
    expect(evaluateCollabReadiness({ postgres: 'unavailable', redis: 'healthy' })).toBe(
      'not_ready',
    );
  });
});

describe('logging helpers', () => {
  it('accepts only safe request ids', () => {
    expect(isAcceptableRequestId('abc-12345678')).toBe(true);
    expect(isAcceptableRequestId('short')).toBe(false);
    expect(isAcceptableRequestId('bad id with spaces')).toBe(false);
    expect(isAcceptableRequestId(undefined)).toBe(false);
  });

  it('redacts credentials in URLs', () => {
    expect(redactUrlCredentials('connect postgresql://u:p@host:5432/db failed')).toBe(
      'connect postgresql://***@host:5432/db failed',
    );
  });
});
