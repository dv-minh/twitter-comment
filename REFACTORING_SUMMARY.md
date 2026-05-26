# Refactoring Summary

## What Changed

### Files Created

1. **`src/lib/ai-prompts.mjs`** (NEW)
   - Centralized all AI system prompts
   - Centralized all language instructions
   - Centralized provider defaults (URLs, models, tokens, temperature)
   - Easy to import and maintain

### Files Modified

1. **`src/lib/ai-commenter.mjs`**
   - Removed hardcoded LANG_INSTRUCTION (moved to ai-prompts.mjs)
   - Removed hardcoded COMMENT_SYSTEM_PROMPT from callOpenAI
   - Removed hardcoded FILTER_SYSTEM_PROMPT from filterTweetsBatch
   - Added `import` from ai-prompts.mjs
   - **NEW: Added `callOpenRouter()` function** for OpenRouter support
   - Refactored all provider calls to use PROVIDER_DEFAULTS
   - Updated `generateComment()` to support openrouter provider
   - Cleaned up `callFilterBatch()` to not take system_prompt parameter

2. **`config.example.json`**
   - Changed default provider from "deepseek" to "openrouter"
   - Updated example API key format to OpenRouter format
   - Added example model: "deepseek/deepseek-chat"

3. **`setup-wizard.mjs`**
   - Added openrouter to provider options in Q5
   - Added descriptions for each provider
   - Expanded provider list validation

### Files Created (Documentation)

1. **`guides/05-openrouter-setup.md`**
   - Complete guide for setting up OpenRouter
   - Recommended models for crypto comments
   - Troubleshooting tips
   - Model switching instructions

2. **`CODE_STRUCTURE.md`**
   - Architecture overview
   - How to add new AI providers
   - How to customize prompts
   - Benefits of refactoring
   - Migration guide

## New Capabilities

### OpenRouter Support ✅
- Multi-model routing gateway
- Support for 200+ models
- Flexible switching between models
- Competitive pricing

### Modular Prompts ✅
- All prompts centralized in one file
- Easy to update without touching provider logic
- Language instructions organized
- Provider defaults configured centrally

### Extensible Architecture ✅
- Simple to add new AI providers
- Follow the pattern: add function → register in generateComment
- No duplication of prompt logic

## Backward Compatibility

✅ **Fully backward compatible** - Your existing `data/config.json` will continue to work without changes.

### To use the new OpenRouter support:

1. Get API key from https://openrouter.ai/
2. Update `config.json`:
```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "sk-or-v1-...",
    "model": "deepseek/deepseek-chat"
  }
}
```
3. Run `npm start`

## Quick Test

```bash
npm start
# Watch data/run.log for any errors
```

If you see `OpenRouter HTTP 401` → API key issue  
If it works → You're using OpenRouter! 🎉

## Provider Comparison

| Provider    | Cost | Speed | Models | Setup |
|------------|------|-------|--------|-------|
| deepseek  | 💚💚💚 | ⚡⚡⚡ | 1      | Easy  |
| openai    | 💰💰 | ⚡⚡   | Few    | Easy  |
| openrouter| 💚💚  | ⚡⚡⚡ | 200+   | Easy  |
| anthropic | 💰    | ⚡⚡   | Few    | Easy  |

## Next Steps

1. Update your API keys in `data/config.json` (if needed)
2. Run `npm start` to test
3. Read `CODE_STRUCTURE.md` to understand the new architecture
4. Read `guides/05-openrouter-setup.md` for OpenRouter details
