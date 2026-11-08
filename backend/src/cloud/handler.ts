import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { createCognitoAuth } from '../auth.js';
import { ApiError } from '../http/errors.js';
import { createCloudApi } from './api.js';
import { FirestoreMediaStore } from './firestore-media.js';
import { S3MediaStorage } from './s3-media.js';

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing cloud setting: ${name}`);
  return value;
};
const projectId = required('ECOGUARD_GCP_PROJECT');
if (projectId !== 'fit3184-g80-ecoguard-dg26') throw new Error('Unexpected EcoGuard GCP project.');
const region = process.env.AWS_REGION ?? 'us-east-1';
const bucket = required('ECOGUARD_MEDIA_BUCKET');
const db = new Firestore({ projectId, keyFilename: fileURLToPath(new URL('../../config/aws-wif.json', import.meta.url)) });
const lambda = new LambdaClient({ region });
export const handler = createCloudApi({
  store: new FirestoreMediaStore(db),
  storage: new S3MediaStorage(new S3Client({ region }), bucket),
  auth: createCognitoAuth({ userPoolId: required('ECOGUARD_USER_POOL_ID'), clientId: required('ECOGUARD_CLIENT_ID'), frontendOrigin: required('ECOGUARD_FRONTEND_ORIGIN') }),
  processingAvailable: Boolean(process.env.ECOGUARD_PROCESSOR_FUNCTION),
  async schedule(id) {
    const name = process.env.ECOGUARD_PROCESSOR_FUNCTION;
    if (!name) throw new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Cloud processing is not configured.');
    await lambda.send(new InvokeCommand({ FunctionName: name, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ mediaId: id })) }));
  },
});
