/**
 * Centralized AI prompts and constants.
 * Loads router and comment prompts from prompts/*.md files.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const LANG_INSTRUCTION = {
  en: 'Write the reply in English.',
  ja: '日本語で返信を書いてください。',
  ko: '한국어로 답글을 작성하세요.',
  zh: '请用中文（简体）写回复。',
};

export const DEFAULT_COMMENT_SKILL = 'market_analysis';

export const ALLOWED_COMMENT_SKILLS = [
  'bullish_reaction',
  'product_update',
  'market_analysis',
  'article_reaction',
];

const SKILL_FILE_MAP = {
  bullish_reaction: 'bullish_reaction.md',
  product_update: 'product_update.md',
  market_analysis: 'market_analysis.md',
  article_reaction: 'article_reaction.md',
};

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');
const SKILLS_DIR = path.join(PROMPTS_DIR, 'skills');

function readPromptFile(filePath) {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    throw new Error(`[ai-prompts] Failed to read prompt file "${filePath}": ${error.message}`);
  }
}

export const BASE_COMMENT_PROMPT = readPromptFile(path.join(PROMPTS_DIR, 'base.md'));
export const ROUTER_SYSTEM_PROMPT = readPromptFile(path.join(PROMPTS_DIR, 'router.md'));

export const COMMENT_SKILL_PROMPTS = Object.fromEntries(
  ALLOWED_COMMENT_SKILLS.map((skill) => [skill, readPromptFile(path.join(SKILLS_DIR, SKILL_FILE_MAP[skill]))])
);

function validatePromptShape() {
  if (!BASE_COMMENT_PROMPT) throw new Error('[ai-prompts] base.md is empty');
  if (!ROUTER_SYSTEM_PROMPT) throw new Error('[ai-prompts] router.md is empty');
  for (const skill of ALLOWED_COMMENT_SKILLS) {
    if (!COMMENT_SKILL_PROMPTS[skill]) {
      throw new Error(`[ai-prompts] Missing skill prompt for "${skill}"`);
    }
  }
}
validatePromptShape();

export function isAllowedCommentSkill(skill) {
  return ALLOWED_COMMENT_SKILLS.includes(skill);
}

export function buildCommentSystemPrompt(skill) {
  const resolvedSkill = isAllowedCommentSkill(skill) ? skill : DEFAULT_COMMENT_SKILL;
  return `${BASE_COMMENT_PROMPT}\n\n${COMMENT_SKILL_PROMPTS[resolvedSkill]}`;
}

// Provider-specific defaults
export const PROVIDER_DEFAULTS = {
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    maxTokens: 200,
    temperature: 0.95,
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    maxTokens: 100,
    temperature: 0.8,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'x-ai/grok-4.3',
    maxTokens: 150,
    temperature: 0.9,
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5',
    maxTokens: 300,
    temperature: 0.8,
  },
};
