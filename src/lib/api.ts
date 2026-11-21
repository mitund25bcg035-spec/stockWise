let authToken: string | null = null;
let activeBusinessId: number | null = null;

export function setInMemoryAuthToken(token: string | null): void {
  authToken = token;
}

export function getInMemoryAuthToken(): string | null {
  return authToken;
}

export function setActiveBusinessId(businessId: number | null): void {
  activeBusinessId = businessId;
}

export function getActiveBusinessId(): number | null {
  return activeBusinessId;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'StockWise');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (activeBusinessId !== null) {
    headers.set('X-Business-Id', String(activeBusinessId));
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }

  return data as T;
}
