# OpenRouter Setup Guide

OpenRouter is a gateway to multiple AI models (DeepSeek, GPT-4, Claude, etc.) with flexible pricing and rate limiting.

## Why use OpenRouter?

- **Flexible routing**: Choose between many models
- **Better rates**: Often cheaper than official APIs for some models
- **Single API key**: No need to manage multiple provider credentials
- **Model flexibility**: Easily switch models in `config.json` without reconfiguring

## Step 1: Get your OpenRouter API key

1. Go to https://openrouter.ai/
2. Sign up or log in
3. Navigate to **Keys** section
4. Create a new API key
5. Copy the key (format: `sk-or-v1-...`)

## Step 2: Update config.json

```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "sk-or-v1-YOUR_KEY_HERE",
    "model": "deepseek/deepseek-chat"
  }
}
```

### Recommended models on OpenRouter

**Best for crypto CT comments** (cheap & fast):
- `deepseek/deepseek-chat` (default, ~$0.0005/1K tokens)
- `google/gemini-flash-1.5-8b` (very cheap)
- `meta-llama/llama-3-8b` (cheap, faster)

**Better quality** (more expensive):
- `openai/gpt-4-turbo`
- `anthropic/claude-3-5-sonnet`
- `gryphe/mythomax-l2-13b`

### List all available models

Visit https://openrouter.ai/docs#models to browse all available models and current pricing.

## Step 3: Verify it works

```bash
npm start
```

Watch `data/run.log` for any API errors. If you see `OpenRouter HTTP 401`, your API key is invalid.

## Troubleshooting

**OpenRouter HTTP 401**: Invalid API key
- Check your key format (should start with `sk-or-v1-`)
- Verify you copied the entire key

**OpenRouter HTTP 429**: Rate limited
- Wait a moment and the bot will auto-retry
- Lower `commentsPerHour` in config if it persists

**Model not found**: Model doesn't exist on OpenRouter
- Double-check the model ID format (usually `provider/model-name`)
- Verify on https://openrouter.ai/docs#models

## Switching back to another provider

Simply update `config.json`:

```json
{
  "ai": {
    "provider": "deepseek",
    "apiKey": "sk-...",
    "model": ""
  }
}
```

Supported providers: `deepseek`, `openai`, `openrouter`, `anthropic`
