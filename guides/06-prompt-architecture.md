# Prompt Architecture

## Goal

Prompt system is split into small Markdown files so behavior is easier to read, audit, and tune:

```text
prompts/
  base.md
  router.md
  skills/
    bullish_reaction.md
    product_update.md
    market_analysis.md
    article_reaction.md
```

This keeps content and code separate:
- Prompt content lives in `prompts/*.md`
- Runtime assembly lives in `src/lib/ai-prompts.mjs`
- API and routing logic lives in `src/lib/ai-commenter.mjs`

## Runtime Assembly

Comment generation uses:

```text
system_prompt = base.md + selected skill markdown
user_prompt = tweet text + optional recent reply context
```

Router uses only:

```text
router.md
```

## Why this split

- Cleaner boundaries: no long prompt strings mixed with API code.
- Easier tuning: edit one skill prompt without touching router/base.
- Better reliability: loader validates required prompt files at startup.
- Better AI readability: Markdown prompt specs are structured and scannable.

## Skill List (fixed in V1)

- `bullish_reaction`
- `product_update`
- `market_analysis`
- `article_reaction`

If skill is missing/invalid, runtime falls back safely to `market_analysis`.
