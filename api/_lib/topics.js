// Keyword-based topic tag extraction (no vector DB needed). Single source of
// truth — used by chat.js (per-turn interaction logging + knowledge-gap
// detection) and brain.js (hunt-engine scans). Was previously duplicated in
// both files and starting to drift.

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','can','may','might',
  'what','where','when','how','why','who','which','that','this','these',
  'those','for','and','but','or','nor','yet','so','if','while','with',
  'at','by','from','to','in','on','about','just','my','our','your','their',
  'its','we','they','you','he','she','it','i','need','want','help','know',
  'think','tell','make','get','give','show','find','look','feel','seem',
]);

export function extractTopicTags(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 8);
}
