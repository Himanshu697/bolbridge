// Talking to the BolBridge Chrome extension from the web app.
// Works because the extension lists this site under "externally_connectable".
import { API_URL } from './api.js';

const KEY = 'bolbridge.extensionId';

export function getExtensionId() {
  try {
    return localStorage.getItem(KEY) || import.meta.env.VITE_EXTENSION_ID || '';
  } catch {
    return import.meta.env.VITE_EXTENSION_ID || '';
  }
}

export function setExtensionId(id) {
  try {
    localStorage.setItem(KEY, id.trim());
  } catch {
    /* ignore */
  }
}

function send(message, timeoutMs = 1500) {
  const id = getExtensionId();
  const runtime = window.chrome && window.chrome.runtime;
  if (!id || !runtime || !runtime.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      runtime.sendMessage(id, message, (response) => {
        clearTimeout(timer);
        if (window.chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** -> { installed: boolean, connected: boolean } */
export async function pingExtension() {
  const res = await send({ type: 'BB_PING' });
  return { installed: !!(res && res.ok), connected: !!(res && res.connected) };
}

export async function connectExtension(token, user) {
  const res = await send({ type: 'BB_AUTH', token, name: user?.name, speaks: user?.speaks, apiUrl: API_URL }, 3000);
  return !!(res && res.ok);
}
