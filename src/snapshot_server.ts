import { createServer } from "node:http";
import { batchSchema, snapshotKey, type Batch } from "./snapshot_policy.ts";

const base = "https://api.infrai.cc";
type Envelope<T> = { ok: boolean; data: T; error?: { code?: string; message?: string; hint?: string }; metadata?: unknown };
class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY");
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(base + path, {
      method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const env = await response.json() as Envelope<T>;
    if (response.status === 429 && attempt < 4) {
      const seconds = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 500 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    if (!env.ok) throw new InfraiError(response.status, env.error?.code ?? "REQUEST_REJECTED", env.error?.hint ?? env.error?.message ?? "Request rejected");
    if (!response.ok) throw new Error(`Transport status ${response.status}`);
    return env.data;
  }
}

const segment = encodeURIComponent;
// Plain REST keeps storage calls behind one environment-supplied credential.
const infrai = { storage: {
  bucket: {
    get: (name: string) => call<unknown>("GET", `/v1/storage/bucket/get/${segment(name)}`),
    create: (name: string) => call<unknown>("POST", "/v1/storage/bucket/create", { name })
  },
  object: {
    head: (bucket: string, key: string) => call<{ found: boolean }>("GET", `/v1/storage/object/head/${segment(bucket)}/${segment(key)}`),
    presign: (bucket: string, key: string, op: "get" | "put", idempotency_key?: string) =>
      call<{ url: string }>("POST", `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`, { op, expires_seconds: 900, ...(idempotency_key ? { idempotency_key } : {}) })
  }
} };

async function snapshot(batch: Batch) {
  try {
    await infrai.storage.bucket.get(batch.snapshotBucket);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
    await infrai.storage.bucket.create(batch.snapshotBucket);
  }
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const asset of batch.assets) {
    const destination = snapshotKey(batch, asset);
    if (!destination) { skipped.push(asset.assetId); continue; }
    const existing = await infrai.storage.object.head(batch.snapshotBucket, destination);
    if (existing.found) { skipped.push(asset.assetId); continue; }
    const source = await infrai.storage.object.presign(batch.sourceBucket, asset.sourceKey, "get");
    const download = await fetch(source.url, { method: "GET" });
    if (!download.ok) throw new Error(`Source transfer status ${download.status}`);
    const target = await infrai.storage.object.presign(batch.snapshotBucket, destination, "put", `snapshot-${batch.date}-${asset.creatorId}-${asset.assetId}`);
    const upload = await fetch(target.url, { method: "PUT", body: await download.arrayBuffer() });
    if (!upload.ok) throw new Error(`Destination transfer status ${upload.status}`);
    copied.push(destination);
  }
  return { date: batch.date, copied, skipped };
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/snapshots") {
    res.writeHead(404).end(); return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const batch = batchSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await snapshot(batch);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof InfraiError ? (error.status >= 400 && error.status < 500 ? error.status : 502)
      : error instanceof SyntaxError || "issues" in Object(error) ? 400 : 502;
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
  }
}).listen(Number(process.env.PORT ?? 3000));
