#!/usr/bin/env bash
set -euo pipefail
project="lsl-bot"
revision=$(git rev-parse HEAD)
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
npm ci --ignore-scripts --no-audit --no-fund
npm test
git archive --format=tar HEAD | tar -x -C "$stage"
python3 - "$stage" "$project" "$revision" <<'PYTHON'
from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1])
hashes={str(p.relative_to(root)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
(root/'.source-sha256.json').write_text(json.dumps(hashes,sort_keys=True)+'\n')
(root/'.deployment.json').write_text(json.dumps({'project':sys.argv[2],'revision':sys.argv[3]})+'\n')
PYTHON
tar -czf release.tar.gz -C "$stage" .
