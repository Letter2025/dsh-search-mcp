/**
 * Real-composition smoke: import the published entry point into an actual
 * dsh 0.2.2-rc.1 Cordis app, mount the web seam from `@deepseek-ai/dsh-web`,
 * and prove this plugin registers its provider into that live registry.
 *
 * Syntax-only checks cannot catch a renamed host API; this test fails with
 * ERR_MODULE_NOT_FOUND / missing-service errors instead. It never hits the
 * network: the configured custom server has no tool name, so the provider
 * throws its own deterministic pre-connect error after being selected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web';
import * as plugin from '../lib/index.js';

test('plugin loads on dsh 0.2.2-rc.1 and registers its search provider', async () => {
  const ctx = new Context();
  const webFiber = await ctx.plugin(WebRuntime, { searchProvider: 'search-mcp' });
  assert.equal(typeof ctx.web.registerSearchProvider, 'function');

  const pluginFiber = await ctx.plugin(plugin, {
    defaultServer: 'smoke',
    servers: [
      { id: 'smoke', kind: 'custom', transport: 'http', url: 'http://127.0.0.1:1/mcp', toolName: '' },
    ],
  });
  assert.equal(plugin.name, 'search-mcp');
  assert.deepEqual(plugin.inject, ['web']);

  // `ctx.web.search` resolves the provider through the live registry at call
  // time. A missing registration would surface as a selection error; the
  // provider's own "no MCP tool name" error proves this plugin answered.
  await assert.rejects(ctx.web.search({ query: 'smoke' }), (err) => {
    assert.ok(err instanceof WebError);
    assert.equal(err.code, 'WEB_PROVIDER_ERROR');
    assert.match(err.message, /no MCP tool name/);
    return true;
  });

  await pluginFiber.dispose();
  await webFiber.dispose();
});
