// Where the API lives. Set VITE_API_URL at build time, or leave it empty:
// on the Vite dev server (port 3000) the API is on localhost:8000, and anywhere
// else the web app is served by the API server itself, so it is the same address.
function defaultApiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  return window.location.port === '3000' ? 'http://localhost:8000' : window.location.origin;
}

export const API_URL = (import.meta.env.VITE_API_URL || defaultApiUrl()).replace(/\/$/, '');
const TOKEN_KEY = 'bolbridge.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: stays logged in for this tab only */
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, form, auth = true } = {}) {
  const headers = {};
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, `Can't reach the BolBridge server at ${API_URL}. Is it running?`);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let message = 'Something went wrong.';
    if (typeof data.detail === 'string') message = data.detail;
    else if (Array.isArray(data.detail) && data.detail[0]) message = data.detail[0].msg.replace(/^Value error, /, '');
    throw new ApiError(res.status, message);
  }
  return data;
}

export function wsUrl(params) {
  const url = new URL(API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/$/, '') + '/ws/translate';
  const token = getToken();
  const search = new URLSearchParams(params);
  if (token) search.set('token', token);
  url.search = search.toString();
  return url.toString();
}
