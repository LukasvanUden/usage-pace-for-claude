// End to end against Tests/fake-claude: the extension loads into the default
// session, reads the usage API, adds a collapsible "Usage" row below "More",
// draws time lines in Claude's usage popover, and follows the popover settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));

async function runFakeClaude() {
  const child = spawn(electron, ['Tests/fake-claude/main.js'], { cwd: root });
  const steps = {};
  for await (const line of createInterface({ input: child.stdout })) {
    const match = /^([A-Z_]+) (\{.*\})$/.exec(line);
    if (match) steps[match[1]] = JSON.parse(match[2]);
  }
  return steps;
}

test('sidebar row, popover time lines and settings', { timeout: 40_000 }, async () => {
  const steps = await runFakeClaude();

  const { sidebar } = steps.LOADED;
  assert.equal(sidebar.previous, 'ArtifactsCustomizeMore');
  assert.equal(sidebar.next, 'dframe-recents-by-mode');
  assert.equal(sidebar.header, 'Usage 16% over pace');
  assert.match(sidebar.headerClasses, /\bnav-row\b.*\bup-header\b/);
  assert.deepEqual(sidebar.iconSize, [16], 'the gauge takes the size of Claude\'s icon');
  assert.equal(sidebar.headerIds, 0);
  assert.equal(sidebar.rowsVisible, true);
  assert.equal(sidebar.styled, true);
  assert.equal(sidebar.over, 1);
  assert.equal(sidebar.buffer, 2);
  assert.match(sidebar.text, /Session limit\s+4 hr 1\d min · 9%/);
  assert.match(sidebar.text, /Weekly · Fable/);
  assert.equal(steps.LOADED.mutations, 0, 'the page settles once the widget is in place');

  const { popover } = steps.POPOVER;
  assert.equal(popover.pace, '16% over pace');
  assert.deepEqual(popover.lines, [true, true, true]);
  assert.equal(popover.overLines, 1);
  assert.deepEqual(popover.onWarning, [false, true, false], 'red only where Claude\'s own bar left its accent color');
  assert.deepEqual(popover.settings, ['sidebar:true', 'popover:true']);
  assert.equal(popover.settingsText, 'Usage Pace Sidebar Popover Uninstall…');
  assert.equal(steps.POPOVER.mutations, 0, 'enhancing the popover does not retrigger itself');

  assert.equal(steps.COLLAPSED.sidebar.rowsVisible, false);
  assert.equal(steps.COLLAPSED.sidebar.header, 'Usage 16% over pace');

  assert.equal(steps.POPOVER_OFF.popover.pace, null);
  assert.deepEqual(steps.POPOVER_OFF.popover.lines, [false, false, false]);
  assert.deepEqual(steps.POPOVER_OFF.popover.settings, ['sidebar:true', 'popover:false']);

  assert.equal(steps.SIDEBAR_OFF.sidebar, null);

  assert.equal(steps.RELOADED.sidebar, null, 'settings survive a reload');
  assert.deepEqual(steps.RELOADED.popover.lines, [false, false, false]);
  assert.deepEqual(steps.RELOADED.popover.settings, ['sidebar:false', 'popover:false']);

  assert.equal(steps.SIDEBAR_ON.sidebar.header, 'Usage 16% over pace');

  const uninstalled = steps.UNINSTALLED;
  assert.equal(uninstalled.sidebar, null, '"Uninstall…" hides the sidebar row right away');
  assert.match(uninstalled.popover.removedHint, /^Hidden\. To remove Usage Pace completely/);
  assert.deepEqual(uninstalled.popover.settings, []);
  assert.equal(uninstalled.mutations, 0);

  const after = steps.AFTER_UNINSTALL;
  assert.equal(after.sidebar, null, 'stays hidden after a reload');
  assert.equal(after.popover.settingsRows, 0);
  assert.deepEqual(after.popover.lines, [false, false, false]);
  assert.equal(after.popover.pace, null);
});
