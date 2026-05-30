import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('./ProviderEditor.tsx', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

const handleTestMatch = source.match(
  /const handleTest = async \(\) => \{([\s\S]*?)\n  \};\n\n  const handleClone/,
);

assert.ok(handleTestMatch, 'ProviderEditor handleTest implementation should be present');

const handleTestBody = handleTestMatch[1];
const validateMatch = /await\s+form\.validateFields\(\s*\[\s*['"]customParams['"]\s*\]\s*\)/.exec(
  handleTestBody,
);
const getFieldsIndex = handleTestBody.indexOf('form.getFieldsValue()');
const persistIndex = handleTestBody.indexOf('await persistProvider(');

assert.notEqual(
  validateMatch,
  null,
  'Test connection should validate customParams before reading raw form values',
);
assert.ok(getFieldsIndex >= 0, 'Test connection should read form values');
assert.ok(persistIndex >= 0, 'Test connection should persist editable providers before testing');
assert.ok(
  validateMatch.index < getFieldsIndex,
  'Test connection should validate customParams before form.getFieldsValue()',
);
assert.ok(
  validateMatch.index < persistIndex,
  'Test connection should validate customParams before persistProvider()',
);

console.log('ProviderEditor.test.mjs: ok');
