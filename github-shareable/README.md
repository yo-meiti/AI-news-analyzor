# RSS to Telegram Pipeline

This folder is the public-facing overview of the project. It keeps the architecture, the main data flow, and the sanitized code bundle needed for sharing on GitHub.

## Overview

The system reads RSS feeds, selects one candidate item, analyzes it with AI, turns that analysis into an image prompt, generates an image, and delivers the result to Telegram.

## Architecture

```text
[ RSS Feeds ]
	|
	v
[ worker-bridge ]
	|
	+--> [ llm-chat-app-template ] ---> [ D1: llm_persona_memory_v2 ]
	|              |
	|              v
	|         /api/chat
	|
	+--> [ prompt-generator ] --------> [ D1: prompt_generator_db ]
	|              |
	|              v
	|         /api/prompts
	|
	+--> [ text-to-image-template ] ---> [ Telegram ]
	|              |
	|              v
	|   /api/generate-to-telegram
	|
	+--> [ llm-chat-app-template/telegrambot ]
			   |
			   v
			/notify
```

## Main Components

- `worker-bridge` - reads RSS, picks the candidate, and coordinates the run
- `llm-chat-app-template` - analyzes the news and stores analysis jobs in D1
- `prompt-generator` - generates the image prompt
- `text-to-image-template` - generates the image and sends it to Telegram
- `llm-chat-app-template/telegrambot` - handles Telegram notifications and control

## End-to-End Flow

1. The bridge fetches RSS feeds.
2. The bridge scores and deduplicates items.
3. One candidate is sent to the analyzer at `/api/chat`.
4. The analyzer stores the job and produces the analysis.
5. The analysis is sent to the prompt generator at `/api/prompts`.
6. The prompt is sent to the image worker at `/api/generate-to-telegram`.
7. Telegram receives the final image or notification.

## Directory Tree

```text
new/
├── github-shareable/
│   └── README.md
├── llm-chat-app-template/
│   ├── migrations/
│   ├── public/
│   ├── src/
│   └── telegrambot/
├── prompt-generator/
│   ├── public/
│   ├── schema.sql
│   └── src/
├── text-to-image-template/
│   ├── src/
│   └── telegrambot/
└── worker-bridge/
    └── src/
```

## Why This Split Makes Sense

- The bridge owns orchestration.
- The analyzer owns text reasoning and job state.
- The prompt worker owns prompt shaping.
- The image worker owns image delivery.
- The Telegram worker owns notification and user-facing control.

## Public Repo Goal

This folder is intended for public sharing on GitHub. It focuses on the architecture and structure and avoids secrets and deployment-specific details.

## Sanitized Code Bundle

The public-safe code snapshot lives in [public-code](./public-code).
It contains worker entrypoints, type definitions, and Wrangler templates with secrets replaced by placeholders.

## Deployment Guide

See [DEPLOYMENT_STEPS.txt](./DEPLOYMENT_STEPS.txt) for a step-by-step deployment walkthrough.
