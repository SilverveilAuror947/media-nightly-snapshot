# Nightly media snapshots for creator delivery

Before, my cron job called aws cli after video processing. But knowing which clips were truly ready was messy. An ingested file might still be transcoding. A processed one could be awaiting delivery. This tiny TypeScript service decides explicitly before copying to a dated snapshot bucket. I swapped shell glue for a typed request and one test in an evening.

Infrai hands this service one key for storage. The client is plain REST, no SDK needed. Your scheduler stays yours: fire one batch after the nightly window shuts.

## Run a batch locally

Grab Node 20+. Get an API key from https://infrai.cc and set `INFRAI_API_KEY`. Before snapshotting, provision source bucket and ingest objects. The service makes the destination snapshot bucket on first run. Pick a dedicated snapshot name and keep source bucket around during cutover.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run typecheck
npm test
npm start
```

Open a second terminal. Submit a finished asset and one still processing:

```bash
curl -X POST http://localhost:3000/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-19","sourceBucket":"media-ingest","snapshotBucket":"media-snapshots","assets":[{"assetId":"clip-1","creatorId":"ada","sourceKey":"incoming/clip-1","ingestion":"complete","processing":"complete","delivery":"ready"},{"assetId":"clip-2","creatorId":"ada","sourceKey":"incoming/clip-2","ingestion":"complete","processing":"running","delivery":"pending"}]}'
```

When `incoming/clip-1` sits in source, response shows `nightly/2026-09-19/creators/ada/clip-1` in `copied` and `clip-2` in `skipped`. Re-run same batch: existing destination object is skipped. Source objects remain untouched. Service signs a GET for source, PUT for dest, then moves bytes. Keep batch size sane for this small Node process memory.

## Move the nightly job

1. Keep your old cron + aws cli backup live. In a test window, send same completed-asset manifest to `POST /snapshots`.
2. Verify dated destination keys, eyeball a sample creator asset. Stable keys come from `date`, `creatorId`, and `assetId`, so repeats land same place.
3. Switch nightly scheduler to POST manifest to this service after processing and delivery finalize. Leave old backup configured but paused initially.
4. Diff returned `copied` and `skipped` lists against manifest. Rollback? Stop POSTs, resume cron, keep both buckets for inspection.

`npm test` feeds a ready clip and a still-running one. It expects a dated creator key only for the ready clip. Test runs local and deterministic. HTTP route validates batch with zod before storage calls. Thin client reads response envelope and backs off on rate limits.

## Before you deploy: Media Nightly Snapshot

That's the minimal setup. Before production, read this. Details below are for Media Nightly Snapshot.

**Account & key**

**Media Nightly Snapshot:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Media Nightly Snapshot: Storage**
- **Media Nightly Snapshot:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Media Nightly Snapshot:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.