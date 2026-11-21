import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('./tauri.conf.json', import.meta.url), 'utf8'));
const scope = config.app?.security?.assetProtocol?.scope || [];

assert.equal(config.app?.security?.assetProtocol?.enable, true, 'asset protocol must be enabled');
assert.ok(scope.includes('$APPDATA/**'), 'asset protocol should keep app data images readable');
assert.deepEqual(scope, ['$APPDATA/**'], 'asset protocol must not expose files outside the app data directory');

const csp = config.app?.security?.csp || '';
const mediaSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('media-src')) || '';
assert.ok(mediaSrc.split(/\s+/).includes('blob:'), 'media-src must allow blob: so cloud read-aloud audio can play');

console.log('tauriConfig.test.mjs: ok');
