/**
 * dsh-search-mcp — browser half (0.1.2-rc.1 rewrite).
 *
 * Registers one card into Settings → Plugins → configurable tab, keyed by the
 * `search-mcp` settings namespace the host half registers through the
 * post-0.1.2 owner seam (`ctx.settings.register`). The card binds that
 * namespace through `ctx.settingsScope` and edits it field-by-field:
 * defaultServer / maxResults / searchTimeoutMs plus the servers list.
 *
 * Known provider kinds stay connection-opaque (identity + key + result
 * limit only); `custom` rows expose transport, endpoint/command, auth and
 * tool-name fields. API keys are write-only: the redacted settings wire
 * never returns them, so an empty input means "keep the stored value".
 */
import { createElement as h, useEffect, useReducer } from 'react';

const NS = 'dsh-search-mcp';

export const name = NS;

/** Required client services (rc.1 faces). */
export const inject = ['slots', 'locale', 'settingsScope'];

const locales = {
  zh: {
    title: '联网搜索 MCP',
    summary: '用搜索类 MCP 服务替换内置网页搜索；至少配置一个服务器后 web_search 才可用。',
    status: '已配置 {count} 个搜索服务器',
    noServers: '还没有配置搜索服务器：先点下方提供商按钮添加一个。',
    defaultServer: '默认服务器',
    defaultServerHint: '留空 = 使用列表中的第一个。',
    maxResults: '结果数上限',
    searchTimeoutSec: '搜索超时（秒）',
    servers: '服务器列表',
    addServer: '添加服务器',
    kind: '提供商',
    custom: '自定义',
    id: '名称 (id)',
    transport: '传输方式',
    url: '端点 URL',
    command: '启动命令',
    args: '参数 (JSON 数组)',
    apiKey: 'API Key（留空保持不变）',
    apiKeyEnv: 'API Key 环境变量引用',
    authStyle: '认证方式',
    authParam: '认证参数名',
    authPrefix: '认证前缀',
    toolName: 'MCP 工具名',
    perServerMaxResults: '单服务器结果上限',
    delete: '删除',
    needsKey: '此提供商需要 API Key。',
    keyEnvHint: '例如 {hint}',
    saveError: '保存失败：{message}',
    saving: '保存中…',
    unavailable: '无法读取 search-mcp 设置（宿主未公开该命名空间）。',
    loading: '加载中…',
    'buttons.tavily': 'Tavily',
    'buttons.brave': 'Brave',
    'buttons.exa': 'Exa',
    'buttons.perplexity': 'Perplexity',
    'buttons.duckduckgo': 'DuckDuckGo',
  },
  en: {
    title: 'Web Search MCP',
    summary: 'Replaces the built-in web search with search MCP servers; web_search works once at least one server is configured.',
    status: '{count} search server(s) configured',
    noServers: 'No search servers configured yet — click a provider button below to add one.',
    defaultServer: 'Default server',
    defaultServerHint: 'Empty = the first entry in the list.',
    maxResults: 'Result limit',
    searchTimeoutSec: 'Search timeout (seconds)',
    servers: 'Servers',
    addServer: 'Add server',
    kind: 'Provider',
    custom: 'Custom',
    id: 'Name (id)',
    transport: 'Transport',
    url: 'Endpoint URL',
    command: 'Command',
    args: 'Arguments (JSON array)',
    apiKey: 'API key (empty keeps the stored value)',
    apiKeyEnv: 'API key env reference',
    authStyle: 'Auth style',
    authParam: 'Auth param',
    authPrefix: 'Auth prefix',
    toolName: 'MCP tool name',
    perServerMaxResults: 'Per-server result limit',
    delete: 'Delete',
    needsKey: 'This provider requires an API key.',
    keyEnvHint: 'e.g. {hint}',
    saveError: 'Save failed: {message}',
    saving: 'Saving…',
    unavailable: 'Cannot read the search-mcp settings (namespace not served by this host).',
    loading: 'Loading…',
    'buttons.tavily': 'Tavily',
    'buttons.brave': 'Brave',
    'buttons.exa': 'Exa',
    'buttons.perplexity': 'Perplexity',
    'buttons.duckduckgo': 'DuckDuckGo',
  },
};

/** Connection-opaque provider facts for the browser editor (mirror of lib/catalog.js, no endpoints). */
const CATALOG = {
  tavily: { keyEnvHint: 'TAVILY_API_KEY', needsKey: true },
  brave: { keyEnvHint: 'BRAVE_API_KEY', needsKey: true },
  exa: { keyEnvHint: 'EXA_API_KEY', needsKey: true },
  perplexity: { keyEnvHint: 'PERPLEXITY_API_KEY', needsKey: true },
  duckduckgo: { keyEnvHint: '', needsKey: false },
};

const KNOWN_KINDS = Object.keys(CATALOG);

/** Deep JSON equality used to skip no-op writes. */
function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Owner-side controller: one reactive snapshot plus serialized writes. */
class CardController {
  constructor(scope) {
    this.scope = scope;
    this.listeners = new Set();
    this.tasks = [];
    this.pending = false;
    this.lastError = undefined;
    this.unsubscribe = scope.subscribe(() => { this.notify(); });
  }

  notify() {
    for (const listener of this.listeners) listener(this);
  }

  getSnapshot() {
    return { snapshot: this.scope.getSnapshot(), pending: this.pending, lastError: this.lastError };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.unsubscribe();
    this.listeners.clear();
  }

  enqueue(work) {
    const task = this.tasks[this.tasks.length - 1] ?? Promise.resolve();
    const next = task.then(work, work);
    this.tasks.push(next);
    this.pending = true;
    this.lastError = undefined;
    this.notify();
    const settle = (error) => {
      if (error !== undefined) {
        this.lastError = error instanceof Error ? error : new Error(String(error));
      }
      this.pending = false;
      this.notify();
    };
    next.then(() => settle(undefined), settle);
    return next;
  }

  /** Write one top-level scalar field; an undefined/empty string clears it. */
  setField(field, value) {
    const snapshot = this.scope.getSnapshot();
    if (snapshot.status !== 'ready') return Promise.resolve();
    const current = snapshot.value?.[field];
    if (value === '' || value === undefined || value === null) {
      if (current === '' || current === undefined || current === null) return Promise.resolve();
      return this.enqueue(() => this.scope.unset(field));
    }
    if (deepEqualJson(current, value)) return Promise.resolve();
    return this.enqueue(() => this.scope.set(field, value));
  }

  /** Replace the whole servers array; equal snaps skip the write. */
  setServers(next) {
    const snapshot = this.scope.getSnapshot();
    if (snapshot.status !== 'ready') return Promise.resolve();
    const currentServers = snapshot.value?.servers ?? [];
    if (deepEqualJson(currentServers, next)) return Promise.resolve();
    return this.enqueue(() => this.scope.set('servers', next));
  }

  inject() {
    return {
      controller: this,
      catalog: CATALOG,
      knownKinds: KNOWN_KINDS,
    };
  }
}

const inputStyle = {
  boxSizing: 'border-box',
  width: '100%',
  height: 28,
  padding: '2px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
  background: 'var(--dsw-alias-bg-module-platform, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: 13,
};

const labelStyle = { display: 'block', fontSize: 12, opacity: 0.75, marginBottom: 2 };

function Field({ label, hint, children }) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    h('span', { style: labelStyle }, label),
    children,
    hint !== undefined && hint !== '' ? h('span', { style: { fontSize: 11, opacity: 0.55 } }, hint) : null,
  );
}

const input = (props) => h('input', { style: inputStyle, ...props });
const select = (props) => h('select', { style: inputStyle, ...props });

/** One server row editor. */
function ServerRow({ t, controller, server, index, catalog, knownKinds, onChange, onDelete }) {
  const isCustom = server.kind === 'custom';
  const preset = catalog[server.kind] ?? { needsKey: false, keyEnvHint: '' };
  const set = (field, value) => {
    const next = { ...server, [field]: value };
    onChange(index, next);
  };
  const setMax = (value) => {
    const next = { ...server };
    if (value === '') delete next.maxResults;
    else next.maxResults = Number(value);
    onChange(index, next);
  };
  const keyHint = server.apiKeyEnv === '' ? (preset.keyEnvHint ?? '') : '';

  return h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 10,
      padding: 12,
      margin: '10px 0',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
      background: 'var(--dsw-alias-bg-module, rgba(255,255,255,.02))',
    },
  },
    h(Field, { label: t('kind') },
      select({
        value: server.kind,
        onChange: (event) => {
          const kind = event.target.value;
          const entry = catalog[kind] ?? { needsKey: false, keyEnvHint: '' };
          onChange(index, {
            id: kind === 'custom' && server.kind !== 'custom' ? server.id : (server.id || kind),
            kind,
            apiKey: '',
            apiKeyEnv: entry.keyEnvHint ?? '',
            maxResults: server.maxResults,
            ...(kind === 'custom' ? {
              transport: 'http',
              url: server.url ?? '',
              command: server.command ?? '',
              args: server.args ?? [],
              authStyle: 'query',
              authParam: server.authParam ?? '',
              authPrefix: server.authPrefix ?? '',
              toolName: server.toolName ?? '',
            } : {}),
          });
        },
        children: [
          ...knownKinds.map((kind) => h('option', { key: kind, value: kind }, t(`buttons.${kind}`) ?? kind)),
          h('option', { value: 'custom' }, t('custom')),
        ],
      })),
    h(Field, { label: t('id') },
      input({ value: server.id ?? '', placeholder: server.kind, onChange: (event) => set('id', event.target.value) })),
    h(Field, {
      label: t('apiKey'),
      hint: preset.needsKey ? t('needsKey') : '',
    },
      input({
        type: 'password',
        value: server.apiKey ?? '',
        placeholder: '••••••••',
        onChange: (event) => set('apiKey', event.target.value),
      })),
    h(Field, {
      label: t('apiKeyEnv'),
      hint: t('keyEnvHint', { hint: keyHint }),
    },
      input({ value: server.apiKeyEnv ?? '', onChange: (event) => set('apiKeyEnv', event.target.value) })),
    h(Field, { label: t('perServerMaxResults') },
      input({
        type: 'number',
        min: 1,
        max: 50,
        value: server.maxResults ?? '',
        onChange: (event) => setMax(event.target.value),
      })),
    ...(isCustom ? [
      h(Field, { label: t('transport') },
        select({
          value: server.transport ?? 'http',
          onChange: (event) => set('transport', event.target.value),
          children: [
            h('option', { value: 'http' }, 'HTTP'),
            h('option', { value: 'stdio' }, 'stdio'),
          ],
        })),
      h(Field, { label: t('url') },
        input({ value: server.url ?? '', onChange: (event) => set('url', event.target.value) })),
      h(Field, { label: t('command') },
        input({ value: server.command ?? '', onChange: (event) => set('command', event.target.value) })),
      h(Field, {
        label: t('args'),
        hint: '["-y", "@org/server"]',
      },
        input({
          value: Array.isArray(server.args) ? JSON.stringify(server.args) : '[]',
          onChange: (event) => {
            try {
              const parsed = JSON.parse(event.target.value);
              if (!Array.isArray(parsed)) throw new Error('not an array');
              set('args', parsed);
            } catch {
              // Invalid JSON keeps the previous value until a valid one arrives.
            }
          },
        })),
      h(Field, { label: t('authStyle') },
        select({
          value: server.authStyle ?? 'query',
          onChange: (event) => set('authStyle', event.target.value),
          children: [
            h('option', { value: 'query' }, 'query'),
            h('option', { value: 'header' }, 'header'),
            h('option', { value: 'env' }, 'env'),
          ],
        })),
      h(Field, { label: t('authParam') },
        input({ value: server.authParam ?? '', onChange: (event) => set('authParam', event.target.value) })),
      h(Field, { label: t('authPrefix') },
        input({ value: server.authPrefix ?? '', onChange: (event) => set('authPrefix', event.target.value) })),
      h(Field, { label: t('toolName') },
        input({ value: server.toolName ?? '', onChange: (event) => set('toolName', event.target.value) })),
    ] : []),
    h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' } },
      h('button', {
        type: 'button',
        onClick: onDelete,
        style: {
          height: 28,
          padding: '0 12px',
          borderRadius: 6,
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary, inherit)',
          cursor: 'pointer',
        },
      }, t('delete'))),
  );
}

/** The settings card rendered into the plugins tab. */
function SearchMcpCard({ t, controller, catalog, knownKinds }) {
  const [, force] = useReducer((state) => state + 1, 0);
  useEffect(() => controller.subscribe(force), [controller]);

  const snap = controller.getSnapshot();
  const { snapshot, pending, lastError } = snap;
  if (snapshot.status === 'loading') return h('div', null, t('loading'));
  if (snapshot.status === 'unavailable') return h('div', null, t('unavailable'));

  const value = snapshot.value ?? {};
  const servers = Array.isArray(value.servers) ? value.servers : [];

  const commitServers = (next) => {
    // API keys are write-only: the redacted wire never returns a stored key,
    // so an empty input must DROP the field (keeps the stored value) rather
    // than overwrite it with an empty string.
    const committed = next.map((server, index) => {
      const previous = servers[index];
      const merged = { ...server };
      if (merged.apiKey === '') {
        delete merged.apiKey;
        void previous;
      }
      return Object.fromEntries(Object.entries(merged).filter(([key2, entry]) => entry !== undefined));
    });
    controller.setServers(committed);
  };

  const updateServer = (index, next) => {
    const copy = [...servers];
    copy[index] = next;
    commitServers(copy);
  };

  const deleteServer = (index) => {
    commitServers(servers.filter((entry, i) => i !== index));
  };

  const addServer = (kind) => {
    const entry = catalog[kind] ?? {};
    const row = {
      id: kind === 'custom' ? 'custom' : kind,
      kind,
      apiKey: '',
      apiKeyEnv: entry.keyEnvHint ?? '',
      ...(kind === 'custom' ? {
        transport: 'http',
        url: '',
        command: '',
        args: [],
        authStyle: 'query',
        authParam: '',
        authPrefix: '',
        toolName: '',
      } : {}),
    };
    commitServers([...servers, row]);
  };

  const safeTimeout = (value) => {
    const ms = Number(value.searchTimeoutMs);
    if (!Number.isFinite(ms)) return 30;
    return Math.round(ms / 1000);
  };

  const timeoutSaved = (snapshot.user && typeof snapshot.user.searchTimeoutMs === 'number')
    ? Math.round(snapshot.user.searchTimeoutMs / 1000)
    : safeTimeout(value);

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 0 12px' } },
    h('div', { style: { fontSize: 12, opacity: 0.7 } }, t('summary')),
    h('div', {
      style: {
        fontSize: 12,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-module-platform, rgba(255,255,255,.03))',
      },
    }, servers.length > 0 ? t('status', { count: servers.length }) : h('span', { style: { color: 'var(--dsw-alias-warning, #c96f2d)' } }, t('noServers'))),
    h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 10,
      },
    },
      h(Field, { label: t('defaultServer'), hint: t('defaultServerHint') },
        select({
          value: value.defaultServer ?? '',
          onChange: (event) => controller.setField('defaultServer', event.target.value),
          children: [
            h('option', { value: '' }, `— ${t('defaultServerHint')} —`),
            ...servers.map((server) => h('option', { key: server.id || server.kind, value: server.id }, server.id || server.kind)),
          ],
        })),
      h(Field, { label: t('maxResults') },
        input({
          type: 'number',
          min: 1,
          max: 50,
          value: value.maxResults ?? 8,
          onChange: (event) => controller.setField('maxResults', event.target.value === '' ? '' : Number(event.target.value)),
        })),
      h(Field, { label: t('searchTimeoutSec') },
        input({
          type: 'number',
          min: 1,
          value: timeoutSaved,
          onChange: (event) => {
            const seconds = Number(event.target.value);
            controller.setField('searchTimeoutMs', event.target.value === '' ? '' : Math.max(1000, seconds * 1000));
          },
        })),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 12, opacity: 0.7 } }, `${t('addServer')}:`),
      ...[...knownKinds, 'custom'].map((kind) =>
        h('button', {
          key: kind,
          type: 'button',
          onClick: () => addServer(kind),
          style: {
            height: 28,
            padding: '0 12px',
            borderRadius: 14,
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
            background: 'var(--dsw-alias-bg-module-platform, rgba(255,255,255,.03))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            cursor: 'pointer',
          },
        }, kind === 'custom' ? t('custom') : (t(`buttons.${kind}`) ?? kind))),
    ),
    servers.length > 0 ? h('div', null,
      servers.map((server, index) =>
        h(ServerRow, {
          key: `${server.id ?? index}:${server.kind}:${index}`,
          t, controller, server, index, catalog, knownKinds,
          onChange: updateServer,
          onDelete: () => deleteServer(index),
        })),
    ) : null,
    pending ? h('div', { style: { fontSize: 12, opacity: 0.6 } }, t('saving')) : null,
    lastError !== undefined ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-danger, #c0392b)' } }, t('saveError', { message: lastError.message })) : null,
  );
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, locales), `${NS}: dictionaries`);
  const t = ctx.locale.bind(NS);
  const controller = new CardController(ctx.settingsScope.bind({ namespace: NS }));
  ctx.effect(() => () => controller.dispose(), `${NS}: settings card`);
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      locale: NS,
      inject: () => controller.inject(),
    }, (props) => h(SearchMcpCard, { ...props, t }));
  });
}