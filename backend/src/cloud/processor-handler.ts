import { validateDetection, type Detection } from '../processing/detector.js';
import type { CloudMedia } from './firestore-media.js';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { FirestoreMediaStore } from './firestore-media.js';
import { S3MediaStorage } from './s3-media.js';
import { createRecovery } from './recovery.js';
import type { S3Event, Context } from 'aws-lambda';
import { createProcessor, type ValidatedImage, type ValidatedVideo } from './processor.js';
const projectId = process.env.ECOGUARD_GCP_PROJECT;
const bucket = process.env.ECOGUARD_MEDIA_BUCKET;
const validator = process.env.ECOGUARD_IMAGE_VALIDATOR_FUNCTION;
if (projectId !== 'fit3184-g80-ecoguard-dg26' || !bucket || !validator) throw new Error('Missing cloud processor configuration.');
const region = process.env.AWS_REGION ?? 'us-east-1';
const lambda = new LambdaClient({ region });
const db = new Firestore({ projectId, keyFilename: fileURLToPath(new URL('../../config/aws-wif.json', import.meta.url)) });
const store = new FirestoreMediaStore(db);
const storage = new S3MediaStorage(new S3Client({ region }), bucket);
const inference = process.env.ECOGUARD_INFERENCE_FUNCTION;
const modelSha = process.env.ECOGUARD_MODEL_SHA256;
async function invokeModel(item: CloudMedia, mode: string, version: string) {
  if (!inference) throw new Error('Inference is not configured.');
  const response = await lambda.send(new InvokeCommand({ FunctionName: inference, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ mode, key: item.storageKey, version, checksum: item.checksum, size: item.size, contentType: item.contentType })) }));
  if (response.FunctionError || !response.Payload) throw new Error('Inference worker failed.');
  return JSON.parse(Buffer.from(response.Payload).toString());
}
const processMedia = createProcessor({
  store, storage,
  ...(inference && modelSha ? {
    validateVideo: async (item: CloudMedia, version: string) => await invokeModel(item, 'validate-video', version) as ValidatedVideo,
    model: { sha256: modelSha, async detect(item: CloudMedia): Promise<Detection & { duration?: number; sampledAt?: number[] }> {
      const result = await invokeModel(item, item.contentType === 'video/mp4' ? 'video' : 'image', item.sourceVersion!);
      validateDetection(result);
      return result;
    } },
  } : {}),
  async validate(item, version) {
    const response = await lambda.send(new InvokeCommand({ FunctionName: validator, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ mediaId: item.id, key: item.storageKey, version, checksum: item.checksum, size: item.size, contentType: item.contentType })) }));
    if (response.FunctionError || !response.Payload) throw new Error('Image validation Lambda is unavailable.');
    const result = JSON.parse(Buffer.from(response.Payload).toString()) as ValidatedImage;
    if (result.valid !== false && result.valid !== true) throw new Error('Invalid validation result.');
    return result;
  },
});

const recover = createRecovery({ store, storage, async enqueue(id) {
  await lambda.send(new InvokeCommand({ FunctionName: processEnvName(), InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ mediaId: id })) }));
} });
function processEnvName() { const name = globalThis.process.env.AWS_LAMBDA_FUNCTION_NAME; if (!name) throw new Error('Recovery requires a deployed worker.'); return name; }
export async function handler(event: S3Event | { mediaId?: string; reconcile?: boolean }, _context: Context) {
  return 'reconcile' in event && event.reconcile === true ? recover() : processMedia(event);
}
