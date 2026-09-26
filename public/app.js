import {
  NetatmoError,
  authorizeUrl,
  exchangeCode,
  getRoomMeasure,
  heatingRooms,
  homeStatus,
  homesData,
  homesWithHeating,
  refreshTokens,
  setRoomThermPoint,
} from './netatmo.js';
import { renderTemperatureChart } from './chart.js';
import * as store from './store.js';

const REFRESH_MARGIN_MS = 60_000;
const POLL_IDLE_MS = 60_000;
const POLL_ACTIVE_MS = 15_000;

const el = (id) => document.getElementById(id);
const views = ['setup', 'loading', 'main', 'settings'];

let home = null;
let status = null;
let chartPoints = [];
let chartHours = 6;
let pollTimer = null;
let tickTimer = null;

export function redirectUri() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function showView(name) {
  views.forEach((v) => {
    el(`view-${v}`).hidden = v !== name;
  });
  el('settings-btn').hidden = name !== 'main';
}

function setMessage(text, kind = '') {
  const node = el('message');
  node.textContent = text;
  node.className = `message ${kind}`.trim();
}

function setLoading(text) {
  el('loading-text').textContent = text;
  showView('loading');
}

export function formatRemaining(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Tohle není platný JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('Tohle není platný JSON.');

  const source = data.client ?? data;
  const id = String(source.id ?? source.client_id ?? '').trim();
  const secret = String(source.secret ?? source.client_secret ?? '').trim();
  if (!id || !secret) throw new Error('V JSONu chybí client id nebo client secret.');

  const result = { client: { id, secret } };

  const temp = Number(data.config?.boostTemp);
  if (Number.isFinite(temp)) {
    result.config = { boostTemp: Math.min(30, Math.max(7, temp)) };
    if (Array.isArray(data.config.roomIds)) result.config.roomIds = data.config.roomIds.map(String);
  }

  const tokens = data.tokens;
  if (tokens?.accessToken && tokens?.refreshToken) {
    result.tokens = {
      accessToken: String(tokens.accessToken),
      refreshToken: String(tokens.refreshToken),
      expiresAt: Number(tokens.expiresAt) || Date.now(),
    };
  }
  return result;
}

export function selectedRoomIds(config, rooms) {
  const available = rooms.map((r) => r.id);
  const chosen = (config.roomIds ?? []).filter((id) => available.includes(id));
  return chosen.length ? chosen : available;
}

const BOOST_MODES = ['manual', 'max'];

export function boostEndsAt(rooms) {
  const ends = rooms
    .filter((r) => BOOST_MODES.includes(r.therm_setpoint_mode) && r.therm_setpoint_end_time)
    .map((r) => r.therm_setpoint_end_time * 1000);
  return ends.length ? Math.max(...ends) : null;
}

export function averageTemperature(rooms) {
  const temps = rooms
    .map((r) => r.therm_measured_temperature)
    .filter((t) => typeof t === 'number');
  if (!temps.length) return null;
  return temps.reduce((a, b) => a + b, 0) / temps.length;
}

async function validAccessToken() {
  const tokens = store.getTokens();
  if (!tokens) throw new NetatmoError('Nejsi přihlášený.', { status: 401 });
  if (tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) return tokens.accessToken;

  const client = store.getClient();
  const fresh = await refreshTokens({
    clientId: client.id,
    clientSecret: client.secret,
    refreshToken: tokens.refreshToken,
  });
  store.setTokens(fresh);
  return fresh.accessToken;
}

async function withToken(fn) {
  const token = await validAccessToken();
  try {
    return await fn(token);
  } catch (error) {
    if (!(error instanceof NetatmoError) || !error.isAuthError) throw error;
    const client = store.getClient();
    const tokens = store.getTokens();
    const fresh = await refreshTokens({
      clientId: client.id,
      clientSecret: client.secret,
      refreshToken: tokens.refreshToken,
    });
    store.setTokens(fresh);
    return fn(fresh.accessToken);
  }
}

function statusRooms() {
  if (!home || !status) return [];
  const chosen = new Set(selectedRoomIds(store.getConfig(), heatingRooms(home)));
  return (status.rooms ?? []).filter((r) => chosen.has(r.id));
}

function renderStatus() {
  const rooms = statusRooms();
  const names = heatingRooms(home)
    .filter((r) => rooms.some((s) => s.id === r.id))
    .map((r) => r.name);

  el('status-room').textContent = names.length > 2 ? `${names.length} místnosti` : names.join(', ');

  const temp = averageTemperature(rooms);
  el('status-temp').textContent = temp == null ? '–' : temp.toFixed(1);

  renderBoostState();
}

function renderBoostState() {
  const rooms = statusRooms();
  const endsAt = boostEndsAt(rooms);
  const sub = el('status-sub');

  if (endsAt && endsAt > Date.now()) {
    sub.textContent = `Topí ještě ${formatRemaining(endsAt - Date.now())}`;
    sub.classList.add('active');
    el('cancel-btn').hidden = false;
  } else {
    const setpoint = rooms.find((r) => typeof r.therm_setpoint_temperature === 'number');
    sub.textContent = setpoint ? `Program: ${setpoint.therm_setpoint_temperature} °C` : '';
    sub.classList.remove('active');
    el('cancel-btn').hidden = true;
  }
}

function scheduleTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(renderBoostState, 1000);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const endsAt = boostEndsAt(statusRooms());
  const active = endsAt && endsAt > Date.now();
  pollTimer = setTimeout(loadStatus, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
}

async function loadStatus() {
  try {
    status = await withToken((token) => homeStatus(token, home.id));
    renderStatus();
    loadHistory().catch((e) => console.warn('chart', e));
  } catch (error) {
    reportError(error);
  } finally {
    schedulePoll();
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function historyFromMeasure(body) {
  const chunks = Array.isArray(body) ? body : [];
  const points = [];

  chunks.forEach((series) => {
    const step = (series.step_time ?? 600) * 1000;
    (series.value ?? []).forEach((values, i) => {
      const time = series.beg_time * 1000 + i * step;
      const temp = values[0];
      const setpoint = values[1];
      const prev = points[points.length - 1];
      if (prev && prev.time === time) {
        if (typeof temp === 'number') prev.temp = temp;
        if (typeof setpoint === 'number') prev.setpoint = setpoint;
      } else {
        points.push({ time, temp, setpoint });
      }
    });
  });

  return points;
}

export function heatingPeriods(points, boostTemp) {
  const periods = [];
  const GAP_MS = 30 * 60 * 1000;
  let start = null;
  let last = null;

  const startPeriod = (time) => {
    if (start == null) start = time;
    last = time;
  };
  const endPeriod = () => {
    if (start != null) {
      periods.push({ start, end: last });
      start = null;
    }
  };

  points.forEach((p) => {
    if (p.setpoint == null) return;
    if (p.setpoint >= boostTemp - 0.5) {
      startPeriod(p.time);
    } else {
      endPeriod();
    }
  });
  endPeriod();

  // Merge consecutive periods closer than the data gap (a single boost
  // may be split across API chunks).
  const merged = [];
  periods.forEach((period) => {
    const prev = merged[merged.length - 1];
    if (prev && period.start - prev.end < GAP_MS) prev.end = period.end;
    else merged.push({ ...period });
  });

  return merged;
}

function renderChart() {
  const config = store.getConfig();
  const periods = heatingPeriods(chartPoints, config.boostTemp);
  const node = el('chart');
  node.replaceChildren(renderTemperatureChart(chartPoints, periods, Date.now(), chartHours));
  document.querySelectorAll('.chart-range button').forEach((button) => {
    const active = Number(button.dataset.hours) === chartHours;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function loadHistory() {
  const rooms = selectedRoomIds(store.getConfig(), heatingRooms(home));
  const end = Date.now();
  const begin = end - DAY_MS;

  const results = await Promise.all(
    rooms.map((roomId) =>
      withToken((token) => getRoomMeasure(token, { homeId: home.id, roomId, begin, end }))
    )
  );

  const merged = new Map();
  results.forEach((body) => {
    historyFromMeasure(body ?? {}).forEach((point) => {
      const prev = merged.get(point.time);
      if (prev) {
        if (typeof point.temp === 'number') prev.temp = point.temp;
        if (typeof point.setpoint === 'number') prev.setpoint = point.setpoint;
      } else {
        merged.set(point.time, { ...point });
      }
    });
  });

  chartPoints = Array.from(merged.values()).sort((a, b) => a.time - b.time);
  renderChart();
}

function reportError(error) {
  if (error instanceof NetatmoError && error.isAuthError && !store.getTokens()) {
    showSetup('Přihlášení vypršelo, přihlas se znovu.');
    return;
  }
  setMessage(error.message || 'Něco se pokazilo.', 'error');
}

async function boost(minutes) {
  const config = store.getConfig();
  const rooms = selectedRoomIds(config, heatingRooms(home));
  const endtime = Math.floor(Date.now() / 1000) + minutes * 60;

  document.querySelectorAll('.boost').forEach((b) => (b.disabled = true));
  setMessage(`Zapínám na ${minutes} min…`);

  try {
    await withToken((token) =>
      Promise.all(
        rooms.map((roomId) =>
          setRoomThermPoint(token, {
            homeId: home.id,
            roomId,
            mode: 'manual',
            temp: config.boostTemp,
            endtime,
          })
        )
      )
    );
    setMessage(`Topí na ${config.boostTemp} °C po dobu ${minutes} min.`, 'ok');
    await loadStatus();
  } catch (error) {
    reportError(error);
  } finally {
    document.querySelectorAll('.boost').forEach((b) => (b.disabled = false));
  }
}

async function cancelBoost() {
  const rooms = selectedRoomIds(store.getConfig(), heatingRooms(home));
  el('cancel-btn').disabled = true;
  setMessage('Vracím na program…');
  try {
    await withToken((token) =>
      Promise.all(
        rooms.map((roomId) =>
          setRoomThermPoint(token, { homeId: home.id, roomId, mode: 'home' })
        )
      )
    );
    setMessage('Zpět na program.', 'ok');
    await loadStatus();
  } catch (error) {
    reportError(error);
  } finally {
    el('cancel-btn').disabled = false;
  }
}

function renderSettings() {
  const config = store.getConfig();
  el('boost-temp').value = config.boostTemp;

  const rooms = heatingRooms(home);
  const chosen = new Set(selectedRoomIds(config, rooms));
  el('rooms-list').innerHTML = '';

  rooms.forEach((room) => {
    const row = document.createElement('label');
    row.className = 'room-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = room.id;
    box.checked = chosen.has(room.id);
    row.append(box, document.createTextNode(room.name));
    el('rooms-list').append(row);
  });

  el('home-note').textContent = `Domácnost: ${home.name}`;
}

function saveSettings() {
  const roomIds = Array.from(el('rooms-list').querySelectorAll('input:checked')).map((i) => i.value);
  const temp = Number(el('boost-temp').value);
  store.setConfig({
    roomIds,
    boostTemp: Number.isFinite(temp) ? Math.min(30, Math.max(7, temp)) : 24,
  });
}

function showSetup(message = '') {
  clearTimeout(pollTimer);
  clearInterval(tickTimer);
  const client = store.getClient();
  el('client-id').value = client.id;
  el('client-secret').value = client.secret;
  el('redirect-uri').textContent = redirectUri();
  showView('setup');
  const note = el('setup-note');
  note.textContent = message;
  note.hidden = !message;
}

async function applyImport() {
  const note = el('import-note');
  note.hidden = false;
  note.className = 'note error';

  let parsed;
  try {
    parsed = parseImport(el('import-json').value);
  } catch (error) {
    note.textContent = error.message;
    return;
  }

  store.setClient(parsed.client);
  if (parsed.config) store.setConfig(parsed.config);
  el('client-id').value = parsed.client.id;
  el('client-secret').value = parsed.client.secret;
  el('import-json').value = '';

  if (parsed.tokens) {
    store.setTokens(parsed.tokens);
    await startApp();
    return;
  }

  note.className = 'note ok';
  note.textContent = 'Načteno. Teď klepni na Přihlásit se přes Netatmo.';
}

function startLogin(event) {
  event.preventDefault();
  const id = el('client-id').value.trim();
  const secret = el('client-secret').value.trim();
  if (!id || !secret) return;
  store.setClient({ id, secret });
  window.location.href = authorizeUrl({
    clientId: id,
    redirectUri: redirectUri(),
    state: store.newOAuthState(),
  });
}

async function startApp() {
  setLoading('Načítám zařízení…');
  try {
    const config = store.getConfig();
    const homes = homesWithHeating(await withToken(homesData));
    if (!homes.length) {
      showSetup('Na účtu není žádný termostat ani hlavice.');
      return;
    }
    home = homes.find((h) => h.id === config.homeId) ?? homes[0];
    store.setConfig({ homeId: home.id });

    status = await withToken((token) => homeStatus(token, home.id));
    showView('main');
    renderStatus();
    scheduleTick();
    schedulePoll();
    loadHistory().catch((e) => console.warn('chart', e));
  } catch (error) {
    if (error instanceof NetatmoError && error.isAuthError) {
      store.clearSession();
      showSetup('Přihlášení vypršelo, přihlas se znovu.');
      return;
    }
    showView('main');
    reportError(error);
  }
}

async function handleRedirect(params) {
  if (params.get('error')) {
    window.history.replaceState({}, '', redirectUri());
    showSetup(`Netatmo odmítlo přihlášení: ${params.get('error')}`);
    return true;
  }

  const code = params.get('code');
  if (!code) return false;

  const expected = store.takeOAuthState();
  window.history.replaceState({}, '', redirectUri());

  if (!expected || expected !== params.get('state')) {
    showSetup('Přihlášení se nepodařilo ověřit, zkus to znovu.');
    return true;
  }

  setLoading('Přihlašuji…');
  const client = store.getClient();
  try {
    store.setTokens(
      await exchangeCode({
        clientId: client.id,
        clientSecret: client.secret,
        code,
        redirectUri: redirectUri(),
      })
    );
  } catch (error) {
    showSetup(error.message || 'Přihlášení se nepodařilo.');
    return true;
  }
  return false;
}

function bindEvents() {
  el('setup-form').addEventListener('submit', startLogin);
  el('import-btn').addEventListener('click', applyImport);
  document.querySelectorAll('.boost').forEach((button) => {
    button.addEventListener('click', () => boost(Number(button.dataset.minutes)));
  });
  el('cancel-btn').addEventListener('click', cancelBoost);
  document.querySelectorAll('.chart-range button').forEach((button) => {
    button.addEventListener('click', () => {
      chartHours = Number(button.dataset.hours);
      store.setConfig({ chartHours });
      renderChart();
    });
  });
  el('settings-btn').addEventListener('click', () => {
    renderSettings();
    showView('settings');
  });
  el('settings-done').addEventListener('click', () => {
    saveSettings();
    showView('main');
    renderStatus();
    loadStatus();
  });
  el('logout-btn').addEventListener('click', () => {
    store.clearAll();
    showSetup();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && home) loadStatus();
  });
}

async function main() {
  chartHours = Number(store.getConfig().chartHours) || 6;
  bindEvents();

  const params = new URLSearchParams(window.location.search);
  if (await handleRedirect(params)) return;

  if (!store.hasClient() || !store.getTokens()) {
    showSetup();
    return;
  }
  await startApp();
}

if (typeof document !== 'undefined' && !window.__NETATMO_TEST__) {
  main();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
