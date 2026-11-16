/**
 * Real-composition smoke: import the published entry point into an actual
 * dsh 0.2.2-rc.3 Cordis app, mount the web seam from `@deepseek-ai/dsh-web`,
 * and prove this plugin registers its provider into that live registry.
 *
 * Syntax-only checks cannot catch a renamed host API; this test fails with
 * ERR_MODULE_NOT_FOUND / missing-service errors instead. It never hits the
 * network: the configured custom server has no tool name, so the provider
 * throws its own deterministic pre-connect error after being selected.
 *
 * The registry assertions follow the rc.3 seam: `listProviders()` lists
 * `{ id, title?, description? }` entries and each committed registration or
 * disposal emits `web/providers-changed`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web';
import * as plugin from '../lib/index.js';

const pluginConfig = {
  defaultServer: 'smoke',
  servers: [
    { id: 'smoke', kind: 'custom', transport: 'http', url: 'http://127.0.0.1:1/mcp', toolName: '' },
  ],
};

test('plugin loads on dsh 0.2.2-rc.3 and registers its search provider', async () => {
  const ctx = new Context();
  const webFiber = await ctx.plugin(WebRuntime, { searchProvider: 'search-mcp' });
  try {
    assert.equal(typeof ctx.web.registerSearchProvider, 'function');

    // rc.3 added the provider picker: the live registry exposes its entries and
    // announces every committed change, so these assertions fail if the plugin
    // silently stops registering (or stops carrying its picker metadata).
    let changes = 0;
    ctx.on('web/providers-changed', () => {
      changes += 1;
    });

    const pluginFiber = await ctx.plugin(plugin, pluginConfig);
    try {
      assert.equal(plugin.name, 'search-mcp');
      assert.deepEqual(plugin.inject, ['web']);
      assert.equal(changes, 1);
      assert.deepEqual(ctx.web.listProviders().search, [
        {
          id: 'search-mcp',
          title: 'Search MCP',
          description: {
            en: 'Searches through the search MCP server configured in this plugin. Results, charges, and reachable sources are set by that server.',
            zh: '通过本插件中配置的搜索 MCP 服务器执行搜索。结果数量、费用与可访问来源由该服务器决定。',
          },
        },
      ]);

      // `ctx.web.search` resolves the provider through the live registry at call
      // time. A missing registration would surface as a selection error; the
      // provider's own "no MCP tool name" error proves this plugin answered.
      await assert.rejects(ctx.web.search({ query: 'smoke' }), (err) => {
        assert.ok(err instanceof WebError);
        assert.equal(err.code, 'WEB_PROVIDER_ERROR');
        assert.match(err.message, /no MCP tool name/);
        return true;
      });
    } finally {
      await pluginFiber.dispose();
    }

    // Disposal unregisters the provider through the calling fiber's effect.
    assert.deepEqual(ctx.web.listProviders().search, []);
    assert.equal(changes, 2);
  } finally {
    await webFiber.dispose();
  }
});
