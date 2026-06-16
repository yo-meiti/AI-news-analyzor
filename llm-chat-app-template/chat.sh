#!/usr/bin/env bash
set -euo pipefail

WORKER_URL="${WORKER_URL:-https://llm-chat-app-template-v2.ysblasqsla.workers.dev}"

if [[ $# -lt 1 ]]; then
	echo "Usage: ./chat.sh \"خبر یا درخواست تحلیل\""
	exit 1
fi

USER_TEXT="$*"
FULL_TEXT=""

curl -N -sS -X POST "${WORKER_URL}/api/chat" \
	-H "Content-Type: application/json" \
	--data "$(printf '{"messages":[{"role":"user","content":%s}]}' "$(printf '%s' "$USER_TEXT" | jq -Rs .)")" \
| while IFS= read -r line; do
	if [[ "$line" != data:* ]]; then
		continue
	fi

	payload="${line#data: }"
	if [[ -z "$payload" || "$payload" == "[DONE]" ]]; then
		continue
	fi

	chunk="$(printf '%s' "$payload" | jq -r '
		if type != "object" then ""
		else
			(.response // .choices[0].delta.content // "")
		end
	' 2>/dev/null || true)"

	if [[ -n "$chunk" && "$chunk" != "null" ]]; then
		FULL_TEXT+="$chunk"
	fi
done

printf '%b\n' "$FULL_TEXT"
