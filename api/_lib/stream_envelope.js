// Incremental daemon-envelope parser — the heart of streaming chat.
// Feed it raw model text chunks; it emits UI events as the JSON envelope forms:
//   onDelta(str)   — unescaped fragment of the CURRENT text block's "md" value
//                    (live typing for prose, the ChatGPT feel)
//   onBlock(block) — each completed block object from the top-level "blocks"
//                    array (structured cards appear whole)
// This parser only powers the PROGRESSIVE display. The authoritative final
// envelope is still parseJsonResponse(fullText) — identical to the
// non-streaming path — so a parser miss can degrade liveness, never quality.
//
// Handles: strings with escapes (\" \\ \n \t \r \uXXXX) split across chunk
// boundaries, nested objects/arrays inside blocks (kanban, charts), whitespace
// variants, and a leading ```json fence. Ignores everything after the blocks
// array closes (suggestions/memories ride only in the final envelope).

const ESC_MAP = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

export function createEnvelopeStream({ onDelta = () => {}, onBlock = () => {} } = {}) {
  let buf = '';          // everything received so far
  let pos = 0;           // scan cursor (chars before pos are fully consumed)
  let phase = 'seek';    // seek (find "blocks":[) → array → done
  let keyBuf = null;     // accumulating a key string (depth-1 of current element)
  let lastKey = null;    // last completed key at depth 1 of the element
  let elemStart = -1;    // buf index of the current element's '{'
  let depth = 0;         // brace/bracket depth INSIDE the current element
  let inStr = false;     // inside any string
  let esc = false;       // previous char was a backslash
  let uni = null;        // collecting \uXXXX hex digits
  let strIsKey = false;  // current string is an object key (depth-1)
  let elemType = null;   // value of the element's "type" field once seen
  let valBuf = null;     // accumulating a depth-1 value string (for "type")
  let mdLive = false;    // currently inside the md string of a text-ish block
  let pending = '';      // decoded md chars awaiting emission this feed()

  // Decode one in-string char (escape-aware); returns decoded char or '' if the
  // char is part of an incomplete escape sequence.
  function decodeChar(ch) {
    if (uni !== null) {
      uni += ch;
      if (uni.length === 4) {
        const code = parseInt(uni, 16);
        uni = null;
        return Number.isNaN(code) ? '' : String.fromCharCode(code);
      }
      return '';
    }
    if (esc) {
      esc = false;
      if (ch === 'u') { uni = ''; return ''; }
      return ESC_MAP[ch] ?? ch;
    }
    if (ch === '\\') { esc = true; return ''; }
    return ch;
  }

  function resetElement() {
    elemStart = -1; depth = 0; inStr = false; esc = false; uni = null;
    keyBuf = null; lastKey = null; strIsKey = false; elemType = null;
    valBuf = null; mdLive = false;
  }

  function feed(chunk) {
    if (phase === 'done' || !chunk) return;
    buf += chunk;

    if (phase === 'seek') {
      // Find the opening of the blocks array; tolerate a ```json fence/prose lead-in.
      const m = buf.slice(pos).match(/"blocks"\s*:\s*\[/);
      if (!m) { pos = Math.max(0, buf.length - 16); return; } // keep a tail for split matches
      pos = pos + buf.slice(pos).indexOf(m[0]) + m[0].length;
      phase = 'array';
      resetElement();
    }

    for (let i = pos; i < buf.length; i++) {
      const ch = buf[i];

      // Between elements (no current element open).
      if (elemStart === -1) {
        if (ch === '{') { elemStart = i; depth = 1; }
        else if (ch === ']') { phase = 'done'; pos = i + 1; flush(); return; }
        continue;
      }

      // Inside an element.
      if (inStr) {
        // String content — decode for the buffers that care.
        if (!esc && uni === null && ch === '"') {
          // String closes.
          inStr = false;
          if (strIsKey) { lastKey = keyBuf; keyBuf = null; }
          else if (valBuf !== null) { if (lastKey === 'type') elemType = valBuf; valBuf = null; }
          else if (mdLive) mdLive = false;
          continue;
        }
        const dec = decodeChar(ch);
        if (dec) {
          if (strIsKey) keyBuf += dec;
          else if (valBuf !== null) valBuf += dec;
          else if (mdLive) pending += dec;
        }
        continue;
      }

      if (ch === '"') {
        inStr = true; esc = false; uni = null;
        // A string at depth 1 right after '{' or ',' is a KEY; otherwise a value.
        if (depth === 1) {
          const prev = lastNonWs(buf, i - 1, elemStart);
          if (prev === '{' || prev === ',') { strIsKey = true; keyBuf = ''; continue; }
        }
        strIsKey = false;
        if (depth === 1 && lastKey === 'type') { valBuf = ''; continue; }
        if (depth === 1 && lastKey === 'md' && (elemType === 'text' || elemType === null)) {
          // Live-stream the md value. (elemType null = "md" arrived before
          // "type" — treat as text; the completed block corrects any mismatch.)
          mdLive = true;
          continue;
        }
        continue;
      }

      if (ch === '{' || ch === '[') { depth++; continue; }
      if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0 && ch === '}') {
          // Element complete → parse and emit.
          const raw = buf.slice(elemStart, i + 1);
          flush(); // deltas for this element go out before its completed form
          try {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') onBlock(obj);
          } catch { /* malformed element — final envelope will salvage */ }
          resetElement();
        }
        continue;
      }
    }
    pos = buf.length;
    flush();
  }

  function lastNonWs(s, from, floor) {
    for (let i = from; i > floor; i--) {
      const c = s[i];
      if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') return c;
    }
    return s[floor];
  }

  function flush() {
    if (pending) { onDelta(pending); pending = ''; }
  }

  return {
    feed,
    end: flush,
    get fullText() { return buf; },
  };
}
