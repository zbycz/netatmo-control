import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  averageTemperature,
  boostEndsAt,
  formatRemaining,
  selectedRoomIds,
} from '../public/app.js';

describe('formatRemaining', () => {
  it('renders a m:ss countdown', () => {
    assert.equal(formatRemaining(15 * 60 * 1000), '15:00');
    assert.equal(formatRemaining(65_000), '1:05');
    assert.equal(formatRemaining(9_000), '0:09');
  });

  it('never goes negative once the boost has elapsed', () => {
    assert.equal(formatRemaining(-5_000), '0:00');
  });
});

describe('selectedRoomIds', () => {
  const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('falls back to every heating room when nothing is configured', () => {
    assert.deepEqual(selectedRoomIds({ roomIds: [] }, rooms), ['a', 'b', 'c']);
    assert.deepEqual(selectedRoomIds({}, rooms), ['a', 'b', 'c']);
  });

  it('keeps the configured subset', () => {
    assert.deepEqual(selectedRoomIds({ roomIds: ['b'] }, rooms), ['b']);
  });

  it('ignores rooms that no longer exist, and falls back if none survive', () => {
    assert.deepEqual(selectedRoomIds({ roomIds: ['b', 'gone'] }, rooms), ['b']);
    assert.deepEqual(selectedRoomIds({ roomIds: ['gone'] }, rooms), ['a', 'b', 'c']);
  });
});

describe('boostEndsAt', () => {
  it('returns the latest manual setpoint end across rooms', () => {
    const rooms = [
      { therm_setpoint_mode: 'manual', therm_setpoint_end_time: 1000 },
      { therm_setpoint_mode: 'manual', therm_setpoint_end_time: 2000 },
    ];
    assert.equal(boostEndsAt(rooms), 2_000_000);
  });

  it('also counts a boost started from the Netatmo app', () => {
    assert.equal(
      boostEndsAt([{ therm_setpoint_mode: 'max', therm_setpoint_end_time: 1500 }]),
      1_500_000
    );
  });

  it('ignores rooms following the schedule', () => {
    assert.equal(boostEndsAt([{ therm_setpoint_mode: 'home', therm_setpoint_end_time: 9999 }]), null);
    assert.equal(boostEndsAt([{ therm_setpoint_mode: 'schedule', therm_setpoint_end_time: 9999 }]), null);
    assert.equal(boostEndsAt([{ therm_setpoint_mode: 'manual' }]), null);
    assert.equal(boostEndsAt([]), null);
  });
});

describe('averageTemperature', () => {
  it('averages the measured temperatures', () => {
    const rooms = [{ therm_measured_temperature: 20 }, { therm_measured_temperature: 22 }];
    assert.equal(averageTemperature(rooms), 21);
  });

  it('skips rooms that report no temperature', () => {
    const rooms = [{ therm_measured_temperature: 20 }, { id: 'offline' }];
    assert.equal(averageTemperature(rooms), 20);
    assert.equal(averageTemperature([{ id: 'offline' }]), null);
  });
});
