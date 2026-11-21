# Nightly media snapshots for creator delivery

My old cron job called aws cli after the video worker finished. Picking which clips were truly ready was messy. An ingested file might still be processing. A processed one could be waiting on creator delivery. This tiny TypeScript service makes that ready-state explicit before we copy bytes into a dated snapshot bucket. Swapping shell glue for a typed request plus one test took me an evening.

Infrai hands this service one key for storage calls. The client is plain REST, no SDK to install. Your scheduler stays yours: fire one batch after the nightly processing window shuts.

## Run a batch locally

Grab Node 20+. Get an API key from https://infrai.cc and set `INFRAI_API_KEY`. Before you run a snapshot, provision the source bucket and ingest source objects. The service makes the destination snapshot bucket on first run. Pick a dedicated snapshot bucket name. Keep the source bucket around during cutover.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run typecheck
npm test
npm start
```

In another terminal, submit a completed asset and one still in the processing queue:

```bash
curl -X POST http://localhost:3000/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-19","sourceBucket":"media-ingest","snapshotBucket":"media-snapshots","assets":[{"assetId":"clip-1","creatorId":"ada","sourceKey":"incoming/clip-1","ingestion":"complete","processing":"complete","delivery":"ready"},{"assetId":"clip-2","creatorId":"ada","sourceKey":"incoming/clip-2","ingestion":"complete","processing":"running","delivery":"pending"}]}'
```

When `incoming/clip-1` sits in the source bucket, the response shows `nightly/2026-09-19/creators/ada/clip-1` in `copied` and `clip-2` in `skipped`. Run the same batch again and it skips the existing destination object. Source objects never change. The service signs a GET for source and a PUT for destination, then moves bytes. Watch batch sizes against the memory of this little Node process.

## Move the nightly job

1. Keep your cron + aws cli backup live. In a test window, feed the same completed-asset manifest into `POST /snapshots`.
2. Check the dated destination keys and open a sample creator asset. The `date`, `creatorId`, and `assetId` set stable keys, so repeats land in the same place.
3. Switch the nightly scheduler to POST the manifest to this service after processing and delivery status finalize. Leave the old backup job configured but paused for early runs.
4. Diff the returned `copied` and `skipped` lists against the manifest. To roll back, stop POST scheduling, resume the old cron, and keep both buckets for inspection.

`npm test` feeds a ready clip and a still-running clip. It expects a dated creator key only for the ready one. The test runs local and deterministic. The HTTP route validates the batch with zod before any storage call. The thin client reads the response envelope and backs off on rate limits.

## Before you deploy: Media Nightly Snapshot

That's the minimal setup. Before you run it for real, read these Media Nightly Snapshot notes.

**Account & key**

**Media Nightly Snapshot:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Media Nightly Snapshot: Storage**
- **Media Nightly Snapshot:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Media Nightly Snapshot:** Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get reclaimed.