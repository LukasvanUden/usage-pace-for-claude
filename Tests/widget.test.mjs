import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { buildView } = createRequire(import.meta.url)('../Extension/widget.js');

const NOW = Date.parse('2026-09-29T23:00:00Z');
const DAY = 86_400_000;
const at = (ms) => new Date(NOW + ms).toISOString();

test('shows every limit with its time line and the weekly pace', () => {
  const view = buildView({
    limits: [
      { kind: 'session', percent: 9.7, resets_at: at(257 * 60_000) },
      { kind: 'weekly_all', percent: 30, resets_at: at(6 * DAY) },
      { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 4, resets_at: at(6 * DAY) },
    ],
  }, NOW, 'en', 'en-US');

  assert.deepEqual(view.rows.map((row) => row.label), ['Session limit', 'Weekly · all models', 'Weekly · Fable']);
  assert.equal(view.rows[0].meta, '4 hr 17 min · 9%');
  assert.deepEqual({ ...view.rows[0].time, end: Math.round(view.rows[0].time.end) }, { shared: 9, end: 14, over: false });
  assert.match(view.rows[1].meta, /· 30%$/);
  assert.deepEqual({ ...view.rows[1].time, shared: Math.round(view.rows[1].time.shared) }, { shared: 14, end: 30, over: true });
  assert.equal(view.pace, '16% over pace');
});

test('reports under pace and on pace', () => {
  const weekly = (percent) => ({ limits: [{ kind: 'weekly_all', percent, resets_at: at(3.5 * DAY) }] });
  assert.equal(buildView(weekly(20), NOW, 'en').pace, '30% under pace');
  assert.equal(buildView(weekly(52), NOW, 'en').pace, 'On pace');
});

test('skips limits Claude does not show', () => {
  const view = buildView({
    limits: [
      { kind: 'weekly_all', percent: 10, resets_at: at(DAY) },
      { kind: 'weekly_scoped', scope: { model: { display_name: ' ' } }, percent: 5, resets_at: at(DAY) },
      { kind: 'monthly_something', percent: 5, resets_at: at(DAY) },
      { kind: 'session', percent: null, resets_at: null },
    ],
  }, NOW, 'en');
  assert.deepEqual(view.rows.map((row) => row.label), ['Weekly · all models']);
});

test('falls back to five_hour and seven_day without a limits list', () => {
  const view = buildView({
    five_hour: { utilization: 37, resets_at: at(HOUR(2)) },
    seven_day: { utilization: 38, resets_at: at(6 * DAY) },
  }, NOW, 'en');
  assert.deepEqual(view.rows.map((row) => [row.label, row.used]), [['Session limit', 37], ['Weekly · all models', 38]]);
});

test('a window that has not started yet has no time line and no pace', () => {
  const view = buildView({ limits: [{ kind: 'weekly_all', percent: 0, resets_at: null }] }, NOW, 'en');
  assert.equal(view.rows[0].time, null);
  assert.equal(view.rows[0].meta, '0%');
  assert.equal(view.pace, null);
});

test('German labels', () => {
  const view = buildView({ limits: [{ kind: 'weekly_all', percent: 30, resets_at: at(6 * DAY) }] }, NOW, 'de', 'de-DE');
  assert.equal(view.rows[0].label, 'Wöchentlich · alle Modelle');
  assert.equal(view.pace, '16 % über Plan');
});

test('nothing to draw before the first usage response', () => {
  assert.equal(buildView(null, NOW, 'en'), null);
});

function HOUR(hours) {
  return hours * 3_600_000;
}
