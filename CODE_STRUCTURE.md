# Code Structure Refactoring

## Overview

The codebase has been refactored to centralize AI-related prompts and constants for better maintainability and extensibility.

## New Architecture

### `src/lib/ai-prompts.mjs` (NEW)

Central hub for all AI-related constants and prompts. This file contains:

- **`LANG_INSTRUCTION`**: Language-specific instructions for replies (EN, JA, KO, ZH)
- **`COMMENT_SYSTEM_PROMPT`**: Master system prompt for generating crypto twitter comments
- **`FILTER_SYSTEM_PROMPT`**: System prompt for filtering tweets (tweet-selection logic)
- **`PROVIDER_DEFAULTS`**: Default configurations for each AI provider
  - URL, model name, max tokens, temperature settings

### `src/lib/ai-commenter.mjs` (UPDATED)

Now imports prompts from `ai-prompts.mjs` and manages all AI provider calls:

**Supported Providers:**
- `deepseek` - Uses DeepSeek Chat API
- `openai` - Uses OpenAI API (GPT models)
- `openrouter` - NEW: Multi-model routing gateway
- `anthropic` - Uses Anthropic API (Claude models)

**Key Functions:**

```javascript
// Generate a single comment
await generateComment({ 
  tweetText: "...",
  lang: "en",          // auto, en, ja, ko, zh
  style: "...",        // custom persona prompt
  ai: { provider, apiKey, model }
})

// Filter and select tweets for commenting
await filterTweetsBatch({ 
  tweets: [...],
  ai: { provider, apiKey, model }
})
```

## Adding a New AI Provider

To add support for a new provider (e.g., Claude API v2):

### 1. Update `ai-prompts.mjs`

Add to `PROVIDER_DEFAULTS`:

```javascript
export const PROVIDER_DEFAULTS = {
  // ... existing providers ...
  mynewprovider: {
    url: 'https://api.mynewprovider.com/v1/chat',
    model: 'default-model-name',
    maxTokens: 200,
    temperature: 0.95,
  },
};
```

### 2. Add provider function in `ai-commenter.mjs`

```javascript
async function callMynewprovider({ apiKey, model, prompt, recentComments = [] }) {
  const res = await fetch(PROVIDER_DEFAULTS.mynewprovider.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
      // Add provider-specific headers
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.mynewprovider.model,
      messages: [
        { role: 'system', content: COMMENT_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: PROVIDER_DEFAULTS.mynewprovider.maxTokens,
      temperature: PROVIDER_DEFAULTS.mynewprovider.temperature,
    }),
  });
  
  if (!res.ok) throw new Error(`MyNewProvider HTTP ${res.status}: ...`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}
```

### 3. Register in `generateComment`

```javascript
else if (provider === 'mynewprovider') 
  text = await callMynewprovider({ apiKey: ai.apiKey, model: ai.model, prompt, recentComments });
```

### 4. Update `setup-wizard.mjs`

Add to the provider list in Q5:

```javascript
console.log('Options: deepseek | openai | openrouter | anthropic | mynewprovider');
if (!['deepseek', 'openai', 'openrouter', 'anthropic', 'mynewprovider'].includes(provider)) 
  provider = 'deepseek';
```

## Customizing Prompts

All system prompts are centralized in `ai-prompts.mjs` for easy updates:

### Update Comment Prompt

Edit `COMMENT_SYSTEM_PROMPT` in `ai-prompts.mjs`:
- Add/remove rules for comment generation
- Change tone, length, or style guidelines
- Add anti-repetition rules
- Modify output format requirements

### Update Filter Prompt

Edit `FILTER_SYSTEM_PROMPT` for tweet filtering logic:
- Adjust which tweets pass the filter
- Change evaluation criteria
- Add new tweet categories

### Add Language Support

Add to `LANG_INSTRUCTION`:

```javascript
export const LANG_INSTRUCTION = {
  // ... existing languages ...
  es: 'Escribe la respuesta en español.',
  fr: 'Écrivez la réponse en français.',
};
```

## Benefits of This Refactoring

1. **Single Source of Truth**: All prompts live in one file
2. **Easy Maintenance**: Change prompt behavior without touching provider logic
3. **Provider Agnostic**: Adding new providers doesn't affect existing ones
4. **Configuration Flexibility**: Provider defaults can be adjusted centrally
5. **Testability**: Prompts can be tested independently
6. **Version Control**: Track prompt iterations with git

## Migration Guide

If you had a custom `config.json`, it should still work! The refactoring is backward compatible.

### Optional: Use new OpenRouter provider

Update your `config.json`:

```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "sk-or-v1-...",
    "model": "deepseek/deepseek-chat"
  }
}
```

See `guides/05-openrouter-setup.md` for details.
