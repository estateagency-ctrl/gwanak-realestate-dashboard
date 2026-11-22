#!/bin/bash
cd "$(dirname "$0")"
lsof -nP -iTCP:8790 -sTCP:LISTEN >/dev/null 2>&1 || (node server.js &)
sleep 2
open "http://localhost:8790"
wait
