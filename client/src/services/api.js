// Thin fetch wrapper around the Tyllage REST API.
// Production: same-origin '/api' (served by Express) unless VITE_API_URL points at a separate API host.
const API_ROOT = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api` : '/api';
const TOKEN_KEY = 'tyllage_token';

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

function buildUrl(path, params) {
  const url = `${API_ROOT}${path}`;
  if (!params) return url;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

async function request(method, path, { body, params } = {}) {
  const headers = { Accept: 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(buildUrl(path, params), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the Tyllage server. Check your connection.', 0, 'NETWORK_ERROR');
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('tyllage:unauthorized'));
    throw new ApiError(json?.message || `Request failed (${res.status})`, res.status, json?.code, json?.details);
  }
  return json.data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
};
