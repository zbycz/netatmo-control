const KEYS = {
  client: 'netatmo.client',
  tokens: 'netatmo.tokens',
  config: 'netatmo.config',
  state: 'netatmo.oauthState',
};

const DEFAULT_CONFIG = { homeId: null, roomIds: [], boostTemp: 24, chartHours: 6 };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota — the app still works for this session
  }
}

export const getClient = () => read(KEYS.client, { id: '', secret: '' });
export const setClient = (client) => write(KEYS.client, client);
export const hasClient = () => Boolean(getClient().id && getClient().secret);

export const getTokens = () => read(KEYS.tokens, null);
export const setTokens = (tokens) => write(KEYS.tokens, tokens);

export const getConfig = () => read(KEYS.config, DEFAULT_CONFIG);
export const setConfig = (patch) => write(KEYS.config, { ...getConfig(), ...patch });

export function takeOAuthState() {
  const value = sessionStorage.getItem(KEYS.state);
  sessionStorage.removeItem(KEYS.state);
  return value;
}

export function newOAuthState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(KEYS.state, value);
  return value;
}

export function clearSession() {
  write(KEYS.tokens, null);
  write(KEYS.config, null);
}

export function clearAll() {
  clearSession();
  write(KEYS.client, null);
}
