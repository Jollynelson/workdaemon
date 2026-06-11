// Seed the GLOBAL Brain Skill Library with social-media-management + marketing
// expertise (owner directive 2026-06-11: now that the brain reads the company's
// socials, its "next training run" carries social management and marketing —
// in this architecture the skill library IS that training substrate: skills are
// injected into every relevant daemon turn and assigned to marketing-role
// daemons at onboarding). Idempotent (upsert on global slug).
//   node scripts/seed_social_skills.mjs
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import("../api/_lib/supabase.js");
const db = adminClient();

const SRC = "workdaemon-social-learning-loop";
const SKILLS = [
  { slug: "social-presence-audit", name: "Social Presence Audit", pillar: "growth", category: "marketing",
    trigger_description: "When assessing or improving the company's social media footprint.",
    tags: ["social", "marketing", "audit", "growth"],
    body: "Audit from the brain's live snapshots, never from assumption: which platforms exist, posting recency, what the bio/positioning says vs what the company actually sells. Score each platform: dead / drifting / working. The highest-leverage fix is usually ONE platform done consistently — recommend killing or parking the rest. Every recommendation names the metric it moves (followers ≠ a metric; replies, clicks, signups are)." },
  { slug: "content-calendar", name: "Content Calendar Engine", pillar: "content", category: "marketing",
    trigger_description: "When the company needs a sustainable posting rhythm or asks what to post.",
    tags: ["social", "content", "calendar", "marketing"],
    body: "Build from pillars, not one-offs: 3-4 recurring content pillars tied to what the company sells (e.g. customer wins, product education, founder POV, market commentary). Map pillars to a weekly cadence the team can actually sustain — 3 good posts/week beats 7 mediocre. Batch-draft a week at a time from real company material in the brain (wins, findings, shipped work). Every post: one idea, one hook in the first line, one CTA." },
  { slug: "platform-playbooks", name: "Platform Playbooks", pillar: "content", category: "marketing",
    trigger_description: "When drafting for a specific platform — X, LinkedIn, Instagram, TikTok, or Facebook.",
    tags: ["social", "content", "platforms"],
    body: "Write native, never cross-post verbatim. X: punchy first line, one claim per post, threads for depth. LinkedIn: first 2 lines decide the click-through — open with the outcome, write like a person not a brand, end with a question. Instagram: the visual carries it, caption adds story, hashtags ≤5 and specific. TikTok: hook in 1s, show don't tell. Facebook: community tone, longer OK. Always match the company's voice from its existing posts in the brain." },
  { slug: "brand-voice-keeper", name: "Brand Voice Keeper", pillar: "content", category: "marketing",
    trigger_description: "When writing anything public — posts, replies, announcements — keep one recognizable voice.",
    tags: ["brand", "voice", "content"],
    body: "Derive the voice from evidence: the company's website copy and existing posts in the brain (not generic 'professional yet friendly'). Write 3 voice rules from that evidence (e.g. 'plain words, short sentences, no exclamation marks') and apply them to every draft. Read the draft aloud test: if it could be any company's post, rewrite it with a specific detail only this company could say." },
  { slug: "engagement-growth-loop", name: "Engagement Growth Loop", pillar: "growth", category: "marketing",
    trigger_description: "When the goal is growing reach, followers, or inbound from social.",
    tags: ["social", "growth", "engagement"],
    body: "Growth is a loop, not a megaphone: post → engage with every reply within hours → comment meaningfully on 5-10 accounts your buyers follow → repeat. Borrow audiences: collaborate, quote, and reply to bigger accounts in the niche with genuine substance. Measure weekly: which post earned real conversation? Make more of that. Never buy followers, never engagement-bait — the algorithm and the audience both punish it." },
  { slug: "social-listening", name: "Social Listening", pillar: "research", category: "marketing",
    trigger_description: "When monitoring what customers, competitors, or the market say on social platforms.",
    tags: ["social", "listening", "research", "competitors"],
    body: "Track three streams: mentions of the company (respond fast — speed is the brand), competitor announcements (feed the brain's findings), and customer-language posts about the problem space (mine the exact words buyers use; reuse them in copy). Surface only signals someone would act on: a complaint to defuse, a trend to ride this week, a competitor stumble to capitalize on." },
  { slug: "launch-announcement", name: "Launch & Announcement Play", pillar: "content", category: "marketing",
    trigger_description: "When the company ships something or has news worth announcing.",
    tags: ["launch", "announcement", "marketing"],
    body: "One launch = many assets from one core story: the problem, the change, the proof. Sequence: teaser (optional) → launch post per platform (native, not copied) → founder POV → customer-proof follow-up a week later. The launch post leads with what the CUSTOMER can now do, never with 'we're excited to announce'. Prepare replies for likely questions in advance." },
  { slug: "marketing-funnel-thinking", name: "Funnel Thinking", pillar: "growth", category: "marketing",
    trigger_description: "When evaluating any marketing effort — where does it act in the funnel and what's the next step.",
    tags: ["marketing", "funnel", "strategy"],
    body: "Every marketing act has a job: awareness (be discovered), consideration (be believed), conversion (be chosen). Diagnose before prescribing: where does the funnel actually leak? (No traffic = awareness problem; traffic but no signups = positioning/conversion problem.) Fix the biggest leak first. Social posts are top-of-funnel — they must hand off somewhere: profile link, landing page, CTA. A great post with no next step is a dead end." },
];

let ok = 0;
for (const s of SKILLS) {
  const { data: existing } = await db.from("brain_skills").select("id").is("workspace_id", null).eq("slug", s.slug).maybeSingle();
  const row = { workspace_id: null, learned_from: "seed", confidence: 0.8, status: "active", source_url: SRC, ...s, updated_at: new Date().toISOString() };
  if (existing?.id) { await db.from("brain_skills").update(row).eq("id", existing.id); }
  else { const { error } = await db.from("brain_skills").insert(row); if (error) { console.error(s.slug, error.message); continue; } }
  ok++;
}
const { count } = await db.from("brain_skills").select("*", { count: "exact", head: true }).is("workspace_id", null);
console.log(`seeded/updated ${ok} social/marketing skills · global library now has ${count} skills`);
process.exit(0);
