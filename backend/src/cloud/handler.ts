import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { createCognitoAuth } from '../auth.js';
import { ApiError } from '../http/errors.js';
import { createCloudApi } from './api.js';
import { FirestoreMediaStore } from './firestore-media.js';
import { S3MediaStorage } from './s3-media.js';
import { SSMClient } from '@aws-sdk/client-ssm';
import { CloudImageQueries } from './image-query.js';
import { DialogflowChat } from './chat.js';
import { SNSClient } from '@aws-sdk/client-sns';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CloudNotifications } from './notifications.js';

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
const s3 = new S3Client({ region });
const store = new FirestoreMediaStore(db);
export const handler = createCloudApi({
  store, chat: new DialogflowChat(store), notifications: new CloudNotifications(db, new SNSClient({ region }), new CognitoIdentityProviderClient({ region }), required('ECOGUARD_FRONTEND_ORIGIN')),
  storage: new S3MediaStorage(s3, bucket),
  ...(process.env.ECOGUARD_INFERENCE_FUNCTION && process.env.ECOGUARD_PROCESSOR_FUNCTION ? { queries: new CloudImageQueries(s3, lambda, new SSMClient({ region }), bucket, process.env.ECOGUARD_PROCESSOR_FUNCTION, process.env.ECOGUARD_INFERENCE_FUNCTION) } : {}),
  auth: createCognitoAuth({ userPoolId: required('ECOGUARD_USER_POOL_ID'), clientId: required('ECOGUARD_CLIENT_ID'), frontendOrigin: required('ECOGUARD_FRONTEND_ORIGIN') }),
  processingAvailable: Boolean(process.env.ECOGUARD_PROCESSOR_FUNCTION),
  async schedule(id) {
    const name = process.env.ECOGUARD_PROCESSOR_FUNCTION;
    if (!name) throw new ApiError(503, 'PROCESSOR_UNAVAILABLE', 'Cloud processing is not configured.');
    await lambda.send(new InvokeCommand({ FunctionName: name, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ mediaId: id })) }));
  },
});
