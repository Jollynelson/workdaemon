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
