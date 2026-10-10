import assert from "node:assert/strict";
import test from "node:test";
import { batchSchema, snapshotKey } from "./snapshot_policy.ts";

test("only processed creator deliveries enter the nightly snapshot", () => {
  const batch = batchSchema.parse({
    date: "2026-09-19", sourceBucket: "media-ingest", snapshotBucket: "media-snapshots",
    assets: [
      { assetId: "clip-1", creatorId: "ada", sourceKey: "incoming/clip-1", ingestion: "complete", processing: "complete", delivery: "ready" },
      { assetId: "clip-2", creatorId: "ada", sourceKey: "incoming/clip-2", ingestion: "complete", processing: "running", delivery: "pending" }
    ]
  });
  assert.equal(snapshotKey(batch, batch.assets[0]), "nightly/2026-09-19/creators/ada/clip-1");
  assert.equal(snapshotKey(batch, batch.assets[1]), null);
});
