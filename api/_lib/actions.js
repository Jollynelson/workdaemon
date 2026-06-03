// Executable write-actions (FINAL §15 / Master §11 — the daemon ACTING on real
// data, not just reading). Each action names the provider it needs connected, a
// minimum permission level, a runner, and a human description for the confirm/
// audit trail. Reads go anywhere; writes are allow-listed here and gated.
import * as slack from './connectors/slack.js';

const LEVEL_RANK = { junior: 1, manager: 2, director: 3, executive: 4 };

export const ACTIONS = {
  'slack.post': {
    provider: 'slack',
    label: 'Post a Slack message',
    minLevel: 2,                       // L2: assistant — runs only on explicit confirm
    describe: (p) => `Post to ${p?.channel || '(channel)'}: “${(p?.text || '').slice(0, 100)}”`,
    run: async (token, p) => {
      if (!p?.channel || !p?.text) throw new Error('channel and text are required');
      const r = await slack.sendChannelMessage(token, { channel: p.channel, text: p.text });
      return { ts: r?.ts || null, channel: p.channel };
    },
  },
  'slack.react': {
    provider: 'slack',
    label: 'Add a Slack reaction',
    minLevel: 2,
    describe: (p) => `React :${p?.emoji || 'eyes'}: on a message in ${p?.channel || '(channel)'}`,
    run: async (token, p) => {
      if (!p?.channel || !p?.timestamp) throw new Error('channel and timestamp required');
      return slack.addReaction ? slack.addReaction(token, p.channel, p.timestamp, p.emoji || 'eyes') : Promise.reject(new Error('reaction unsupported'));
    },
  },
};

export function meetsLevel(accessLevel, minLevel) {
  return (LEVEL_RANK[accessLevel] || 1) >= minLevel;
}
