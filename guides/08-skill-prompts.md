# Skill Prompt Specs

## Overview

The comment generator uses one fixed skill per tweet, selected by router.

Skill files:
- `prompts/skills/bullish_reaction.md`
- `prompts/skills/product_update.md`
- `prompts/skills/market_analysis.md`
- `prompts/skills/article_reaction.md`

Each skill prompt contains:
- Use case
- Goal
- Tone
- Reply instincts
- Avoid list

## Skill Boundaries

### `bullish_reaction`
- For conviction-heavy, momentum, hype-first crypto posts.
- Output should match energy but avoid guaranteed outcomes.

### `product_update`
- For launches, features, integrations, milestones, roadmap updates.
- Output should be builder-aware and substance-first.

### `market_analysis`
- For chart/TA/thesis/liquidity/positioning/sentiment posts.
- Output should add one concise market insight or counterpoint.

### `article_reaction`
- For threads, research, educational or multi-point breakdowns.
- Output should react to the strongest takeaway, not summarize everything.

## Default Behavior

When AI filter is disabled, list mode currently uses `market_analysis` as default skill.

## Editing Guidance

- Keep prompts specific and concrete; avoid generic “be concise” only prompts.
- Keep language in plain Markdown (no JSON wrappers).
- Update router boundaries if skill intent changes.
