import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const locales = ['zh-CN', 'en-US'];
const namespaces = ['common', 'home', 'sidebar', 'user', 'wizard', 'product', 'library', 'editor', 'settings', 'chat', 'cli', 'engine', 'providers', 'tags', 'ad'];

function flattenKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  const keys = [];
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      keys.push(...flattenKeys(nested, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

for (const namespace of namespaces) {
  const keysByLocale = {};

  for (const locale of locales) {
    const fileUrl = new URL(`./resources/${locale}/${namespace}.json`, import.meta.url);
    const raw = await readFile(fileUrl, 'utf8');
    keysByLocale[locale] = flattenKeys(JSON.parse(raw)).sort();
  }

  assert.deepEqual(
    keysByLocale['zh-CN'],
    keysByLocale['en-US'],
    `Key mismatch in namespace "${namespace}"`,
  );
}

console.log('i18n resource symmetry OK');
