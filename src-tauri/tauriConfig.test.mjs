import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('./tauri.conf.json', import.meta.url), 'utf8'));
const scope = config.app?.security?.assetProtocol?.scope || [];

assert.equal(config.app?.security?.assetProtocol?.enable, true, 'asset protocol must be enabled');
assert.ok(scope.includes('$APPDATA/**'), 'asset protocol should keep app data images readable');
assert.ok(scope.includes('$HOME/**'), 'asset protocol must allow CLI images written under the user home/workspace');
assert.ok(scope.includes('$TEMP/**'), 'asset protocol must allow CLI images written to temporary directories');
assert.ok(scope.includes('/tmp/**'), 'asset protocol must allow CLI images written under /tmp');
assert.ok(scope.includes('/private/tmp/**'), 'asset protocol must allow CLI images written under /private/tmp');
assert.ok(scope.includes('/var/folders/**'), 'asset protocol must allow macOS temporary images written under /var/folders');
assert.ok(scope.includes('/private/var/folders/**'), 'asset protocol must allow macOS temporary images written under /private/var/folders');

console.log('tauriConfig.test.mjs: ok');
