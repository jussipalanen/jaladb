/** Error body returned by the API: { error: { code, message, sqlstate? } }. */
export interface ApiError {
  code: string;
  message: string;
  sqlstate?: string;
}

export interface ApiResponse {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** HTTP status; 0 when the API could not be reached. */
  status: number;
  ok: boolean;
  /** Round trip in milliseconds, measured in the browser. */
  durationMs: number;
  data: unknown;
}

export function apiError(response: ApiResponse): ApiError | undefined {
  if (response.ok) return undefined;
  const error = (response.data as { error?: ApiError } | null)?.error;
  return error ?? { code: `HTTP_${response.status}`, message: 'Unexpected response from the API' };
}

export async function callApi(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse> {
  const started = performance.now();
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      method,
      path,
      body,
      status: response.status,
      ok: response.ok,
      durationMs: performance.now() - started,
      data: text ? JSON.parse(text) : null,
    };
  } catch (error) {
    return {
      method,
      path,
      body,
      status: 0,
      ok: false,
      durationMs: performance.now() - started,
      data: {
        error: {
          code: 'API_UNREACHABLE',
          message: `Could not reach the API (${(error as Error).message}). Is it running? Start it with ./dev api.`,
        },
      },
    };
  }
}
