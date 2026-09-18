#!/usr/bin/env bash
#
# Work through the whole image backlog in batches, one process per batch.
#
# analyse-all.mjs on its own is resumable but long-lived, and a run of 500 images
# grew until the host OOM killer took it at 156. Whatever accumulates across
# iterations, a fresh process returns it. The model reload costs about 15s per
# batch, which is a few minutes over a backlog of hundreds — cheap next to losing
# the run.
#
#   scripts/analyse-backlog.sh          # batches of 50
#   BATCH=25 scripts/analyse-backlog.sh # smaller, if memory is tight
#
set -u

BATCH=${BATCH:-50}
MONGO_URL=${MONGO_URL:-mongodb://localhost:27018/zap}
export MONGO_URL

remaining() {
  node -e '
    import("./utils/MongoConnexion.js").then(async ({ default: m }) => {
      const db = await m.db();
      const n = await db.collection("data").countDocuments({
        type: /^image\//, labels: { $exists: false }, analyseFailed: { $exists: false },
      });
      console.log(n);
      await m.close();
    });
  '
}

round=0
while true; do
  left=$(remaining)
  if [ -z "$left" ] || [ "$left" -eq 0 ] 2>/dev/null; then
    echo "analyse-backlog: nothing left to do"
    break
  fi

  round=$((round + 1))
  echo "=== round $round — $left outstanding ==="

  if ! node scripts/analyse-all.mjs "$BATCH"; then
    # A batch that dies takes its progress with it only for the image in flight;
    # everything it finished is already recorded, so carrying on is safe. Stop if
    # a round achieves nothing, or this becomes an infinite loop.
    echo "analyse-backlog: round $round exited non-zero"
    after=$(remaining)
    if [ "$after" = "$left" ]; then
      echo "analyse-backlog: no progress made, giving up"
      exit 1
    fi
  fi
done
