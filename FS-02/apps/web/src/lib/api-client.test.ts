import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, describeApiError, fieldErrorsFromApi } from './api-client';

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const errorBody = (code: string, extra: object = {}) => ({
  success: false,
  error: { code, message: 'server text', requestId: 'req-1', ...extra },
});

afterEach(() => vi.unstubAllGlobals());

describe('request shape', () => {
  it('sends same-origin JSON requests; POST/DELETE always carry a JSON body', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(respond(200, { success: true, data: null })));
    vi.stubGlobal('fetch', fetchMock);

    await api.logout();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{}');

    await api.revokeSession('a/b c');
    const [revokeUrl, revokeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(revokeUrl).toBe('/api/v1/auth/sessions/a%2Fb%20c'); // path segment is encoded
    expect(revokeInit.method).toBe('DELETE');
    expect(revokeInit.body).toBe('{}');
  });

  it('sends no body on GET', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respond(200, { success: true, data: { sessions: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.listSessions();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('serializes the payload exactly as given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respond(200, { success: true, data: { user: {} } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: 'a@b.co', password: 'pw' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co', password: 'pw' });
  });
});

describe('response handling', () => {
  it('unwraps the success envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(200, { success: true, data: { sessions: [1] } })),
    );
    await expect(api.listSessions()).resolves.toEqual({ sessions: [1] });
  });

  it('raises ApiError with code, details and request id from the error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond(
            400,
            errorBody('VALIDATION_ERROR', { details: [{ path: 'email', message: 'bad' }] }),
          ),
        ),
    );
    const error = await api.login({ email: 'x', password: 'y' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      requestId: 'req-1',
      details: [{ path: 'email', message: 'bad' }],
    });
  });

  it('reads Retry-After on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(429, errorBody('RATE_LIMITED'), { 'retry-after': '120' })),
    );
    const error = (await api
      .login({ email: 'x', password: 'y' })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfterSeconds).toBe(120);
  });

  it('maps a failed fetch to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = (await api.logout().catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('treats a non-JSON or unexpected body as UNKNOWN, never as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(502, '<html>Bad gateway</html>')));
    const error = (await api.logout().catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'UNKNOWN', status: 502 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, { hello: 'world' })));
    await expect(api.logout()).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});

describe('user-facing messages', () => {
  const make = (
    code: ApiError['code'],
    extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
  ) => new ApiError({ status: 400, code, message: 'internal wording', ...extra });

  it('uses fixed, friendly text and never the server message', () => {
    expect(describeApiError(make('INVALID_CREDENTIALS'))).toBe('Incorrect email or password.');
    expect(describeApiError(make('EMAIL_TAKEN'))).toMatch(/already exists/);
    expect(describeApiError(make('SERVICE_UNAVAILABLE'))).toMatch(/temporarily unavailable/);
    expect(describeApiError(make('INTERNAL_ERROR'))).toMatch(/Something went wrong/);
    expect(describeApiError(new Error('boom'))).toMatch(/Something went wrong/);
    expect(describeApiError(make('INTERNAL_ERROR'))).not.toContain('internal wording');
  });

  it('describes rate limiting with a readable wait time', () => {
    expect(describeApiError(make('RATE_LIMITED'))).toMatch(/wait a moment/);
    expect(describeApiError(make('RATE_LIMITED', { retryAfterSeconds: 30 }))).toContain(
      '30 seconds',
    );
    expect(describeApiError(make('RATE_LIMITED', { retryAfterSeconds: 600 }))).toContain(
      '10 minutes',
    );
  });

  it('maps API field errors by path and ignores form-level details', () => {
    const error = make('VALIDATION_ERROR', {
      details: [
        { path: 'email', message: 'bad email' },
        { path: 'email', message: 'second' },
        { path: '', message: 'form level' },
        { path: 'password', message: 'short' },
      ],
    });
    expect(fieldErrorsFromApi(error)).toEqual({ email: 'bad email', password: 'short' });
    expect(fieldErrorsFromApi(new Error('x'))).toEqual({});
  });
});

describe('page content and image calls', () => {
  const okBody = { success: true, data: null };
  const stub = () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(respond(200, okBody)));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const lastCall = (fetchMock: ReturnType<typeof stub>) =>
    fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

  it('asks for a collaboration token with an empty JSON body', async () => {
    const fetchMock = stub();
    await api.createCollabToken('p/1');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/v1/pages/p%2F1/collab-token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('sends image bytes unchanged with the announced content type', async () => {
    const fetchMock = stub();
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await api.uploadImageBytes(
      {
        url: '/api/v1/assets/a1/content',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        expiresAt: '2026-11-15T00:00:00.000Z',
      },
      file,
    );
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/v1/assets/a1/content');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    expect(init.body).toBe(file);
    expect(init.credentials).toBe('same-origin');
  });

  it('authorizes and confirms uploads as JSON', async () => {
    const fetchMock = stub();
    await api.authorizeImageUpload({
      purpose: 'PAGE_IMAGE',
      pageId: 'p1',
      contentType: 'image/png',
      sizeBytes: 5,
    });
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/assets/uploads');
    await api.completeImageUpload('a/1');
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/assets/a%2F1/complete');
    expect(lastCall(fetchMock)[1].body).toBe('{}');
  });

  it('describes a too-large save', () => {
    expect(
      describeApiError(new ApiError({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'x' })),
    ).toMatch(/too large/);
  });
});
