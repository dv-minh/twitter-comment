/**
 * Multi-provider AI comment generator.
 * Supports: deepseek, openai, openrouter, anthropic. All via fetch — no SDK deps.
 */
import { isFollowBackRequest, followBackReply } from './language.mjs';
import { LANG_INSTRUCTION, COMMENT_SYSTEM_PROMPT, FILTER_SYSTEM_PROMPT, PROVIDER_DEFAULTS } from './ai-prompts.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Get path to comment history file
function getHistoryPath() {
  return path.join(process.cwd(), 'data', 'comment-history.json');
}

// Read recent comments from history file
function readRecentComments(limit = 10) {
  const historyPath = getHistoryPath();
  try {
    if (!existsSync(historyPath)) return [];
    const data = JSON.parse(readFileSync(historyPath, 'utf8'));
    return (data.comments || []).slice(-limit);
  } catch (error) {
    console.error(`[ai-commenter] Failed to read comment history: ${error.message}`);
    return [];
  }
}

// Save comment to history
function saveCommentToHistory(comment) {
  const historyPath = getHistoryPath();
  try {
    let data = { comments: [] };
    if (existsSync(historyPath)) {
      data = JSON.parse(readFileSync(historyPath, 'utf8'));
    }
    
    // Keep only last 10 comments
    if (!Array.isArray(data.comments)) data.comments = [];
    data.comments.push({
      text: comment,
      timestamp: new Date().toISOString(),
    });
    data.comments = data.comments.slice(-10);
    
    writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`[ai-commenter] Failed to save comment to history: ${error.message}`);
  }
}

function buildPrompt({ tweetText, lang, style, recentComments = [] }) {
  let historySection = '';
  if (recentComments && recentComments.length > 0) {
    const recentTexts = recentComments.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
    historySection = `\n\nYour 10 most recent replies:\n${recentTexts}\n`;
  }
  
  return `Tweet content:
"${tweetText}"${historySection}`;
}

async function callDeepseek({ apiKey, model, prompt }) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.95,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function callOpenAI({ apiKey, model, prompt, recentComments = [] }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.openai.model,
      messages: [
        { role: 'system', content: COMMENT_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: PROVIDER_DEFAULTS.openai.maxTokens,
      temperature: PROVIDER_DEFAULTS.openai.temperature,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function callOpenRouter({ apiKey, model, prompt, recentComments = [] }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
      'http-referer': 'https://twitter-comment-pack.local',
      'x-title': 'TwitterCommentPack',
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.openrouter.model,
      messages: [
        { role: 'system', content: COMMENT_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: PROVIDER_DEFAULTS.openrouter.maxTokens,
      temperature: PROVIDER_DEFAULTS.openrouter.temperature,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function callAnthropic({ apiKey, model, prompt }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const block = (data?.content || []).find((b) => b.type === 'text');
  return (block?.text || '').trim();
}

async function callFilterBatch(tweetChunk, ai) {
  const tweetsList = tweetChunk.map(t => `ID: ${t.id}\nText: ${t.fullText}`).join('\n---\n');
  const prompt = `Analyze these tweets:\n\n${tweetsList}`;
  
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model || PROVIDER_DEFAULTS.openai.model,
      messages: [
        { role: 'system', content: FILTER_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 3000,
      temperature: 0.7,
    }),
  });
  
  if (!res.ok) throw new Error(`OpenAI Batch Filter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  
  console.log(`[callFilterBatch] Raw response (${tweetChunk.length} tweets): ${text.slice(0, 300)}`);
  
  const json = JSON.parse(text);
  const resultMap = {};
  (json.results || []).forEach(r => {
    resultMap[r.id] = r.process === true;
  });
  return resultMap;
}

export async function filterTweetsBatch({ tweets, ai }) {
  if (!tweets || tweets.length === 0) return {};
  
  const CHUNK_SIZE = 20;
  const chunks = [];
  for (let i = 0; i < tweets.length; i += CHUNK_SIZE) {
    chunks.push(tweets.slice(i, i + CHUNK_SIZE));
  }
  
  const provider = (ai.provider || 'openai').toLowerCase();
  
  try {
    if (provider !== 'openai') throw new Error(`Batch filter only supports OpenAI provider`);
    
    console.log(`[filterTweetsBatch] Processing ${tweets.length} tweets in ${chunks.length} chunk(s)...`);
    
    const mergedResults = {};
    
    for (let i = 0; i < chunks.length; i++) {
      try {
        console.log(`[filterTweetsBatch] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} tweets)...`);
        const chunkResults = await callFilterBatch(chunks[i], ai);
        Object.assign(mergedResults, chunkResults);
        console.log(`[filterTweetsBatch] Chunk ${i + 1} done: ${Object.values(chunkResults).filter(v => v).length}/${chunks[i].length} passed`);
      } catch (chunkErr) {
        console.error(`[filterTweetsBatch] Chunk ${i + 1} failed: ${chunkErr.message}`);
        return {};
      }
    }
    
    console.log(`[filterTweetsBatch] All chunks merged. Total filter results: ${Object.values(mergedResults).filter(v => v).length}/${tweets.length} passed`);
    
    return mergedResults;
  } catch (error) {
    console.error(`Batch filter failed: ${error.message}`);
    return {};
  }
}

export async function generateComment({ tweetText, lang, style, ai }) {
  if (isFollowBackRequest(tweetText)) {
    return followBackReply(lang);
  }
  
  // Read recent comments for anti-repetition
  const recentComments = readRecentComments(10);
  
  const prompt = buildPrompt({ tweetText, lang, style, recentComments });
  const provider = (ai.provider || 'deepseek').toLowerCase();
  let text = '';
  
  try {
    if (provider === 'deepseek') text = await callDeepseek({ apiKey: ai.apiKey, model: ai.model, prompt });
    else if (provider === 'openai') text = await callOpenAI({ apiKey: ai.apiKey, model: ai.model, prompt, recentComments });
    else if (provider === 'openrouter') text = await callOpenRouter({ apiKey: ai.apiKey, model: ai.model, prompt, recentComments });
    else if (provider === 'anthropic') text = await callAnthropic({ apiKey: ai.apiKey, model: ai.model, prompt });
    else throw new Error(`Unknown AI provider: ${provider}`);
  } catch (error) {
    // On failure, wait 1 hour then retry once
    console.error(`AI call failed: ${error.message}. Waiting 1 hour before retry...`);
    await sleep(60 * 60 * 1000); // 1 hour = 3600000 ms
    
    if (provider === 'deepseek') text = await callDeepseek({ apiKey: ai.apiKey, model: ai.model, prompt });
    else if (provider === 'openai') text = await callOpenAI({ apiKey: ai.apiKey, model: ai.model, prompt, recentComments });
    else if (provider === 'openrouter') text = await callOpenRouter({ apiKey: ai.apiKey, model: ai.model, prompt, recentComments });
    else if (provider === 'anthropic') text = await callAnthropic({ apiKey: ai.apiKey, model: ai.model, prompt });
    else throw new Error(`Unknown AI provider: ${provider}`);
  }

  if (!text) throw new Error('AI returned empty comment');
  // Strip surrounding quotes if model added them
  const cleanedText = text.replace(/^["'`]+|["'`]+$/g, '').replace(/—/g, '').trim();
  
  // Save comment to history for future anti-repetition checks
  saveCommentToHistory(cleanedText);
  
  return cleanedText;
}
