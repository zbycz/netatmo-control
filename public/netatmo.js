const API = 'https://api.netatmo.com';

export const SCOPE = 'read_thermostat write_thermostat';
export const HEATING_MODULE_TYPES = ['NATherm1', 'NRV'];

export const MEASURE_TYPES = 'temperature,sp_temperature';

export class NetatmoError extends Error {
  constructor(message, { status = 0, code = 0 } = {}) {
    super(message);
    this.name = 'NetatmoError';
    this.status = status;
    this.code = code;
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403 || [2, 3, 9].includes(this.code);
  }
}

export function authorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
  });
  return `${API}/oauth2/authorize?${params}`;
}

async function postForm(path, body, headers = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body).toString(),
    });
  } catch (cause) {
    throw new NetatmoError('Netatmo je nedostupné, zkontroluj připojení.', { status: 0 });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Netatmo occasionally answers with an HTML error page
  }

  if (!response.ok || payload?.error) {
    const err = payload?.error;
    const code = typeof err === 'object' ? err.code : 0;
    const message =
      (typeof err === 'object' ? err.message : err) ||
      payload?.error_description ||
      `Netatmo vrátilo chybu ${response.status}.`;
    throw new NetatmoError(message, { status: response.status, code });
  }

  return payload;
}

function toTokens(payload) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 10800) * 1000,
  };
}

export async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  return toTokens(
    await postForm('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      scope: SCOPE,
    })
  );
}

export async function refreshTokens({ clientId, clientSecret, refreshToken }) {
  return toTokens(
    await postForm('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    })
  );
}

function call(path, accessToken, body = {}) {
  return postForm(path, body, { Authorization: `Bearer ${accessToken}` });
}

export async function homesData(accessToken) {
  const payload = await call('/api/homesdata', accessToken);
  return payload.body?.homes ?? [];
}

export async function homeStatus(accessToken, homeId) {
  const payload = await call('/api/homestatus', accessToken, { home_id: homeId });
  return payload.body?.home ?? { rooms: [], modules: [] };
}

export async function getRoomMeasure(accessToken, { homeId, roomId, scale = '30min', begin, end }) {
  const payload = await call(
    '/api/getroommeasure',
    accessToken,
    {
      home_id: homeId,
      room_id: roomId,
      scale,
      type: MEASURE_TYPES,
      date_begin: Math.floor(begin / 1000),
      date_end: Math.floor(end / 1000),
    }
  );
  return payload.body ?? {};
}

export function setRoomThermPoint(accessToken, { homeId, roomId, mode, temp, endtime }) {
  const body = { home_id: homeId, room_id: roomId, mode };
  if (temp != null) body.temp = String(temp);
  if (endtime != null) body.endtime = String(endtime);
  return call('/api/setroomthermpoint', accessToken, body);
}

export function heatingRooms(home) {
  const heatingRoomIds = new Set(
    (home.modules ?? [])
      .filter((m) => HEATING_MODULE_TYPES.includes(m.type) && m.room_id)
      .map((m) => m.room_id)
  );
  return (home.rooms ?? []).filter((r) => heatingRoomIds.has(r.id));
}

export function homesWithHeating(homes) {
  return homes.filter((home) => heatingRooms(home).length > 0);
}
