import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { FirestoreMediaStore } from './firestore-media.js';
import { S3MediaStorage } from './s3-media.js';
import { createProcessor, type ValidatedImage } from './processor.js';
const projectId = process.env.ECOGUARD_GCP_PROJECT;
const bucket = process.env.ECOGUARD_MEDIA_BUCKET;
const validator = process.env.ECOGUARD_IMAGE_VALIDATOR_FUNCTION;
if (projectId !== 'fit3184-g80-ecoguard-dg26' || !bucket || !validator) throw new Error('Missing cloud processor configuration.');
const region = process.env.AWS_REGION ?? 'us-east-1';
const lambda = new LambdaClient({ region });
const db = new Firestore({ projectId, keyFilename: fileURLToPath(new URL('../../config/aws-wif.json', import.meta.url)) });
export const handler = createProcessor({
  store: new FirestoreMediaStore(db), storage: new S3MediaStorage(new S3Client({ region }), bucket),
  async validate(item, version) {
    const response = await lambda.send(new InvokeCommand({ FunctionName: validator, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ mediaId: item.id, key: item.storageKey, version, checksum: item.checksum, size: item.size, contentType: item.contentType })) }));
    if (response.FunctionError || !response.Payload) throw new Error('Image validation Lambda is unavailable.');
    const result = JSON.parse(Buffer.from(response.Payload).toString()) as ValidatedImage;
    if (result.valid !== false && result.valid !== true) throw new Error('Invalid validation result.');
    return result;
  },
});
