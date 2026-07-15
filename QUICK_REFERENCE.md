# ⚡ Quick Reference & Command Cheatsheet
**System:** Cloudflare Workers RSS→Telegram Pipeline  
**Purpose:** Fast lookup for common operations and troubleshooting  
**Date:** 2026-06-18

---

## 🎯 Quick Health Check (2 minutes)

```bash
#!/bin/bash
# Run this to get instant system status

echo "=== 1. Bridge Status ===" && \
curl -s 'https://worker-bridge.prompt-generator.workers.dev/status' | \
jq '.status | {runs: (.runs | length), sent: (.runs | map(select(.status == "sent")) | length), errors: (.runs | map(select(.status == "error")) | length)}' && \

echo -e "\n=== 2. D1 Analyzer Jobs ===" && \
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute llm_persona_memory_v2 --remote --command 'SELECT COUNT(*) FROM analysis_jobs;' 2>&1 | tail -10 && \

echo -e "\n=== 3. Prompts Generated ===" && \
npx wrangler --config prompt-generator/wrangler.jsonc d1 execute prompt_generator_db --remote --command 'SELECT COUNT(*) FROM prompts;' 2>&1 | tail -10 && \

echo -e "\n=== 4. Latest Run ===" && \
curl -s 'https://worker-bridge.prompt-generator.workers.dev/status' | \
jq '.status.runs[0]' && \

echo -e "\n✅ Health check complete"
```

---

## 🚀 Common Operations

### Start Manual Test Run
```bash
# Get the RUN_SECRET first
RUN_SECRET=$(npx wrangler --config worker-bridge/wrangler.jsonc secret list 2>&1 | grep RUN_SECRET | awk '{print $2}')

# Trigger run
curl -X POST 'https://worker-bridge.prompt-generator.workers.dev/run-rss' \
  -H "x-run-token: $RUN_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"source":"manual-test"}'

# Wait and check status
sleep 5
curl 'https://worker-bridge.prompt-generator.workers.dev/status' | jq '.status.runs[0]'
```

### View Live Worker Logs
```bash
# Terminal 1: Analyzer logs
wrangler --config llm-chat-app-template/wrangler.jsonc tail

# Terminal 2: Prompt Generator logs
wrangler --config prompt-generator/wrangler.jsonc tail

# Terminal 3: Bridge logs
wrangler --config worker-bridge/wrangler.jsonc tail

# Terminal 4: Telegram Bot logs
wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc tail
```

### Query D1 Data

**Analyzer Database:**
```bash
# Count analysis jobs
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT COUNT(*) as total FROM analysis_jobs;'

# Get latest analysis
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT external_id, analysis_text, created_at FROM analysis_jobs ORDER BY created_at DESC LIMIT 1;'

# Check persona state
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT persona_name, temperature, max_tokens FROM persona_state;'
```

**Prompt Database:**
```bash
# List all prompts
npx wrangler --config prompt-generator/wrangler.jsonc d1 execute \
  prompt_generator_db --remote --command \
  'SELECT external_id, title, prompt FROM prompts ORDER BY created_at DESC;'

# Count by date
npx wrangler --config prompt-generator/wrangler.jsonc d1 execute \
  prompt_generator_db --remote --command \
  'SELECT DATE(created_at) as date, COUNT(*) as count FROM prompts GROUP BY DATE(created_at);'
```

### Deploy Individual Workers

```bash
# Deploy bridge
wrangler --config worker-bridge/wrangler.jsonc deploy

# Deploy analyzer
wrangler --config llm-chat-app-template/wrangler.jsonc deploy

# Deploy prompt generator
wrangler --config prompt-generator/wrangler.jsonc deploy

# Deploy image generator
wrangler --config text-to-image-template/wrangler.jsonc deploy

# Deploy telegram bot
wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc deploy
```

### View Deployment History

```bash
# Last 5 deployments per worker
for config in worker-bridge llm-chat-app-template prompt-generator text-to-image-template; do
  echo "=== $config ==="
  npx wrangler --config $config/wrangler.jsonc deployments list | head -10
  echo
done
```

### List All Secrets

```bash
# Bridge secrets
echo "=== worker-bridge ===" && \
npx wrangler --config worker-bridge/wrangler.jsonc secret list && \

# Analyzer secrets
echo -e "\n=== llm-chat-app-template ===" && \
npx wrangler --config llm-chat-app-template/wrangler.jsonc secret list && \

# Telegram bot secrets
echo -e "\n=== telegram-news-bot ===" && \
npx wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc secret list && \

# Image generator secrets
echo -e "\n=== text-to-image-template ===" && \
npx wrangler --config text-to-image-template/wrangler.jsonc secret list
```

---

## 🔧 Troubleshooting Fast Fixes

### Analyzer Returning 500 Errors

**Quick Check:**
```bash
# Test analyzer endpoint directly
curl -X POST 'https://llm-chat-app-template-meiti-v1.prompt-generator.workers.dev/api/analyze' \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"test","title":"Test","link":"http://test.com","summary":"Test"}'
```

**Check Logs:**
```bash
wrangler --config llm-chat-app-template/wrangler.jsonc tail --status error
```

**Restart Analyzer:**
```bash
wrangler --config llm-chat-app-template/wrangler.jsonc deploy --force
```

---

### Telegram Bot Returns 401

**Verify Token Matches:**
```bash
# Expected token
echo "Expected: REDACTED_NOTIFY_VAR"

# Check bridge config
grep -r "NOTIFY_SHARED_TOKEN" worker-bridge/wrangler.jsonc

# Check bot code
grep -r "x-notify-token\|NOTIFY\|BOT_NOTIFY" llm-chat-app-template/telegrambot/index.js
```

**Fix Tokens:**
```bash
# Set bridge token
wrangler --config worker-bridge/wrangler.jsonc secret put NOTIFY_SHARED_TOKEN
# Enter: REDACTED_NOTIFY_VAR

# Set bot token (if needed)
wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc secret put BOT_NOTIFY_TOKEN
# Enter: REDACTED_NOTIFY_VAR

# Redeploy both
wrangler --config worker-bridge/wrangler.jsonc deploy
wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc deploy
```

---

### Message Not Reaching Telegram

**Check Telegram Bot Token:**
```bash
# Get token
TELEGRAM_TOKEN=$(npx wrangler --config text-to-image-template/wrangler.jsonc secret list 2>&1 | grep TELEGRAM_BOT_TOKEN | awk '{print $2}')

# Verify with Telegram
curl "https://api.telegram.org/bot$TELEGRAM_TOKEN/getMe" | jq '.ok'

# Should return: true
```

**Check User Chat ID:**
```bash
# Verify it's correct (should be 6512947443)
grep -r "6512947443\|TELEGRAM_DEFAULT_CHAT_ID\|chat_id" \
  text-to-image-template/wrangler.json llm-chat-app-template/telegrambot/index.js
```

**Test Direct Send:**
```bash
TELEGRAM_TOKEN="your-token-here"
curl -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":6512947443,"text":"Test message from CLI"}'
```

---

## 📊 Monitoring & Alerts

### Set Up Alert on Analysis Failures

```bash
#!/bin/bash
# Monitor for analyzer errors every 5 minutes

while true; do
  ERRORS=$(curl -s 'https://worker-bridge.prompt-generator.workers.dev/status' | \
    jq '.status.runs | map(select(.error_text != null)) | length')
  
  if [ "$ERRORS" -gt 3 ]; then
    echo "⚠️ ALERT: $ERRORS runs with errors detected"
    curl -X POST 'https://slack-webhook-url' \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"RSS Pipeline Alert: $ERRORS failed runs\"}"
  fi
  
  sleep 300
done
```

### Monitor D1 Storage Growth

```bash
#!/bin/bash
# Check D1 table sizes

for config in "llm-chat-app-template" "prompt-generator"; do
  db_name=$(echo $config | sed 's/-/_/g')_db
  
  echo "=== $db_name ==="
  npx wrangler --config $config/wrangler.jsonc d1 execute $db_name --remote --command \
    'SELECT name as table_name, COUNT(*) as rows FROM (SELECT name FROM sqlite_master WHERE type="table") GROUP BY name;'
  echo
done
```

---

## 📝 Secrets Reference

| Secret | Value | Used In | Where Set |
|--------|-------|---------|-----------|
| `RUN_SECRET` | bridge-run-auth-token | worker-bridge | POST /run-rss auth |
| `NOTIFY_SHARED_TOKEN` | REDACTED_NOTIFY_VAR | worker-bridge | x-notify-token header |
| `TELEGRAM_BOT_TOKEN` | 123456:ABC-... | text-to-image + telegram-bot | Telegram API auth |
| `BOT_NOTIFY_TOKEN` | REDACTED_NOTIFY_VAR | telegram-news-bot | Notification auth |
| `ALLOWED_TELEGRAM_USER_ID` | 6512947443 | telegram-news-bot | User whitelist |
| `PUBLIC_WEBHOOK_URL` | https://... | telegram-news-bot | Telegram webhook |
| `TELEGRAM_CHANNEL_ID` | -1001234567890 | telegram-news-bot | Broadcast channel |

**Update a Secret:**
```bash
wrangler --config <config-path>/wrangler.jsonc secret put <SECRET_NAME>
# Then paste the value and press Ctrl+D
```

---

## 🗄️ D1 Database Reference

### Database IDs

```
analyzer:     llm_persona_memory_v2
              ID: c30aba63-a360-4b89-9be0-c87a4c99bbfd
              Location: EEUR (ARN colo)

prompt_gen:   prompt_generator_db
              ID: 0f9c70fd-812e-4275-8925-e7dcdee12998
              Location: EEUR (ARN colo)
```

### Table Row Counts (Latest)

| Database | Table | Rows | Purpose |
|----------|-------|------|---------|
| llm_persona_memory_v2 | persona_state | 1 | Config |
| llm_persona_memory_v2 | analysis_jobs | N/A | Results |
| llm_persona_memory_v2 | conversation_turns | N/A | History |
| llm_persona_memory_v2 | analysis_reference_samples | N/A | Few-shot |
| prompt_generator_db | prompts | 6 | Generated |

### Run Migrations

```bash
# Analyzer DB
wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --file migrations/001_persona_memory.sql

wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --file migrations/002_analysis_reference_samples.sql

# Prompt Generator DB (if needed)
wrangler --config prompt-generator/wrangler.jsonc d1 execute \
  prompt_generator_db --remote --file schema.sql
```

---

## 🔍 Log Filtering Examples

### Find All 500 Errors in Last Hour
```bash
wrangler --config llm-chat-app-template/wrangler.jsonc tail --status error \
  --limit 100 2>&1 | grep "500\|error\|failed"
```

### Find All Successful Analyzer Calls
```bash
wrangler --config llm-chat-app-template/wrangler.jsonc tail --status success \
  --limit 50 2>&1 | grep "analyze\|analysis_text"
```

### Filter Bridge Logs by Run ID
```bash
wrangler --config worker-bridge/wrangler.jsonc tail --limit 200 2>&1 | \
  grep "e56626d1-8c65-4f68"
```

---

## 🎬 Standard Debugging Procedure

1. **Check System Status** (30s)
   ```bash
   curl 'https://worker-bridge.prompt-generator.workers.dev/status' | jq '.status.runs[0]'
   ```

2. **Identify Failing Component** (2m)
   - Analyzer? `→ Step 3A`
   - Prompt Gen? `→ Step 3B`
   - Image Gen? `→ Step 3C`
   - Telegram Bot? `→ Step 3D`

3A. **Debug Analyzer**
   ```bash
   wrangler --config llm-chat-app-template/wrangler.jsonc tail --status error
   curl -X POST 'https://...-v1.prompt-generator.workers.dev/api/analyze' ...
   ```

3B. **Debug Prompt Gen**
   ```bash
   wrangler --config prompt-generator/wrangler.jsonc tail --status error
   ```

3C. **Debug Image Gen**
   ```bash
   wrangler --config text-to-image-template/wrangler.jsonc tail --status error
   ```

3D. **Debug Telegram Bot**
   ```bash
   wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc tail --status error
   ```

4. **Check D1 (if data write issue)**
   ```bash
   npx wrangler --config ... d1 execute <db> --remote --command "SELECT ..."
   ```

5. **Redeploy Component** (if code issue)
   ```bash
   wrangler --config <path>/wrangler.jsonc deploy --force
   ```

6. **Verify Fix** (run test again)
   ```bash
   curl -X POST 'https://worker-bridge.../run-rss' -H "x-run-token: ..."
   ```

---

## 📱 Telegram Testing

### Send Test Message to User
```bash
TELEGRAM_TOKEN="your-token-from-secret"
CHAT_ID="6512947443"

curl -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "{\"chat_id\":$CHAT_ID,\"text\":\"Test from pipeline\"}"
```

### Get Last Messages from User
```bash
TELEGRAM_TOKEN="your-token"

curl "https://api.telegram.org/bot$TELEGRAM_TOKEN/getUpdates" | jq '.result[] | {from, text, date}'
```

---

## 🔐 Security Checklist

- [ ] All secrets stored in wrangler, not in code
- [ ] No secrets logged to worker logs
- [ ] x-notify-token validated on both sides
- [ ] x-run-token validated before processing
- [ ] D1 queries use parameterized binds (no SQL injection)
- [ ] Telegram messages don't leak analysis sources
- [ ] ALLOWED_TELEGRAM_USER_ID restricts access
- [ ] No production secrets in version control

---

## 📈 Performance Optimization Tips

### Speed Up Analysis
- Reduce `max_tokens` in persona_state
- Use smaller model (Llama 8B instead of GPT 120B)
- Implement caching for common topics

### Speed Up Image Generation
- Pre-generate stock images for common topics
- Use Flux 1 turbo (faster than Flux 2)
- Cache prompts in D1

### Speed Up Telegram Delivery
- Reduce polling interval (currently 2.5s)
- Implement webhook instead of polling
- Batch multiple images in single message

---

## 🆘 Emergency Recovery

### Complete System Reset
```bash
# 1. Redeploy all workers from latest code
for config in worker-bridge llm-chat-app-template prompt-generator text-to-image-template; do
  wrangler --config "$config/wrangler.jsonc" deploy --force
done

# 2. Verify all workers are running
sleep 10
curl 'https://worker-bridge.prompt-generator.workers.dev/status'

# 3. Trigger manual test
curl -X POST 'https://worker-bridge.prompt-generator.workers.dev/run-rss' \
  -H 'x-run-token: <SECRET>'
```

### Restore D1 from Backup
```bash
# List backups
wrangler d1 backup list llm_persona_memory_v2

# Restore from backup ID
wrangler d1 restore llm_persona_memory_v2 <BACKUP_ID>

# Re-apply migrations
wrangler d1 execute llm_persona_memory_v2 --file ./migrations/001_persona_memory.sql --remote
```

### Disable Cron Temporarily
```bash
# Comment out cron in wrangler.jsonc
# [[triggers.crons]]
# cron = "0 0 * * *"

# Deploy
wrangler --config worker-bridge/wrangler.jsonc deploy

# Re-enable later by uncommenting and redeploying
```

---

*Quick Reference v1.0 - Updated 2026-06-18T17:02:57+03:30*
