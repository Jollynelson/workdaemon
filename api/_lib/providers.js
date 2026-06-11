// ── AI provider dispatcher ────────────────────────────────────────────────────
// Extracted from api/chat.js so the dispatch/timeout/fallback machinery is unit-
// testable and reusable (chat handler, agents, daemons all route LLM calls the
// same way). Behavior is unchanged.
import OpenAI from 'openai';
import { assertSafeUrl } from './security.js';

// SOUL §config: the daemon's output is a strict JSON contract, so keep reasoning
// effort LOW on reasoning models — high effort makes some models emit visible
// planning notes outside the JSON (or unterminated JSON), which breaks the UI.
// Only applied to models that actually accept the param (reasoners), so it never
// 400s a normal chat model.
const REASONER_RE = /reason|reasoner|\bo1\b|\bo3\b|\bo4\b|o1-|o3-|o4-|thinking|-think/i;
export function reasoningParams(model) {
  return REASONER_RE.test(String(model || '')) ? { reasoning_effort: process.env.BRAIN_REASONING_EFFORT || 'low' } : {};
}

// Per-call wall-clock cap. The function's maxDuration is 60s; a single hung
// provider (e.g. a cold self-hosted gateway) used to block the whole turn until
// the platform killed it → 504 after minutes. Capping each call means a stall
// throws fast and the cloud fallback / configured-model retry takes over.
export const LLM_CALL_TIMEOUT_MS = Number(process.env.CHAT_LLM_TIMEOUT_MS) || 24000;
// Hermes is an AGENT runtime, not a bare LLM — a turn may run its own tool loop
// (MCP brain pulls, web). Give it more headroom than cloud chat models, while
// still leaving room inside the 50s phase budget for the DeepSeek fallback.
const HERMES_CALL_TIMEOUT_MS = Number(process.env.HERMES_LLM_TIMEOUT_MS) || 35000;

export function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export function callProvider(cfg, sys, messages, identity = {}) {
  const ms = cfg.provider === 'hermes' ? HERMES_CALL_TIMEOUT_MS : LLM_CALL_TIMEOUT_MS;
  return withTimeout(callProviderInner(cfg, sys, messages, identity), ms, `provider:${cfg.provider}`);
}

// ── Streaming variant ─────────────────────────────────────────────────────────
// Same providers, same prompts, same params — but tokens arrive via onDelta as
// they generate, and the FULL text is returned at the end (callers parse it with
// the exact same parseJsonResponse as the non-streaming path, so quality is
// identical; only liveness changes). Providers without a streaming surface
// (google, modal) fall back to the regular call and emit one delta.
// Timeouts: first token gets the provider's normal call budget; after that an
// inactivity window guards a mid-stream stall (an actively-talking model is
// never killed for total duration — the caller's phase budget bounds the turn).
const STREAM_IDLE_MS = Number(process.env.CHAT_STREAM_IDLE_MS) || 15000;

export async function callProviderStream(cfg, sys, messages, identity = {}, onDelta = () => {}) {
  const { provider, api_key, endpoint, model } = cfg;
  const firstTokenMs = provider === 'hermes' ? HERMES_CALL_TIMEOUT_MS : LLM_CALL_TIMEOUT_MS;

  // OpenAI-compatible streaming (openrouter/openai/deepseek/mistral/ollama/hermes/azure).
  async function oaiStream(client, params, opts = {}) {
    const ac = new AbortController();
    let timer = setTimeout(() => ac.abort(), firstTokenMs);
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), ms); };
    try {
      const stream = await client.chat.completions.create(
        { ...params, stream: true },
        { ...opts, signal: ac.signal },
      );
      let text = '';
      for await (const ch of stream) {
        const d = ch.choices?.[0]?.delta?.content || '';
        if (d) { text += d; onDelta(d); }
        arm(STREAM_IDLE_MS);
      }
      clearTimeout(timer);
      console.log('[chat] %s STREAM text_len=%d', provider, text.length);
      return text;
    } catch (e) {
      clearTimeout(timer);
      if (ac.signal.aborted) throw new Error(`provider:${provider} stream stalled`, { cause: e });
      throw e;
    }
  }

  switch (provider) {
    case 'openrouter':
      return oaiStream(new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1', apiKey: api_key,
        defaultHeaders: { 'HTTP-Referer': 'https://workdaemon.com', 'X-Title': 'WorkDaemon' },
      }), {
        model: model || 'anthropic/claude-sonnet-4-5', max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },
      });

    case 'openai':
      return oaiStream(new OpenAI({ apiKey: api_key }), {
        model: model || 'gpt-4o', max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },
        ...reasoningParams(model),
      });

    case 'deepseek':
      return oaiStream(new OpenAI({ baseURL: (endpoint || 'https://api.deepseek.com').replace(/\/$/, ''), apiKey: api_key }), {
        model: model || 'deepseek-chat', max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },
        ...reasoningParams(model),
      });

    case 'mistral':
      return oaiStream(new OpenAI({ baseURL: 'https://api.mistral.ai/v1', apiKey: api_key }), {
        model: model || 'mistral-large-latest', max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },
      });

    case 'ollama': {
      if (!endpoint) throw new Error('Ollama provider requires an endpoint');
      const base = (await assertSafeUrl(endpoint, { allowHttp: true })).replace(/\/$/, '');
      return oaiStream(new OpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama' }), {
        model: model || 'llama3',
        messages: [{ role: 'system', content: sys }, ...messages],
      });
    }

    case 'hermes': {
      if (!endpoint) throw new Error('Hermes provider requires an endpoint (gateway API URL)');
      let base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      if (!base.endsWith('/v1')) base = `${base}/v1`;
      const headers = {};
      if (identity.workspaceId && identity.userId) {
        headers['X-Hermes-Session-Key'] = `${identity.workspaceId}:${identity.userId}`.slice(0, 256);
      }
      return oaiStream(new OpenAI({ baseURL: base, apiKey: api_key || 'hermes' }), {
        model: model || 'hermes',
        messages: [{ role: 'system', content: sys }, ...messages],
      }, { headers });
    }

    case 'azure': {
      if (!endpoint) throw new Error('Azure provider requires an endpoint');
      const base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      return oaiStream(new OpenAI({
        baseURL: `${base}/openai/deployments/${model}`, apiKey: api_key,
        defaultQuery: { 'api-version': '2024-02-15-preview' },
        defaultHeaders: { 'api-key': api_key },
      }), { model, messages: [{ role: 'system', content: sys }, ...messages] });
    }

    case 'anthropic': {
      // SSE over fetch (no SDK dependency) — content_block_delta carries text.
      const ac = new AbortController();
      let timer = setTimeout(() => ac.abort(), firstTokenMs);
      const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), ms); };
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 4096, system: sys, messages, stream: true }),
          signal: ac.signal,
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error?.message || 'Anthropic error'); }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '', text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm(STREAM_IDLE_MS);
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              const d = ev.type === 'content_block_delta' ? (ev.delta?.text || '') : '';
              if (d) { text += d; onDelta(d); }
            } catch { /* keep-alives / partial lines */ }
          }
        }
        clearTimeout(timer);
        console.log('[chat] anthropic STREAM text_len=%d', text.length);
        return text;
      } catch (e) {
        clearTimeout(timer);
        if (ac.signal.aborted) throw new Error('provider:anthropic stream stalled', { cause: e });
        throw e;
      }
    }

    // No streaming surface → regular call, one delta (UX degrades to "all at
    // once", quality identical).
    default: {
      const text = await callProvider(cfg, sys, messages, identity);
      onDelta(text);
      return text;
    }
  }
}

async function callProviderInner({ provider, api_key, endpoint, model }, sys, messages, identity = {}) {
  console.log('[chat] provider=%s model=%s', provider, model || '(default)');
  switch (provider) {

    case 'openrouter': {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: api_key,
        defaultHeaders: { 'HTTP-Referer': 'https://workdaemon.com', 'X-Title': 'WorkDaemon' },
      });
      const r = await client.chat.completions.create({
        model: model || 'anthropic/claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },  // force a valid JSON envelope
      });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] openrouter text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'anthropic': {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': api_key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: sys,
          messages,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Anthropic error');
      const textBlock = d.content?.find(b => b.type === 'text');
      console.log('[chat] anthropic stop=%s text_len=%d', d.stop_reason, textBlock?.text?.length ?? 0);
      return textBlock?.text ?? '';
    }

    case 'openai': {
      const client = new OpenAI({ apiKey: api_key });
      const r = await client.chat.completions.create({
        model: model || 'gpt-4o',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },  // force a valid JSON envelope
        ...reasoningParams(model),
      });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] openai text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'deepseek': {
      const client = new OpenAI({
        baseURL: (endpoint || 'https://api.deepseek.com').replace(/\/$/, ''),
        apiKey: api_key,
      });
      const r = await client.chat.completions.create({
        model: model || 'deepseek-chat',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },  // force a valid JSON envelope
        ...reasoningParams(model),
      });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] deepseek text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'google': {
      const mdl = model || 'gemini-2.5-flash';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${api_key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            // responseMimeType forces Gemini to emit a single valid JSON object —
            // without it Gemini sometimes emits malformed JSON (e.g. a bad
            // suggestions block) that breaks the envelope and renders raw.
            generationConfig: { thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Google error');
      const parts = d.candidates?.[0]?.content?.parts || [];
      const nonThought = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      const text = nonThought || parts.filter(p => p.text).map(p => p.text).join('');
      console.log('[chat] google parts=%d text_len=%d', parts.length, text.length);
      return text;
    }

    case 'mistral': {
      const client = new OpenAI({
        baseURL: 'https://api.mistral.ai/v1',
        apiKey: api_key,
      });
      const r = await client.chat.completions.create({
        model: model || 'mistral-large-latest',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
        response_format: { type: 'json_object' },  // force a valid JSON envelope
      });
      return r.choices[0]?.message?.content ?? '';
    }

    case 'ollama': {
      if (!endpoint) throw new Error('Ollama provider requires an endpoint');
      const base = (await assertSafeUrl(endpoint, { allowHttp: true })).replace(/\/$/, '');
      const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama' });
      const r = await client.chat.completions.create({
        model: model || 'llama3',
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
    }

    // Real Hermes Agent runtime (NousResearch) — the daemon IS a per-staff Hermes
    // agent with MCP tools + native approval gating; it does its own tool-calling,
    // so no executors. `endpoint` = that company's Hermes gateway (OpenAI-compatible
    // API server, default :8642), `api_key` = API_SERVER_KEY, `model` = the staff's
    // profile/model. See docs/specs/WorkDaemon_FINAL_BuildSpec.md (Hermes layer).
    case 'hermes': {
      if (!endpoint) throw new Error('Hermes provider requires an endpoint (gateway API URL)');
      let base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      if (!base.endsWith('/v1')) base = `${base}/v1`;
      const client = new OpenAI({ baseURL: base, apiKey: api_key || 'hermes' });
      // Per-staff memory isolation on a shared gateway: X-Hermes-Session-Key is a
      // stable per-user scope the Hermes memory provider keys on (docs:
      // features/api-server). So each staff member gets their own long-term memory
      // even though many share one gateway. Identity also rides in `sys`.
      const headers = {};
      if (identity.workspaceId && identity.userId) {
        headers['X-Hermes-Session-Key'] = `${identity.workspaceId}:${identity.userId}`.slice(0, 256);
      }
      const r = await client.chat.completions.create({
        model: model || 'hermes',
        messages: [{ role: 'system', content: sys }, ...messages],
      }, { headers });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] hermes text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'azure': {
      if (!endpoint) throw new Error('Azure provider requires an endpoint');
      const base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      const client = new OpenAI({
        baseURL: `${base}/openai/deployments/${model}`,
        apiKey: api_key,
        defaultQuery: { 'api-version': '2024-02-15-preview' },
        defaultHeaders: { 'api-key': api_key },
      });
      const r = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
    }

    // Per-company fine-tuned Hermes-3 served on Modal GPU. `endpoint` is the
    // serving FastAPI base URL, `model` carries the company_id to route to.
    // The serving layer (router.chat) handles warm/cold/Claude-fallback itself.
    case 'modal': {
      if (!endpoint) throw new Error('Modal provider requires an endpoint (serving base URL)');
      const base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      const r = await fetch(`${base}/api/serve/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(api_key ? { authorization: `Bearer ${api_key}` } : {}),
        },
        body: JSON.stringify({ company_id: model, system_prompt: sys, messages }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || 'Modal serving error');
      console.log('[chat] modal source=%s model=%s text_len=%d', d.source, d.model, (d.content ?? '').length);
      return d.content ?? '';
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
