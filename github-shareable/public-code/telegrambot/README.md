# Telegram Bot Worker

This folder contains the public-safe Telegram notification worker.

## Responsibilities

- Accept `POST /notify`
- Validate the shared notify token
- Look up the analysis job by `external_id`
- Send the analysis text to Telegram in chunks
- Expose `GET /health`

## Environment

Runtime values are provided as placeholders in `wrangler.jsonc`.

- `TELEGRAM_BOT_TOKEN`
- `ANALYZER_API_BASE`
- `ALLOWED_TELEGRAM_USER_ID`
- `NOTIFY_SHARED_TOKEN`

## Public-Safe Note

No real token, chat ID, or private worker URL is stored here.
