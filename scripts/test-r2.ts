/**
 * Vérification réelle des identifiants Cloudflare R2.
 * Écrit, relit puis supprime un objet de test.
 *
 *   node --env-file=.env.local .tmp/test-r2.mjs
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const account = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!account || !bucket || !accessKeyId || !secretAccessKey) {
  console.error("Configuration R2 incomplète.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const key = `health/${Date.now()}.txt`;
const payload = "creaad ok";

const describe = (e: unknown) => (e instanceof Error ? `${e.name} — ${e.message}` : String(e));

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`✔ bucket « ${bucket} » accessible`);
} catch (error) {
  console.log(`✖ bucket inaccessible : ${describe(error)}`);
  console.log("  → le bucket existe-t-il dans le compte ? le token a-t-il les droits ?");
  process.exit(1);
}

try {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: "text/plain" }),
  );
  console.log("✔ écriture OK");

  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await got.Body?.transformToString();
  console.log(`✔ relecture OK (${text === payload ? "contenu identique" : "CONTENU DIFFÉRENT"})`);

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log("✔ suppression OK");
} catch (error) {
  console.log(`✖ ${describe(error)}`);
  process.exit(1);
}
