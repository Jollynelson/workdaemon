// Token metering — records one row per LLM call into token_usage, feeding the
// Overview "Token Usage" widget (IA §9). Best-effort and FIRE-AND-FORGET: it
// makes its own admin client, never throws, and never blocks a model response.
// Counts are exact when the provider returns `usage`, else estimated (chars/4).
import { adminClient } from './supabase.js';

export const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);

export function recordUsage({ workspaceId, userId, provider, model, promptText, completionText, usage }) {
  if (!workspaceId) return; // nothing to attribute it to
  const prompt = usage?.prompt_tokens ?? estimateTokens(promptText);
  const completion = usage?.completion_tokens ?? estimateTokens(completionText);
  const total = usage?.total_tokens ?? (prompt + completion);
  if (!total) return;
  (async () => {
    try {
      await adminClient().from('token_usage').insert({
        workspace_id: workspaceId,
        user_id: userId || null,
        provider: provider || null,
        model: model || null,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
      });
    } catch (e) { console.warn('[metering]', e.message); }
  })();
}
