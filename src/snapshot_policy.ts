import { z } from "zod";

export const batchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceBucket: z.string().min(1),
  snapshotBucket: z.string().min(1),
  assets: z.array(z.object({
    assetId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    creatorId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    sourceKey: z.string().min(1),
    ingestion: z.enum(["received", "complete"]),
    processing: z.enum(["queued", "running", "complete"]),
    delivery: z.enum(["pending", "ready"])
  })).min(1)
});

export type Batch = z.infer<typeof batchSchema>;

export function snapshotKey(batch: Batch, asset: Batch["assets"][number]): string | null {
  if (asset.ingestion !== "complete" || asset.processing !== "complete" || asset.delivery !== "ready") return null;
  return `nightly/${batch.date}/creators/${asset.creatorId}/${asset.assetId}`;
}
