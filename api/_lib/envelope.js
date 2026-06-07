// Daemon response envelope parsing — extracted from api/chat.js so it is unit-
// testable and reusable. Turns a model's text into a { blocks, suggestions } object,
// recovering from the ways models break JSON (truncation, fences, prose wrapping,
// one malformed block). salvageEnvelope lives in scrub.js (single source of truth).
import { salvageEnvelope } from './scrub.js';

// Repair truncated/unterminated JSON: the model sometimes drops the final brackets
// on a large block (e.g. a kanban). Walk the text tracking string state and bracket
// depth, append the missing closers, trim a dangling key/comma, and retry from the
// last closed bracket if needed.
export function repairJsonEnvelope(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let s = text.slice(start);
  for (let attempt = 0; attempt < 5 && s.length > 1; attempt++) {
    let inStr = false, esc = false;
    const stack = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
    let repaired = inStr ? s + '"' : s;
    repaired = repaired.replace(/[,:]\s*$/, ''); // drop a dangling comma/colon with no value
    for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === '{' ? '}' : ']';
    try { const p = JSON.parse(repaired); if (p && p.blocks) return p; } catch {}
    // Truncation may have landed mid-element — trim back to the last closer and retry.
    const lastClose = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (lastClose <= 0) break;
    s = s.slice(0, lastClose + 1);
  }
  return null;
}

// Parse a model response into { blocks, suggestions }. Tries, in order: direct
// parse, fenced ```json, the first balanced top-level object, truncation repair,
// per-block salvage, and finally wraps the raw text as a single text block.
export function parseJsonResponse(text) {
  if (!text) return { blocks: [{ type: 'text', md: 'No response.' }], suggestions: [] };

  let t = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

  try { const p = JSON.parse(t); if (p.blocks) return p; } catch {}

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { const p = JSON.parse(fence[1].trim()); if (p.blocks) return p; } catch {} }

  let depth = 0, start = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (t[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { const p = JSON.parse(t.slice(start, i + 1)); if (p.blocks) return p; } catch {}
        start = -1;
      }
    }
  }

  // Recover unclosed/truncated JSON.
  const repaired = repairJsonEnvelope(t);
  if (repaired) return repaired;

  // Salvage whatever blocks individually parse (one bad block won't dump raw JSON).
  const salvaged = salvageEnvelope(t);
  if (salvaged) return salvaged;

  return { blocks: [{ type: 'text', md: text }], suggestions: [] };
}
