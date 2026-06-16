# Image Prompt Generator (Cloudflare Workers AI + D1)

This project turns user input into one English image-generation prompt and stores every generated prompt in a D1 database.

## Features

- `POST /api/prompts`: generate an English image prompt from user input and save it.
- `GET /api/prompts`: fetch latest saved prompts (up to 100).
- Simple web UI for input, generated result, and saved history.

## Project Structure

```text
/
├── public/
│   ├── index.html
│   └── chat.js
├── src/
│   ├── index.ts
│   └── types.ts
├── schema.sql
├── wrangler.jsonc
└── README.md
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create D1 database:

```bash
npx wrangler d1 create prompt_generator_db
```

3. Add D1 binding to `wrangler.jsonc` (use your own values):

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "prompt_generator_db",
    "database_id": "YOUR_DATABASE_ID"
  }
]
```

4. Apply schema:

```bash
npx wrangler d1 execute prompt_generator_db --file=./schema.sql
```

5. Run locally:

```bash
npm run dev
```

## Request Examples

Generate and save prompt:

```bash
curl -X POST http://localhost:8787/api/prompts \
  -H "Content-Type: application/json" \
  -d '{"input":"a futuristic city on Mars at sunrise"}'
```

List saved prompts:

```bash
curl http://localhost:8787/api/prompts
```
