#!/bin/sh
# Pack an HTML file into one offline file. Usage: sh .cs-kit/pack.sh lesson.html
export ELECTRON_RUN_AS_NODE=1
if [ -n "$CS_NODE" ]; then exec "$CS_NODE" "$(dirname "$0")/pack.cjs" "$@"; else exec node "$(dirname "$0")/pack.cjs" "$@"; fi
