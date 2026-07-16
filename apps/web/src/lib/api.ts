/**
 * The API client. One place that knows about tokens, base URLs, and errors.
 *
 * No component ever calls fetch() directly (ENGINEERING-STANDARDS.md §3):
 * data fetching lives in feature `api/` modules, wrapped in TanStack Query.
 */

const BASE = '/api/v1';

const TOKEN_KEY = 'pp.accessToken';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    // The token is gone or stale. Anything else we do here is a guess.
    tokenStore.clear();
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));

    // RFC 7807-shaped validation errors (TR-40) carry per-field messages, so a
    // form can attach each one to the input that caused it.
    const fieldErrors: FieldError[] = Array.isArray(body.errors) ? body.errors : [];

    throw new ApiError(
      response.status,
      body.message ?? body.title ?? 'Something went wrong',
      fieldErrors,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { method: 'POST', body: form });
  },

  /** For the Excel template download — a binary body, not JSON. */
  download: async (path: string, filename: string) => {
    const token = tokenStore.get();
    const response = await fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError(response.status, 'Download failed');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
