#!/bin/bash
# SETUP SCRIPT - Fill in the values and run this script
# اسکریپت تنظیم - مقادیر را پر کن و اسکریپت را اجرا کن

# ============================================================================
# STEP 1: مقادیری که باید پر کنی
# ============================================================================

# توکن Telegram Bot (از @BotFather)
TELEGRAM_BOT_TOKEN="8764016923:AAHNbxrWpGIZQQHyFSe1_z_15ASg5cOylAg"

# آی‌دی عددی کاربر تلگرام (فقط این کاربر می‌تواند بات را کنترل کند)
# برای یافتن آی‌دی خود: https://t.me/getidsbot
ALLOWED_TELEGRAM_USER_ID="6512947443"

# توکن امنیتی برای درخواست‌های POST /notify
# می‌تواند هر رشته‌ای باشد: openssl rand -hex 32
BOT_NOTIFY_TOKEN="YOUR_BOT_NOTIFY_TOKEN_HERE"

# Public URL بات تلگرام (بعد از deploy)
PUBLIC_WEBHOOK_URL="https://telegram-news-bot.YOUR_DOMAIN.workers.dev"

# Secret برای webhook تلگرام
TELEGRAM_WEBHOOK_SECRET="YOUR_WEBHOOK_SECRET_HERE"

# آی‌دی کانال تلگرام (اختیاری)
TELEGRAM_CHANNEL_ID="YOUR_CHANNEL_ID_HERE"

# API Key برای Tavily (اختیاری اما توصیه شده)
TAVILY_API_KEY="tvly-YOUR_API_KEY_HERE"

# ============================================================================
# STEP 2: نصب وابستگی‌ها
# ============================================================================

echo "📦 Installing dependencies..."

cd llm-chat-app-template
npm install
if [ $? -ne 0 ]; then echo "❌ Failed to install llm-chat-app-template"; exit 1; fi

cd ../prompt-generator
npm install
if [ $? -ne 0 ]; then echo "❌ Failed to install prompt-generator"; exit 1; fi

cd ../text-to-image-template
npm install
if [ $? -ne 0 ]; then echo "❌ Failed to install text-to-image-template"; exit 1; fi

echo "✅ All dependencies installed"

# ============================================================================
# STEP 3: D1 Databases (این مرحله نیاز به Cloudflare account دارد)
# ============================================================================

echo ""
echo "📊 D1 Databases"
echo "==============="
echo "برای ایجاد D1 databases، دستورات زیر را اجرا کن:"
echo ""
echo "cd llm-chat-app-template"
echo "npx wrangler d1 create llm_persona_memory_v2"
echo ""
echo "cd ../prompt-generator"
echo "npx wrangler d1 create prompt_generator_db"
echo ""
echo "بعد از ایجاد، database_id‌ها را در wrangler.jsonc files بروز رسانی کن"
echo ""
echo "Press ENTER after creating databases..."
read

# ============================================================================
# STEP 4: Apply D1 Migrations
# ============================================================================

echo ""
echo "🔧 Applying D1 Migrations"
echo "=========================="

cd llm-chat-app-template
echo "Migrating llm_persona_memory_v2..."
npx wrangler d1 execute llm_persona_memory_v2 --file=./migrations/001_persona_memory.sql
if [ $? -ne 0 ]; then echo "⚠️  First migration failed (might already exist)"; fi
npx wrangler d1 execute llm_persona_memory_v2 --file=./migrations/002_analysis_reference_samples.sql
if [ $? -ne 0 ]; then echo "⚠️  Second migration failed (might already exist)"; fi

cd ../prompt-generator
echo "Migrating prompt_generator_db..."
npx wrangler d1 execute prompt_generator_db --file=./schema.sql
if [ $? -ne 0 ]; then echo "⚠️  Migration failed (might already exist)"; fi

echo "✅ Migrations applied"

# ============================================================================
# STEP 5: Set Secrets - llm-chat-app-template (تحلیل)
# ============================================================================

echo ""
echo "🔐 Setting Secrets for llm-chat-app-template"
echo "=============================================="

cd llm-chat-app-template

if [ ! -z "$TAVILY_API_KEY" ] && [ "$TAVILY_API_KEY" != "tvly-YOUR_API_KEY_HERE" ]; then
  echo "Setting TAVILY_API_KEY..."
  echo "$TAVILY_API_KEY" | npx wrangler secret put TAVILY_API_KEY
fi

echo "✅ llm-chat-app-template secrets set"

# ============================================================================
# STEP 6: Set Secrets - text-to-image-template
# ============================================================================

echo ""
echo "🔐 Setting Secrets for text-to-image-template"
echo "=============================================="

cd ../text-to-image-template

if [ ! -z "$TELEGRAM_BOT_TOKEN" ] && [ "$TELEGRAM_BOT_TOKEN" != "YOUR_TELEGRAM_BOT_TOKEN_HERE" ]; then
  echo "Setting TELEGRAM_BOT_TOKEN..."
  echo "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN
fi

if [ ! -z "$TELEGRAM_WEBHOOK_SECRET" ] && [ "$TELEGRAM_WEBHOOK_SECRET" != "YOUR_WEBHOOK_SECRET_HERE" ]; then
  echo "Setting TELEGRAM_WEBHOOK_SECRET..."
  echo "$TELEGRAM_WEBHOOK_SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
fi

echo "✅ text-to-image-template secrets set"

# ============================================================================
# STEP 7: Deploy Workers
# ============================================================================

echo ""
echo "🚀 Deploying Workers"
echo "===================="

cd ../llm-chat-app-template
echo "Deploying llm-chat-app-template-v2..."
npx wrangler deploy -c wrangler.jsonc
ANALYZER_DOMAIN=$(npx wrangler deployments list | grep -oP 'llm-chat-app-template-v2\.\K[^/]+' | head -1)
ANALYZER_URL="https://llm-chat-app-template-v2.${ANALYZER_DOMAIN}.workers.dev"
if [ -z "$ANALYZER_DOMAIN" ]; then
  echo "⚠️  Could not auto-detect domain. Please set it manually in next step."
  ANALYZER_URL="https://llm-chat-app-template-v2.YOUR_DOMAIN.workers.dev"
fi
echo "ℹ️  llm-chat-app-template-v2 URL: $ANALYZER_URL"

cd ../prompt-generator
echo "Deploying prompt-generator-cf..."
npx wrangler deploy -c wrangler.jsonc
PROMPT_DOMAIN=$(npx wrangler deployments list | grep -oP 'prompt-generator-cf\.\K[^/]+' | head -1)
PROMPT_URL="https://prompt-generator-cf.${PROMPT_DOMAIN}.workers.dev"
if [ -z "$PROMPT_DOMAIN" ]; then
  echo "⚠️  Could not auto-detect domain. Please set it manually in next step."
  PROMPT_URL="https://prompt-generator-cf.YOUR_DOMAIN.workers.dev"
fi
echo "ℹ️  prompt-generator-cf URL: $PROMPT_URL"

cd ../text-to-image-template
echo "Deploying text-to-image-template..."
npx wrangler deploy -c wrangler.json
IMAGE_DOMAIN=$(npx wrangler deployments list | grep -oP 'text-to-image-template\.\K[^/]+' | head -1)
IMAGE_URL="https://text-to-image-template.${IMAGE_DOMAIN}.workers.dev"
if [ -z "$IMAGE_DOMAIN" ]; then
  echo "⚠️  Could not auto-detect domain. Please set it manually in next step."
  IMAGE_URL="https://text-to-image-template.YOUR_DOMAIN.workers.dev"
fi
echo "ℹ️  text-to-image-template URL: $IMAGE_URL"

echo "✅ Workers deployed"

# ============================================================================
# STEP 8: Set Secrets - telegram-news-bot
# ============================================================================

echo ""
echo "🔐 Setting Secrets for telegram-news-bot"
echo "========================================"

cd ../llm-chat-app-template/telegrambot

if [ ! -z "$TELEGRAM_BOT_TOKEN" ] && [ "$TELEGRAM_BOT_TOKEN" != "YOUR_TELEGRAM_BOT_TOKEN_HERE" ]; then
  echo "Setting TELEGRAM_BOT_TOKEN..."
  echo "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN -c wrangler.jsonc
fi

if [ ! -z "$ALLOWED_TELEGRAM_USER_ID" ] && [ "$ALLOWED_TELEGRAM_USER_ID" != "YOUR_USER_ID_HERE" ]; then
  echo "Setting ALLOWED_TELEGRAM_USER_ID..."
  echo "$ALLOWED_TELEGRAM_USER_ID" | npx wrangler secret put ALLOWED_TELEGRAM_USER_ID -c wrangler.jsonc
fi

echo "Setting ANALYZER_API_BASE..."
echo "$ANALYZER_URL" | npx wrangler secret put ANALYZER_API_BASE -c wrangler.jsonc

if [ ! -z "$BOT_NOTIFY_TOKEN" ] && [ "$BOT_NOTIFY_TOKEN" != "YOUR_BOT_NOTIFY_TOKEN_HERE" ]; then
  echo "Setting BOT_NOTIFY_TOKEN..."
  echo "$BOT_NOTIFY_TOKEN" | npx wrangler secret put BOT_NOTIFY_TOKEN -c wrangler.jsonc
fi

if [ ! -z "$PUBLIC_WEBHOOK_URL" ] && [ "$PUBLIC_WEBHOOK_URL" != "https://telegram-news-bot.YOUR_DOMAIN.workers.dev" ]; then
  echo "Setting PUBLIC_WEBHOOK_URL..."
  echo "$PUBLIC_WEBHOOK_URL" | npx wrangler secret put PUBLIC_WEBHOOK_URL -c wrangler.jsonc
fi

if [ ! -z "$TELEGRAM_WEBHOOK_SECRET" ] && [ "$TELEGRAM_WEBHOOK_SECRET" != "YOUR_WEBHOOK_SECRET_HERE" ]; then
  echo "Setting TELEGRAM_WEBHOOK_SECRET..."
  echo "$TELEGRAM_WEBHOOK_SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET -c wrangler.jsonc
fi

if [ ! -z "$TELEGRAM_CHANNEL_ID" ] && [ "$TELEGRAM_CHANNEL_ID" != "YOUR_CHANNEL_ID_HERE" ]; then
  echo "Setting TELEGRAM_CHANNEL_ID..."
  echo "$TELEGRAM_CHANNEL_ID" | npx wrangler secret put TELEGRAM_CHANNEL_ID -c wrangler.jsonc
fi

echo "✅ telegram-news-bot secrets set"

# ============================================================================
# STEP 9: Deploy telegram-news-bot
# ============================================================================

echo ""
echo "🚀 Deploying telegram-news-bot"
echo "=============================="

npx wrangler deploy -c wrangler.jsonc
BOT_DOMAIN=$(npx wrangler deployments list | grep -oP 'telegram-news-bot\.\K[^/]+' | head -1)
BOT_URL="https://telegram-news-bot.${BOT_DOMAIN}.workers.dev"
if [ -z "$BOT_DOMAIN" ]; then
  echo "⚠️  Could not auto-detect domain. Please set it manually."
  BOT_URL="https://telegram-news-bot.YOUR_DOMAIN.workers.dev"
fi
echo "ℹ️  telegram-news-bot URL: $BOT_URL"

echo "✅ telegram-news-bot deployed"

# ============================================================================
# STEP 10: Setup Telegram Webhook
# ============================================================================

echo ""
echo "🔗 Setting up Telegram Webhook"
echo "=============================="

echo "Waiting 5 seconds for worker to be ready..."
sleep 5

WEBHOOK_RESULT=$(curl -s "$BOT_URL/set-webhook")
echo "Webhook setup response: $WEBHOOK_RESULT"

if echo "$WEBHOOK_RESULT" | grep -q '"ok":true'; then
  echo "✅ Telegram webhook set successfully"
else
  echo "⚠️  Webhook setup might have failed. You can try manually:"
  echo "curl \"$BOT_URL/set-webhook\""
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ SETUP COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Worker URLs (save these!):"
echo "  🔍 Analyzer:     $ANALYZER_URL"
echo "  📝 Prompt:       $PROMPT_URL"
echo "  🖼️  Image:        $IMAGE_URL"
echo "  🤖 Bot:          $BOT_URL"
echo ""
echo "Next steps:"
echo "  1. Update render-bridge environment variables:"
echo "     - ANALYZER_API_BASE=$ANALYZER_URL"
echo "     - PROMPT_API_BASE=$PROMPT_URL"
echo "     - IMAGE_API_BASE=$IMAGE_URL"
echo "     - TELEGRAM_NOTIFY_URL=$BOT_URL/notify"
echo "     - TELEGRAM_NOTIFY_TOKEN=$BOT_NOTIFY_TOKEN"
echo "  2. Deploy render-bridge to Render.com"
echo ""
echo "Test:"
echo "  curl $BOT_URL/health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
