import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('package exports resolve and RC2 dependencies stay pinned', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.browser.js');
  assert.equal(pkg.engines.node, '>=20');

  for (const name of [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-web',
  ]) {
    assert.equal(pkg.dependencies[name], '0.1.1-rc.2');
  }
  assert.equal(pkg.dependencies['@deepseek-ai/schemastery'], '3.18.1');
  assert.equal(pkg.dependencies.undici, '6.28.0');
  assert.equal(pkg.dependencies['ipaddr.js'], '2.5.0');
  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.30.0');
});

test('RC2 browser bundle uses keyed settings slot and credential migration', async () => {
  const client = await read('lib/client.browser.js');
  assert.match(client, /name: "settings\.plugin\.item",\s+key: NS,/);
  assert.doesNotMatch(client, /name: "settings\.plugin\.item",\s+id:/);
  assert.match(client, /api\.settings\.describe\(\{\}\)/);
  assert.match(client, /api\.credentials\.describe\(\{ refs: refs\.slice\(index, index \+ CREDENTIAL_DESCRIBE_BATCH_SIZE\) \}\)/);
  assert.match(client, /api\.credentials\.set\(\{ ref, value \}\)/);
  assert.match(client, /credentials\/reference-updated/);
  assert.match(client, /CREDENTIAL_DESCRIBE_BATCH_SIZE = 64/);
  assert.match(client, /api\.credentials\.unset\(\{ ref \}\)/);
  assert.match(client, /rollbackSettingsWrites/);
  assert.match(client, /legacyKeyBlocked/);
  assert.match(client, /deepEqualJson\(current\[field\], value\)/);
});

test('known providers are CDKey-only while custom keeps advanced fields', async () => {
  const client = await read('lib/client.browser.js');
  const catalog = client.slice(client.indexOf('const CATALOG = {'), client.indexOf('const KIND_OPTIONS'));
  assert.doesNotMatch(catalog, /https?:\/\//);
  assert.doesNotMatch(catalog, /toolName|authParam|transport/);
  assert.match(client, /const known = row\.kind !== "custom"/);
  assert.match(client, /children: known \? \[/);
  assert.match(client, /No endpoint is required for known providers/);
  assert.match(client, /已知提供商不需要填写端点链接/);
  assert.match(client, /kind, apiKey: "", apiKeyEnv: ""/);
});

test('HTTP transport pins DNS and applies one guarded fetch to every SDK request', async () => {
  const transport = await read('lib/client.js');
  assert.match(transport, /validateHttpEndpoint\(server\.url, \{ signal \}\)/);
  assert.match(transport, /new Agent\(\{[\s\S]*connect: \{ lookup: validated\.lookup \}/);
  assert.match(transport, /requestUrl\.origin !== expectedOrigin/);
  assert.match(transport, /dispatcher: agent/);
  assert.match(transport, /redirect: 'error'/);
  assert.match(transport, /fetch: secureFetch/);
  assert.match(transport, /await client\.close\(\)[\s\S]*await runtime\?\.close\(\)/);
  assert.doesNotMatch(transport, /new URL\(server\.url\)[\s\S]*new StreamableHTTPClientTransport\(url, \{\s*requestInit:/);
});
test('bundle replaces built-in search and leaves default row endpoint-free', async () => {
  const patch = await read('cordis.patch.yml');
  assert.match(patch, /searchProvider: search-mcp/);
  assert.match(patch, /- id: web-search-deepseek\s+disabled: true/);
  assert.match(patch, /- id: tool-web\s+disabled: false/);
  assert.match(patch, /fetch: false/);
  assert.match(patch, /searchMaxResults: 50/);
  assert.match(patch, /searchMaxQueries: 4/);
  const defaultRow = patch.slice(patch.indexOf('- id: tavily'), patch.indexOf('- id: web'));
  assert.doesNotMatch(defaultRow, /url:|toolName:|authParam:|transport:/);
});
