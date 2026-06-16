# Text To Image App

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/text-to-image-template)

![Text To Image Template Preview](https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/dddfe97e-e689-450b-d5a9-d49801da6a00/public)

<!-- dash-content-start -->

Generate images based on text prompts using [Workers AI](https://developers.cloudflare.com/workers-ai/). In this example, going to the website will generate an image from the prompt "cyberpunk cat" using the `@cf/stabilityai/stable-diffusion-xl-base-1.0` model. Be patient! Your image may take a few seconds to generate.

<!-- dash-content-end -->

## Getting Started

Outside of this repo, you can start a new project with this template using [C3](https://developers.cloudflare.com/pages/get-started/c3/) (the `create-cloudflare` CLI):

```bash
npm create cloudflare@latest -- --template=cloudflare/templates/text-to-image-template
```

A live public deployment of this template is available at [https://text-to-image-template.templates.workers.dev](https://text-to-image-template.templates.workers.dev)

## Setup Steps

1. Install the project dependencies with a package manager of your choice:
   ```bash
   npm install
   ```
2. Deploy the project!
   ```bash
   npx wrangler deploy
   ```
3. Monitor your worker
   ```bash
   npx wrangler tail
   ```

## Telegram Integration

This worker now supports sending generated images directly to a Telegram bot.

### 1) Configure env/secrets

Set your bot token as a secret:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

Optional: set a default chat id in `wrangler.json` so requests do not need `chatId` every time.

```json
{
  "vars": {
    "TELEGRAM_DEFAULT_CHAT_ID": "123456789"
  }
}
```

Optional: protect Telegram webhook calls with a secret token:

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

### 2) Send prompt by API (HTTP POST)

`/api/generate` now does both:
- generates image
- sends image to Telegram
- returns the image as `image/png` in HTTP response

```bash
curl -X POST "https://<your-worker>.workers.dev/api/generate" \
  -H "content-type: application/json" \
  -d '{"prompt":"retro robot portrait, studio light","chatId":"123456789"}'
```

You can still use `/api/generate-to-telegram` if you only want a JSON confirmation response.

### 3) Telegram webhook mode

Point your Telegram webhook to:

```text
https://<your-worker>.workers.dev/telegram/webhook
```

If webhook is set, sending a text message (or `/imagine ...`) to the bot triggers image generation and sends the image back to the same chat.
