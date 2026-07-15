# 🔧 Technical Debugging & Fix Guide
**System:** Cloudflare Workers RSS→Telegram Pipeline  
**Generated:** 2026-06-18T17:02:57+03:30  
**Purpose:** Step-by-step debugging and remediation

---

## 🎯 Top Priority: Fix Analyzer 500 Errors

### Issue Details
- **Frequency:** 3 out of 11 runs (27% failure rate)
- **Error Message:** "Analyzer request failed with status 500"
- **Failed Run IDs:** 
  - e56626d1 (2026-06-18T11:10:11Z)
  - 702a0f5e (2026-06-18T11:08:47Z)
  - 41dbba8e (2026-06-17T06:49:30Z)

### Step-by-Step Debugging

#### Step 1: Examine Analyzer Worker Source Code
```bash
# Review the analyzer implementation
cat llm-chat-app-template/src/index.ts | head -100

# Check for error handling
grep -n "500\|error\|try\|catch" llm-chat-app-template/src/index.ts

# Look for the /api/analyze endpoint
grep -n "api/analyze\|POST.*analyze" llm-chat-app-template/src/index.ts
```

#### Step 2: Check Workers AI Binding Configuration
```bash
# View wrangler config
cat llm-chat-app-template/wrangler.jsonc | grep -A 10 "ai\|Workers.*AI\|binding"

# Expected config should include:
# [[env.production.bindings]]
# name = "AI"
# type = "ai"
# - OR -
# [[ai]]
# binding = "AI"
```

**Required Fix If Missing:**
```jsonc
// In wrangler.jsonc, add:
[[ai]]
binding = "AI"
```

#### Step 3: Verify D1 Analysis Jobs Table Schema
```bash
# Get table structure
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT sql FROM sqlite_master 
   WHERE type="table" AND name="analysis_jobs";' 2>&1

# Expected output should show CREATE TABLE statement with columns:
# - id (INTEGER PRIMARY KEY)
# - external_id (TEXT)
# - analysis_text (TEXT) 
# - persona (TEXT)
# - created_at (DATETIME)
# - status (TEXT) - optional
```

**Check Row Count:**
```bash
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT COUNT(*) as jobs_total, 
          SUM(CASE WHEN analysis_text IS NOT NULL THEN 1 ELSE 0 END) as with_analysis,
          SUM(CASE WHEN analysis_text IS NULL THEN 1 ELSE 0 END) as without_analysis
   FROM analysis_jobs;' 2>&1
```

#### Step 4: Test Analyzer Endpoint Directly

**Test 1: Simple Health Check**
```bash
curl -v 'https://llm-chat-app-template-meiti-v1.prompt-generator.workers.dev/health' \
  -H 'Content-Type: application/json' 2>&1 | grep -E "HTTP|error"
```

**Test 2: Direct Analysis Request**
```bash
curl -X POST \
  'https://llm-chat-app-template-meiti-v1.prompt-generator.workers.dev/api/analyze' \
  -H 'Content-Type: application/json' \
  -d '{
    "external_id": "debug-test-123",
    "title": "Test Article Title",
    "link": "https://example.com/article",
    "summary": "This is a test summary of the article",
    "persona": "tech_analyst"
  }' 2>&1 | jq '.'
```

**Expected Success Response:**
```json
{
  "success": true,
  "external_id": "debug-test-123",
  "analysis_text": "Detailed analysis...",
  "sentiment": "neutral",
  "status": "created"
}
```

**If Getting 500:**
```json
{
  "error": "Internal Server Error",
  "message": "..."
}
```

#### Step 5: Stream Real Analyzer Logs
```bash
# This opens a live log stream (requires a new terminal)
wrangler --config llm-chat-app-template/wrangler.jsonc tail \
  --status error \
  --status success \
  --format json 2>&1

# OR filter to just errors
wrangler --config llm-chat-app-template/wrangler.jsonc tail \
  --status error 2>&1
```

**What to look for in logs:**
- Worker startup messages
- D1 connection status
- Workers AI model errors
- Database write failures

---

### Hypothesis Testing

#### Hypothesis A: Missing Workers AI Binding
**Test Command:**
```bash
# Check if AI model is referenced in code
grep -r "AI\.inference\|llm\|gpt" llm-chat-app-template/src/

# If not found, then AI binding is definitely missing
```

**If Confirmed:**
```bash
# Fix: Add AI binding to wrangler.jsonc
# File: llm-chat-app-template/wrangler.jsonc
# Add section:

[[ai]]
binding = "AI"

# Then redeploy
wrangler --config llm-chat-app-template/wrangler.jsonc deploy
```

#### Hypothesis B: D1 Write Failure
**Test Command:**
```bash
# Try a direct write to analysis_jobs
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'INSERT INTO analysis_jobs (external_id, analysis_text, persona) 
   VALUES ("test-write-123", "test analysis", "tech_analyst")
   RETURNING *;' 2>&1
```

**If This Fails:**
- Schema mismatch (missing required columns)
- Foreign key constraint violation
- D1 storage limit reached

**Check Schema Mismatch:**
```bash
# Show full table structure
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'PRAGMA table_info(analysis_jobs);' 2>&1 | jq '.results'

# Compare against migrations/001_persona_memory.sql
cat llm-chat-app-template/migrations/001_persona_memory.sql | grep -A 20 "analysis_jobs"
```

#### Hypothesis C: GPT-OSS 120B Model Availability
**Test Command:**
```bash
# List available models (if endpoint exists)
curl 'https://llm-chat-app-template-meiti-v1.prompt-generator.workers.dev/api/models' \
  -H 'Content-Type: application/json' 2>&1

# Or check worker logs for model loading errors
```

**If Model Unavailable:**
- Check Cloudflare Workers AI status page
- Try fallback model (e.g., Llama 3 70B)
- Update worker to use alternative model

---

## 🔍 Second Priority: Analysis Polling Timeout

### Issue Details
- **Error:** "Analyzer finished but no analysis text was available before timeout"
- **Timeout:** 30 seconds
- **Affected Run:** f4feb4bb (2026-06-17T06:47:01Z)

### Root Cause: Analyzer Write to D1 Failed

The bridge does this:
1. Sends POST /api/analyze to analyzer
2. Gets 200 OK response (analyzer received request)
3. Waits for analyzer to write result to D1
4. Polls D1 table for `analysis_jobs` with matching external_id
5. 30 seconds pass, no result → timeout

**The gap:** Analyzer received request but failed to write to D1.

### Debugging Steps

#### Test 1: Verify Polling is Working
```bash
# Simulate what bridge does:
EXTERNAL_ID="news-376024b1"

# 1. Check if record exists
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  "SELECT * FROM analysis_jobs 
   WHERE external_id = '$EXTERNAL_ID';" 2>&1 | jq '.results'

# Expected: Should return row with analysis_text populated
```

#### Test 2: Check for Stuck/Incomplete Writes
```bash
# Find jobs WITHOUT analysis_text
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT external_id, persona, created_at, 
          (analysis_text IS NULL) as missing_analysis
   FROM analysis_jobs 
   WHERE analysis_text IS NULL 
   LIMIT 10;' 2>&1
```

#### Test 3: Trigger New Analysis & Monitor Write
```bash
# Terminal 1: Stream logs
wrangler --config llm-chat-app-template/wrangler.jsonc tail --status error

# Terminal 2: Send test request
curl -X POST \
  'https://llm-chat-app-template-meiti-v1.prompt-generator.workers.dev/api/analyze' \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"poll-test-001","title":"Test","link":"http://test.com","summary":"Test"}'

# Terminal 3: Check if written to D1
sleep 5
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  "SELECT * FROM analysis_jobs WHERE external_id='poll-test-001';"
```

### Solution
Ensure analyzer worker:
1. Catches all exceptions in try/catch
2. Logs errors before throwing
3. Writes partial results even on failure
4. Returns error status in response

**Code Pattern to Check For:**
```typescript
try {
  const result = await analyzeWithAI(title, summary);
  
  // MUST write to D1 even if analysis fails
  await db.prepare(
    'INSERT INTO analysis_jobs (external_id, analysis_text, persona, status) VALUES (?, ?, ?, ?)'
  ).bind(externalId, result.text, persona, 'completed').run();
  
  return new Response(JSON.stringify({success: true}));
} catch (error) {
  // Log error BEFORE throwing
  console.error('Analysis failed:', error);
  
  // Still try to write error status
  await db.prepare(
    'INSERT INTO analysis_jobs (external_id, status, error) VALUES (?, ?, ?)'
  ).bind(externalId, 'failed', error.message).run();
  
  return new Response(JSON.stringify({error: error.message}), {status: 500});
}
```

---

## 🔑 Third Priority: Telegram 401 Unauthorized

### Issue Details
- **Error:** "Telegram notify failed with status 401: Unauthorized notify call"
- **Affected Run:** 9d61eee1 (2026-06-18T10:44:13Z)
- **Expected Token:** "REDACTED_NOTIFY_VAR"

### Token Flow Verification

#### Step 1: Check Bridge is Sending Token
```bash
# Look at bridge-do.ts sendTelegramNotify function
grep -B 5 -A 15 "callTelegramNotify\|telegram.*notify\|401" \
  worker-bridge/src/bridge-do.ts

# Look for this pattern:
# headers: {
#   'x-notify-token': this.env.NOTIFY_SHARED_TOKEN,
#   'Content-Type': 'application/json'
# }
```

#### Step 2: Check Bot is Validating Token Correctly
```bash
# Look at telegram bot token validation
grep -B 5 -A 15 "isValidNotifyToken\|x-notify-token\|Bearer" \
  llm-chat-app-template/telegrambot/index.js

# Should validate both:
# - x-notify-token header
# - Authorization: Bearer token in auth header
```

#### Step 3: Verify Environment Variables Match
```bash
# Bridge config
echo "=== Bridge NOTIFY_SHARED_TOKEN ===" && \
npx wrangler --config worker-bridge/wrangler.jsonc secret list 2>&1 | grep -i notify

# Telegram bot config (llm-chat-app-template)
echo "=== Telegram Bot BOT_NOTIFY_TOKEN ===" && \
npx wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc secret list 2>&1 | grep -i notify

# Should both reference or contain: "REDACTED_NOTIFY_VAR"
```

#### Step 4: Manual Token Validation Test
```bash
# Get the actual token values (for debugging - don't commit these!)
# Bridge
BRIDGE_NOTIFY_TOKEN=$(npx wrangler --config worker-bridge/wrangler.jsonc secret list 2>&1 | grep NOTIFY_SHARED_TOKEN | awk '{print $2}')

# Send test notify request
curl -v -X POST \
  'https://telegram-news-bot-meiti-v1.prompt-generator.workers.dev/notify' \
  -H 'x-notify-token: REDACTED_NOTIFY_VAR' \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"test-401","title":"Test"}' 2>&1 | grep -E "401|200|Unauthorized"
```

#### Step 5: If Still 401, Reset Tokens
```bash
# Option 1: Update bridge to use correct token name
wrangler --config worker-bridge/wrangler.jsonc secret put NOTIFY_SHARED_TOKEN
# Enter: REDACTED_NOTIFY_VAR

# Option 2: Redeploy both workers to sync
wrangler --config worker-bridge/wrangler.jsonc deploy
wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc deploy

# Option 3: Check if using Bearer auth instead of header
grep -A 5 "Authorization\|Bearer" llm-chat-app-template/telegrambot/index.js
```

---

## 🧹 Cleanup: Stuck Run (>24 hours)

### Issue Details
- **Run ID:** 74f8df0f (since 2026-06-17T06:24:15Z)
- **Status:** "running" (should complete in <5 minutes)
- **Impact:** Durable Object state may be corrupted

### Remediation Steps

#### Option 1: Graceful Restart
```bash
# Redeploy worker-bridge (this clears DO state automatically)
wrangler --config worker-bridge/wrangler.jsonc deploy --force

# Monitor next execution
sleep 5
curl 'https://worker-bridge.prompt-generator.workers.dev/status' \
  | jq '.status.runs[0]'
# Should show new run with fresh status, not stuck one
```

#### Option 2: Direct DO Access (If Available)
```bash
# If DO has admin endpoint to reset state:
curl -X POST \
  'https://worker-bridge.prompt-generator.workers.dev/__reset-do-state' \
  -H 'x-admin-token: <ADMIN_SECRET>'
```

#### Option 3: Database Cleanup
```bash
# Mark stuck run as error
npx wrangler --config worker-bridge/wrangler.jsonc d1 execute \
  --binding BRIDGE_DB --remote --command \
  "UPDATE run_log 
   SET status='error', error_text='Stuck run - restarted by admin'
   WHERE run_id='74f8df0f-471f-46e4-b863-e2746872a23a';" 2>&1
```

---

## 🚀 Verification After Each Fix

### After Fixing Analyzer 500 Errors

```bash
# 1. Trigger test run
curl -X POST 'https://worker-bridge.prompt-generator.workers.dev/run-rss' \
  -H 'x-run-token: <RUN_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"source":"post-fix-test"}'

# 2. Wait 5 seconds for processing
sleep 5

# 3. Check status
curl 'https://worker-bridge.prompt-generator.workers.dev/status' \
  | jq '.status.runs[0]' | head -20

# Expected results:
# - status: "sent" ✅ OR "analysis_sent" (processing)
# - error_text: null ✅
# - No 500 in response

# 4. Monitor telegram delivery
# Check user chat 6512947443 for new message

# 5. Verify D1 updates
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT COUNT(*) FROM analysis_jobs 
   WHERE created_at > datetime("now", "-5 minutes");'
```

### After Fixing Telegram 401

```bash
# 1. Manually trigger notification
curl -X POST \
  'https://telegram-news-bot-meiti-v1.prompt-generator.workers.dev/notify' \
  -H 'x-notify-token: REDACTED_NOTIFY_VAR' \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"news-376024b1","title":"Test Fix"}'

# 2. Check response
# Expected: 200 OK with delivery confirmation

# 3. Verify telegram delivery
# Check user 6512947443 chat history

# 4. Check bridge status for this notification
curl 'https://worker-bridge.prompt-generator.workers.dev/status' \
  | jq '.status.pendingNotifications[] | select(.external_id=="news-376024b1")'
```

### Full System Test After All Fixes

```bash
#!/bin/bash
# Complete validation script

echo "=== 1. Trigger New Run ==="
curl -s -X POST 'https://worker-bridge.prompt-generator.workers.dev/run-rss' \
  -H 'x-run-token: <RUN_SECRET>'

echo -e "\n=== 2. Wait for Processing ==="
sleep 10

echo -e "\n=== 3. Check Bridge Status ==="
curl -s 'https://worker-bridge.prompt-generator.workers.dev/status' \
  | jq '.status.runs[0] | {status, error_text, external_id}'

echo -e "\n=== 4. Check Analyzer Jobs ==="
npx wrangler --config llm-chat-app-template/wrangler.jsonc d1 execute \
  llm_persona_memory_v2 --remote --command \
  'SELECT external_id, analysis_text IS NOT NULL as has_analysis 
   FROM analysis_jobs 
   ORDER BY created_at DESC LIMIT 1;' 2>&1 | tail -15

echo -e "\n=== 5. Check Prompts Generated ==="
npx wrangler --config prompt-generator/wrangler.jsonc d1 execute \
  prompt_generator_db --remote --command \
  'SELECT COUNT(*) as total FROM prompts;' 2>&1 | tail -10

echo -e "\n=== 6. Manual Telegram Test ==="
curl -s -X POST \
  'https://telegram-news-bot-meiti-v1.prompt-generator.workers.dev/notify' \
  -H 'x-notify-token: REDACTED_NOTIFY_VAR' \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"test-validation","title":"Full System Test"}' \
  | jq '.'

echo -e "\n✅ Validation Complete"
```

---

## 📋 Debugging Checklist

- [ ] Analyzer 500 errors investigated
- [ ] Workers AI binding verified
- [ ] D1 analysis_jobs schema confirmed
- [ ] Direct test to analyzer endpoint works
- [ ] Live logs examined for errors
- [ ] Polling timeout root cause found
- [ ] D1 writes verified working
- [ ] Telegram token synchronization checked
- [ ] Stuck run cleaned up
- [ ] Post-fix verification test passed
- [ ] Full system end-to-end test completed
- [ ] All workers return success status
- [ ] D1 data written correctly
- [ ] Telegram messages delivered

---

## 🆘 Emergency Contacts / Recovery

### If Workers Are Completely Down
```bash
# Deploy from latest source
wrangler --config worker-bridge/wrangler.jsonc deploy
wrangler --config llm-chat-app-template/wrangler.jsonc deploy
wrangler --config prompt-generator/wrangler.jsonc deploy
wrangler --config text-to-image-template/wrangler.jsonc deploy
```

### If D1 Is Corrupted
```bash
# Backup current state
wrangler d1 backup llm_persona_memory_v2

# Restore from backup
wrangler d1 restore llm_persona_memory_v2 <BACKUP_ID>

# Re-run migrations
wrangler d1 execute llm_persona_memory_v2 --file ./migrations/001_persona_memory.sql
wrangler d1 execute llm_persona_memory_v2 --file ./migrations/002_analysis_reference_samples.sql
```

### If Telegram Bot Is Broken
```bash
# Check bot is listening on correct port/path
# Redeploy bot
wrangler --config llm-chat-app-template/telegrambot/wrangler.jsonc deploy

# Verify Telegram webhook
curl -X GET "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

---

*Debugging Guide v1.0*  
*Last Updated: 2026-06-18T17:02:57+03:30*
