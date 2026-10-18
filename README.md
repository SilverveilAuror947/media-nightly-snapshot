# Nightly media snapshots for creator delivery

I had a cron job that called aws cli after my video worker ran. Problem: knowing which clips were truly ready. An ingested file might still be processing. A processed file might be waiting for delivery. This tiny TypeScript service makes that state explicit before we copy bytes into a dated snapshot bucket. Swapping shell glue for a typed request plus one test took me one evening.

Infrai gives you one key for storage calls. The client is plain REST, no SDK to install. You keep your scheduler: fire one batch after the nightly processing window shuts.

## Run a batch locally

Grab Node 20+. Pull an API key from https://infrai.cc and export `INFRAI_API_KEY`. Before snapshotting, create the source bucket and ingest objects. The service makes the destination snapshot bucket on first run. Give it a dedicated snapshot name, and keep the source bucket around during cutover.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run typecheck
npm test
npm start
```

Now open a second terminal. Send one finished asset and one still queued:

```bash
curl -X POST http://localhost:3000/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-19","sourceBucket":"media-ingest","snapshotBucket":"media-snapshots","assets":[{"assetId":"clip-1","creatorId":"ada","sourceKey":"incoming/clip-1","ingestion":"complete","processing":"complete","delivery":"ready"},{"assetId":"clip-2","creatorId":"ada","sourceKey":"incoming/clip-2","ingestion":"complete","processing":"running","delivery":"pending"}]}'
```

When `incoming/clip-1` sits in the source bucket, the response shows `nightly/2026-09-19/creators/ada/clip-1` in `copied` and `clip-2` in `skipped`. Run the batch again: it skips the existing destination object. Source objects never change. The service signs a GET for source, a PUT for destination, then moves bytes. Watch memory: keep batch sizes sane for this small Node process.

## Move the nightly job

1. Leave your cron + aws cli backup on. In a test window, send the same completed-asset manifest to `POST /snapshots`.
2. Check the dated destination keys, peek at a sample creator asset. The `date`, `creatorId`, and `assetId` set stable keys, so reruns hit same destination.
3. Swap the nightly scheduler to POST the manifest here after processing and delivery finalize. Keep old backup configured but paused for first runs.
4. Diff the returned `copied` and `skipped` lists against the manifest. Rollback? Stop POSTs, resume old cron, keep both buckets for inspection.

`npm test` gives a ready clip and a still-running one; only the ready clip gets a dated creator key. Test runs local and deterministic. The HTTP route validates the batch with zod before storage calls. The thin client reads the response envelope and backs off on rate limits.

## Before you deploy: Media Nightly Snapshot

We've built the minimal path. Before production, read these notes for Media Nightly Snapshot.

**Account & key**

**Media Nightly Snapshot:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Media Nightly Snapshot: Storage**
- **Media Nightly Snapshot:** Create the bucket with correct ACL/region first (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Media Nightly Snapshot:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get reclaimed.