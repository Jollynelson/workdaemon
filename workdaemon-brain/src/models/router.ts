// WorkDaemon Brain — Model Router
// Routes queries to Llama 3.1 70B (free, via Groq) or Claude Sonnet
// Decision is based on query complexity — saves cost, maintains quality

import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { config } from '../config.js';
import type { ModelResponse } from '../types.js';

export class ModelRouter {
  private anthropic?: Anthropic;
  private groq?:      Groq;

  constructor() {
    if (config.models.anthropic_api_key) {
      this.anthropic = new Anthropic({
        apiKey: config.models.anthropic_api_key,
      });
    }
    if (config.models.groq_api_key) {
      this.groq = new Groq({
        apiKey: config.models.groq_api_key,
      });
    }
  }

  // ── Main entry — route query + context to appropriate model ──────────────
  async complete(
    question:       string,
    context_chunks: string[],
    system_prompt?: string,
    force_model?:   'llama' | 'claude',
  ): Promise<ModelResponse> {
    const is_complex = force_model === 'claude' || (
      force_model !== 'llama' && this.is_complex(question)
    );

    const context = this.build_context(context_chunks);
    const prompt  = this.build_prompt(question, context);
    const system  = system_prompt ?? this.default_system_prompt();

    if (is_complex && this.anthropic) {
      return this.ask_claude(system, prompt);
    } else if (this.groq) {
      return this.ask_llama(system, prompt);
    } else if (this.anthropic) {
      // Fallback to Claude if Groq not configured
      return this.ask_claude(system, prompt);
    } else {
      throw new Error(
        'No model provider configured. Set GROQ_API_KEY or ANTHROPIC_API_KEY'
      );
    }
  }

  // ── Onboarding scan — always uses Claude for best initial analysis ────────
  async analyse_company(raw_content: string, instruction: string): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Claude required for company analysis. Set ANTHROPIC_API_KEY');
    }

    const response = await this.anthropic.messages.create({
      model:      config.models.claude_model,
      max_tokens: 4096,
      system: `You are analysing a company's internal data to build a company intelligence model.
Be precise, factual, and structured. Return valid JSON only — no prose, no markdown.`,
      messages: [{
        role:    'user',
        content: `${instruction}\n\n--- COMPANY DATA ---\n${raw_content.slice(0, 80_000)}`,
      }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : '';
  }

  // ── Ask Llama 3.1 70B via Groq ───────────────────────────────────────────
  private async ask_llama(system: string, prompt: string): Promise<ModelResponse> {
    const start = Date.now();

    if (!this.groq) throw new Error('Groq not configured');

    const response = await this.groq.chat.completions.create({
      model:      config.models.llama_model,
      max_tokens: 1024,
      messages: [
        { role: 'system',  content: system },
        { role: 'user',    content: prompt },
      ],
    });

    const text         = response.choices[0]?.message?.content ?? '';
    const tokens_used  = response.usage?.total_tokens ?? 0;

    console.log(
      `[Router] Llama — ${tokens_used} tokens — ${Date.now() - start}ms`
    );

    return { text, model: 'llama', tokens_used };
  }

  // ── Ask Claude Sonnet ────────────────────────────────────────────────────
  private async ask_claude(system: string, prompt: string): Promise<ModelResponse> {
    const start = Date.now();

    if (!this.anthropic) throw new Error('Anthropic not configured');

    const response = await this.anthropic.messages.create({
      model:      config.models.claude_model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: prompt }],
    });

    const text        = response.content[0].type === 'text'
      ? response.content[0].text : '';
    const tokens_used = response.usage.input_tokens + response.usage.output_tokens;

    console.log(
      `[Router] Claude — ${tokens_used} tokens — ${Date.now() - start}ms`
    );

    return { text, model: 'claude', tokens_used };
  }

  // ── Complexity detection — heuristics to decide which model ─────────────
  private is_complex(question: string): boolean {
    const q = question.toLowerCase();

    // Length threshold
    if (question.length > config.models.complex_threshold) return true;

    // Complex reasoning keywords
    const complex_signals = [
      'summarise', 'summarize', 'analyse', 'analyze',
      'compare', 'contrast', 'explain why', 'what caused',
      'contradict', 'inconsistent', 'pattern', 'trend',
      'over time', 'history of', 'timeline', 'all decisions',
      'across', 'between', 'relate', 'connect',
      'what should', 'recommend', 'suggest',
    ];

    return complex_signals.some(signal => q.includes(signal));
  }

  // ── Build the prompt from question + retrieved context ───────────────────
  private build_prompt(question: string, context: string): string {
    return `Using the company knowledge below, answer the question accurately and concisely.
If the answer is not in the knowledge, say so — do not guess.

--- COMPANY KNOWLEDGE ---
${context}
--- END ---

Question: ${question}`;
  }

  // ── Build context string from retrieved chunks ────────────────────────────
  private build_context(chunks: string[]): string {
    return chunks
      .map((chunk, i) => `[${i + 1}] ${chunk}`)
      .join('\n\n');
  }

  // ── Default system prompt for Daemon Brain queries ────────────────────────
  private default_system_prompt(): string {
    return `You are the Company Brain for ${config.company.name}.
You have access to the company's internal knowledge — documents, decisions, projects, and communications.
Answer questions accurately and concisely. Always cite which document or source your answer comes from.
If you do not have enough information, say so clearly. Never fabricate facts.`;
  }
}
