// usage-pace.sh check-update against a local stand-in for the GitHub API:
// each newer release is announced once, nothing else is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const current = JSON.parse(readFileSync(join(root, 'Extension/manifest.json'), 'utf8')).version;
const run = promisify(execFile);

let release = null;
const server = createServer((request, response) => {
  if (request.url !== '/repos/LukasvanUden/usage-pace-for-claude/releases/latest' || !release) {
    response.writeHead(404).end('{"message":"Not Found"}');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tag_name: release, name: 'Release' }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
test.after(() => server.close());

async function checkUpdate(state) {
  await run('sh', ['App/usage-pace.sh', 'check-update'], {
    cwd: root,
    env: { ...process.env, USAGE_PACE_API: `http://127.0.0.1:${server.address().port}`, USAGE_PACE_STATE: state },
  });
  const read = (name) => (existsSync(join(state, name)) ? readFileSync(join(state, name), 'utf8').trim() : null);
  return { available: read('update-available'), announced: read('announced') };
}

function freshState() {
  return mkdtempSync(join(tmpdir(), 'usage-pace-'));
}

test('announces a newer release once', async () => {
  const state = freshState();
  release = 'v9.9.9';
  assert.deepEqual(await checkUpdate(state), { available: '9.9.9', announced: '9.9.9' });

  rmSync(join(state, 'update-available'));
  assert.deepEqual(await checkUpdate(state), { available: null, announced: '9.9.9' }, 'not again for the same release');

  release = '10.0.0';
  assert.deepEqual(await checkUpdate(state), { available: '10.0.0', announced: '10.0.0' }, 'tags without "v" work too');
});

test('stays quiet for the same, an older, or no release', async () => {
  for (const tag of [`v${current}`, 'v0.0.1', null]) {
    release = tag;
    assert.deepEqual(await checkUpdate(freshState()), { available: null, announced: null }, `release ${tag}`);
  }
});

test('compares versions numerically', async () => {
  const [major, minor, patch] = current.split('.').map(Number);
  release = `v${major}.${minor}.${patch + 10}`;
  assert.equal((await checkUpdate(freshState())).available, `${major}.${minor}.${patch + 10}`);
});
