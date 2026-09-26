import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  NetatmoError,
  authorizeUrl,
  exchangeCode,
  getMeasure,
  heatingModules,
  heatingRooms,
  homesWithHeating,
  measureTarget,
  refreshTokens,
  setRoomThermPoint,
} from '../public/netatmo.js';

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: new URLSearchParams(options.body) });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.payload,
    };
  };
  return calls;
}

describe('authorizeUrl', () => {
  it('points at the Netatmo consent screen with both thermostat scopes', () => {
    const url = new URL(authorizeUrl({ clientId: 'cid', redirectUri: 'https://x.dev/a/', state: 's1' }));
    assert.equal(url.origin + url.pathname, 'https://api.netatmo.com/oauth2/authorize');
    assert.equal(url.searchParams.get('client_id'), 'cid');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://x.dev/a/');
    assert.equal(url.searchParams.get('scope'), 'read_thermostat write_thermostat');
    assert.equal(url.searchParams.get('state'), 's1');
  });
});

describe('exchangeCode', () => {
  it('sends the authorization_code grant and derives an absolute expiry', async () => {
    const calls = mockFetch({
      payload: { access_token: 'at', refresh_token: 'rt', expires_in: 10800 },
    });
    const before = Date.now();
    const tokens = await exchangeCode({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'the-code',
      redirectUri: 'https://x.dev/a/',
    });

    assert.equal(calls[0].url, 'https://api.netatmo.com/oauth2/token');
    assert.equal(calls[0].body.get('grant_type'), 'authorization_code');
    assert.equal(calls[0].body.get('code'), 'the-code');
    assert.equal(calls[0].body.get('client_secret'), 'sec');
    assert.equal(tokens.accessToken, 'at');
    assert.equal(tokens.refreshToken, 'rt');
    assert.ok(tokens.expiresAt >= before + 10800_000);
  });

  it('turns a Netatmo error payload into a NetatmoError', async () => {
    mockFetch({ ok: false, status: 400, payload: { error: 'invalid_grant' } });
    await assert.rejects(
      () => exchangeCode({ clientId: 'c', clientSecret: 's', code: 'bad', redirectUri: 'r' }),
      (error) => error instanceof NetatmoError && error.message === 'invalid_grant'
    );
  });
});

describe('refreshTokens', () => {
  it('sends the refresh_token grant', async () => {
    const calls = mockFetch({ payload: { access_token: 'a2', refresh_token: 'r2', expires_in: 60 } });
    await refreshTokens({ clientId: 'cid', clientSecret: 'sec', refreshToken: 'old' });
    assert.equal(calls[0].body.get('grant_type'), 'refresh_token');
    assert.equal(calls[0].body.get('refresh_token'), 'old');
  });
});

describe('setRoomThermPoint', () => {
  it('sends manual mode with temperature and absolute end time', async () => {
    const calls = mockFetch({ payload: { status: 'ok' } });
    await setRoomThermPoint('token', {
      homeId: 'h1',
      roomId: 'r1',
      mode: 'manual',
      temp: 24,
      endtime: 1700000000,
    });

    assert.equal(calls[0].url, 'https://api.netatmo.com/api/setroomthermpoint');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
    assert.equal(calls[0].body.get('home_id'), 'h1');
    assert.equal(calls[0].body.get('room_id'), 'r1');
    assert.equal(calls[0].body.get('mode'), 'manual');
    assert.equal(calls[0].body.get('temp'), '24');
    assert.equal(calls[0].body.get('endtime'), '1700000000');
  });

  it('omits temp and endtime when returning to the schedule', async () => {
    const calls = mockFetch({ payload: { status: 'ok' } });
    await setRoomThermPoint('token', { homeId: 'h1', roomId: 'r1', mode: 'home' });
    assert.equal(calls[0].body.get('mode'), 'home');
    assert.equal(calls[0].body.get('temp'), null);
    assert.equal(calls[0].body.get('endtime'), null);
  });

  it('reports a network failure instead of throwing a raw TypeError', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(
      () => setRoomThermPoint('t', { homeId: 'h', roomId: 'r', mode: 'home' }),
      (error) => error instanceof NetatmoError && error.status === 0
    );
  });
});

describe('NetatmoError.isAuthError', () => {
  it('recognises expired tokens by HTTP status and by Netatmo error code', () => {
    assert.ok(new NetatmoError('x', { status: 403 }).isAuthError);
    assert.ok(new NetatmoError('x', { status: 200, code: 3 }).isAuthError);
    assert.ok(!new NetatmoError('x', { status: 500 }).isAuthError);
  });
});

describe('heatingRooms', () => {
  const home = {
    id: 'h1',
    name: 'Domov',
    rooms: [
      { id: 'r1', name: 'Obývák' },
      { id: 'r2', name: 'Ložnice' },
      { id: 'r3', name: 'Chodba' },
    ],
    modules: [
      { id: 'm1', type: 'NATherm1', room_id: 'r1' },
      { id: 'm2', type: 'NRV', room_id: 'r2' },
      { id: 'm3', type: 'NAPlug' },
      { id: 'm4', type: 'NACamera', room_id: 'r3' },
    ],
  };

  it('keeps only rooms that have a thermostat or a valve', () => {
    assert.deepEqual(heatingRooms(home).map((r) => r.id), ['r1', 'r2']);
  });

  it('drops homes without any heating hardware', () => {
    const weatherOnly = { id: 'h2', rooms: [{ id: 'x' }], modules: [{ type: 'NAMain', room_id: 'x' }] };
    assert.deepEqual(homesWithHeating([home, weatherOnly]).map((h) => h.id), ['h1']);
  });

  it('keeps only heating modules', () => {
    assert.deepEqual(heatingModules(home).map((m) => m.id), ['m1', 'm2']);
  });
});

describe('measureTarget', () => {
  it('addresses bridged modules through their bridge', () => {
    assert.deepEqual(measureTarget({ id: 'mod', bridge: 'plug' }), {
      deviceId: 'plug',
      moduleId: 'mod',
    });
  });

  it('uses the module itself when it has no bridge', () => {
    assert.deepEqual(measureTarget({ id: 'plug' }), { deviceId: 'plug' });
  });
});

describe('getMeasure', () => {
  it('posts the measure query and returns the series body', async () => {
    const calls = mockFetch({ payload: { body: [{ beg_time: 1, step_time: 600, value: [[20]] }] } });
    const body = await getMeasure('token', {
      deviceId: 'plug',
      moduleId: 'mod',
      type: 'temperature',
      scale: 'max',
      dateBegin: 100,
      dateEnd: 200,
    });

    assert.equal(calls[0].url, 'https://api.netatmo.com/api/getmeasure');
    assert.equal(calls[0].body.get('device_id'), 'plug');
    assert.equal(calls[0].body.get('module_id'), 'mod');
    assert.equal(calls[0].body.get('type'), 'temperature');
    assert.equal(calls[0].body.get('scale'), 'max');
    assert.equal(calls[0].body.get('date_begin'), '100');
    assert.equal(calls[0].body.get('date_end'), '200');
    assert.deepEqual(body, [{ beg_time: 1, step_time: 600, value: [[20]] }]);
  });

  it('omits module_id and optional flags when not given', async () => {
    const calls = mockFetch({ payload: { body: [] } });
    await getMeasure('token', { deviceId: 'plug', type: 'boiler_on', scale: '30min', dateBegin: 1, dateEnd: 2 });
    assert.equal(calls[0].body.get('module_id'), null);
    assert.equal(calls[0].body.get('optimize'), null);
    assert.equal(calls[0].body.get('real_time'), 'true');
    assert.deepEqual(await getMeasure('t', { deviceId: 'd', type: 'x', scale: 'y', dateBegin: 1, dateEnd: 2 }), []);
  });
});
