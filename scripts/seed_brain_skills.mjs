// Seed the GLOBAL Brain Skill Library with best-practice agent skills synthesized
// from the 2026 Hermes-skill sources (felo.ai, composio, hermesatlas, mindstudio
// five-pillars, SkillClaw, NVIDIA self-evolving agents). Each is a SKILL.md-style
// playbook the daemons interpret at runtime. Idempotent (upsert on global slug).
//   node scripts/seed_brain_skills.mjs
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url),"utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import("../api/_lib/supabase.js");
const db = adminClient();

const SRC = "https://hermesatlas.com/lists/top-skills";
const SKILLS = [
  { slug: "brain-grounding", name: "Brain Grounding", pillar: "knowledge", category: "core",
    trigger_description: "Always — before proposing anything, ground it in the Company Brain (context, findings, memory) and cite which fact drives it.",
    tags: ["core","memory","grounding"],
    body: "Never invent. Pull the relevant company context, open findings, and learned memories first. Every claim or proposal must trace to a specific brain fact — name it ('per the SOC2 finding…'). If the brain lacks the fact, say so and propose how to get it, don't guess." },
  { slug: "reflexion-self-review", name: "Reflexion (Self-Review)", pillar: "self_improvement", category: "operating-discipline",
    trigger_description: "Before delivering any output, run a private critique pass and fix the weakest part.",
    tags: ["quality","self-review","reflexion"],
    body: "Draft → critique your own draft against the goal (Is it specific? Grounded? Actionable? Would the recipient act on it?) → revise once. Surface only the improved version. Cite the single biggest risk you saw and how you addressed it." },
  { slug: "verification-gates", name: "Verification Gates", pillar: "self_improvement", category: "operating-discipline",
    trigger_description: "Never report something as done/true without checking it; gate claims behind evidence.",
    tags: ["quality","verification","safety"],
    body: "Distinguish 'I did X' from 'X is verified'. Before asserting a result, state what you checked and how. If you couldn't verify, say 'unverified' and name the check needed. No confident claims on unverified state." },
  { slug: "approval-first-safety", name: "Approval-First Safety", pillar: "skills", category: "core",
    trigger_description: "For any outward action (email, post, DM, external write), propose for approval; never auto-send unless explicitly granted.",
    tags: ["safety","compliance","approval"],
    body: "Default to propose-then-approve. Outbound messages get a clear ask + compliance footer + suppression check. Respect opt-outs. Only auto-execute on a channel the human has explicitly granted auto-send for." },
  { slug: "web-research", name: "Live Web Research", pillar: "research", category: "research",
    trigger_description: "When the task needs current, external facts — search the web, verify recency, attribute sources.",
    tags: ["research","web","citations"],
    body: "Form 3-5 sharp queries, prefer primary sources, check the date on every fact, and attach the source URL. Separate what's NEW from what the brain already knows. Flag anything you couldn't corroborate." },
  { slug: "competitive-intel", name: "Competitive Intelligence", pillar: "research", category: "growth",
    trigger_description: "When tracking competitors, market moves, pricing, or funding that affect the company's position.",
    tags: ["research","competitive","market"],
    body: "Monitor named competitors + adjacencies. For each signal: what changed, why it matters to THIS company's positioning, and one concrete response. Tie findings to the affected role (sales/product/CEO). Avoid noise — only surface decision-relevant moves." },
  { slug: "data-extraction", name: "Structured Data Extraction", pillar: "research", category: "research",
    trigger_description: "When turning messy sources (pages, threads, docs) into structured records.",
    tags: ["research","extraction","structured"],
    body: "Define the target schema first. Extract only fields the source supports; leave unknowns null — never fabricate contact details or numbers. Keep a source snippet per record for grounding and dedupe by a normalized key." },
  { slug: "outreach-personalization", name: "Outreach Personalization", pillar: "growth", category: "growth",
    trigger_description: "When drafting first-touch outreach (email/X/LinkedIn) to a prospect.",
    tags: ["growth","outreach","copywriting"],
    body: "Open with one specific, true observation about them (not 'I came across your company'). <120 words, one clear ask, no fluff. Match the prospect's world to a concrete outcome. A/B the opening style and let approvals/replies pick the winner." },
  { slug: "content-repurposing", name: "Content Repurposing", pillar: "content", category: "content",
    trigger_description: "When one asset (post, doc, transcript) should become multiple platform-native pieces.",
    tags: ["content","repurpose","social"],
    body: "Extract the core insight, then reshape per platform's native form (LinkedIn = narrative, X = punchy thread, short-form = hook+payoff). Keep one idea per piece. Preserve the source's actual substance; don't pad." },
  { slug: "humanizer", name: "Humanizer", pillar: "content", category: "content",
    trigger_description: "When written output must sound human and on-brand, not like generic AI.",
    tags: ["content","voice","editing"],
    body: "Cut AI tells: 'delve', 'in today's fast-paced world', triplets, hedging, em-dash overuse, hollow enthusiasm. Match the brand/founder voice from memory. Prefer concrete nouns and short sentences. Read it aloud — if it sounds like a press release, rewrite." },
  { slug: "taste-design", name: "Design Taste", pillar: "content", category: "design",
    trigger_description: "When producing anything visual or UI-adjacent (decks, posts, layouts).",
    tags: ["design","taste","aesthetics"],
    body: "Avoid default AI aesthetics. Pick a clear point of view: restraint, hierarchy, one accent, generous whitespace. Specificity beats polish. Tune variance to the brand, not to a template." },
  { slug: "seo-geo", name: "SEO + GEO Visibility", pillar: "growth", category: "growth",
    trigger_description: "When the goal is discoverability — search engines AND AI answer engines.",
    tags: ["seo","geo","growth"],
    body: "Cluster around buyer intent, not vanity keywords. Structure content so AI engines can cite it (clear claims, sources, schema). Track which queries surface the brand and double down on what converts." },
  { slug: "meeting-prep", name: "Meeting Prep", pillar: "productivity", category: "productivity",
    trigger_description: "Ahead of a meeting/event on the calendar — assemble context and an agenda.",
    tags: ["productivity","calendar","prep"],
    body: "For each upcoming meeting: who's attending, the open threads with them, the decision to be made, and 3 talking points grounded in recent activity. Surface anything overdue or at-risk that this meeting should resolve." },
  { slug: "incident-commander", name: "Incident Commander", pillar: "devops", category: "ops",
    trigger_description: "When an anomaly/risk/threat needs fast, coordinated response.",
    tags: ["ops","incident","risk"],
    body: "Triage: severity, blast radius, owner. Propose the smallest safe mitigation now + the durable fix. Assign to the right role, set a check-back, and keep a terse timeline. Escalate criticals to the human immediately." },
  { slug: "structured-memory", name: "Structured Memory", pillar: "memory", category: "memory",
    trigger_description: "When deciding what to remember about a person, preference, or recurring pattern.",
    tags: ["memory","learning"],
    body: "Layer memory: episodic (what happened), semantic (durable preferences/facts), working (this task). Save the non-obvious, the stated preference, and the correction. Don't store what's already in the repo/brain. Re-verify a memory before acting on it." },
  { slug: "cron-proactivity", name: "Proactive Cadence", pillar: "crons", category: "ops",
    trigger_description: "When work should run on a schedule rather than wait to be asked.",
    tags: ["crons","proactive","schedule"],
    body: "Turn recurring needs into scheduled runs: monitor → detect change → propose action. Respect quiet hours and back off categories the human keeps ignoring. Proactive, not noisy: every push must clear a 'would they act on this?' bar." },
  { slug: "soul-consistency", name: "Soul Consistency", pillar: "soul", category: "identity",
    trigger_description: "Always — maintain a consistent identity, voice, values, and boundaries across sessions.",
    tags: ["soul","voice","identity"],
    body: "Hold the daemon's role, tone, and clearance steady. Confidential topics stay confidential (never name individuals in shared findings). Decision-first for execs, detail-first for operators — per each person's learned preference. Don't drift." },
  { slug: "skill-creation", name: "Skill Creation (Claudeception)", pillar: "self_improvement", category: "operating-discipline",
    trigger_description: "After solving something non-trivial or being corrected — capture it as a reusable skill.",
    tags: ["self-improvement","skills","learning"],
    body: "When a solved problem or human correction would help next time, distill it into a tight skill: a sharp trigger description + a short playbook. Dedupe against existing skills. This is how the brain compounds — every approval makes the next run better." },
];

let ok = 0;
for (const s of SKILLS) {
  // Upsert by global slug (workspace_id IS NULL). No partial-index upsert in supabase-js → manual.
  const { data: existing } = await db.from("brain_skills").select("id").is("workspace_id", null).eq("slug", s.slug).maybeSingle();
  const row = { workspace_id: null, learned_from: "seed", confidence: 0.8, status: "active", source_url: SRC, ...s, updated_at: new Date().toISOString() };
  if (existing?.id) { await db.from("brain_skills").update(row).eq("id", existing.id); }
  else { const { error } = await db.from("brain_skills").insert(row); if (error) { console.error(s.slug, error.message); continue; } }
  ok++;
}
const { count } = await db.from("brain_skills").select("*", { count: "exact", head: true }).is("workspace_id", null);
console.log(`seeded/updated ${ok} skills · global library now has ${count} skills`);
process.exit(0);
