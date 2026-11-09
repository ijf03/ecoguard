import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command, ListObjectVersionsCommand, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from '../http/errors.js';
import { lostPetImageQuery, object } from '../media/search.js';
import { validateDetection, type Detection } from '../processing/detector.js';

interface Query {
  sub: string; jti: string; exp: number;
  file: { checksum: string; size: number; contentType: string };
  window?: { since: string; until: string; tags: string[] };
}
export interface ImageQueries {
  reserve(owner: string, input: Record<string, unknown>): Promise<unknown>;
  start(owner: string, token: string): Promise<void>;
  poll(owner: string, token: string): Promise<{ pending: true } | { detection: Detection; window?: Query['window'] }>;
}
const notFound = () => new ApiError(404, 'QUERY_NOT_FOUND', 'This query is unavailable or expired. Start a new search.');
const missing = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;

/** Query files/results stay in private temporary S3 objects, never in media metadata or search indexes. */
export class CloudImageQueries implements ImageQueries {
  private key: Promise<Uint8Array> | undefined;
  constructor(private readonly s3: S3Client, private readonly lambda: LambdaClient, private readonly ssm: SSMClient,
    private readonly bucket: string, private readonly processor: string, private readonly inference: string,
    private readonly parameter = '/ecoguard/g80/query-signing-key') {}
  private signingKey() {
    return this.key ??= this.ssm.send(new GetParameterCommand({ Name: this.parameter, WithDecryption: true })).then(result => {
      if (!/^[a-f0-9]{64}$/.test(result.Parameter?.Value ?? '')) throw new Error('Missing query signing configuration.');
      return Buffer.from(result.Parameter!.Value!, 'hex');
    }).catch(error => { this.key = undefined; throw error; });
  }
  private async verify(token: string, owner?: string): Promise<Query> {
    try {
      if (typeof token !== 'string' || token.length > 8192) throw notFound();
      const { payload } = await jwtVerify(token, await this.signingKey(), { algorithms: ['HS256'], issuer: 'ecoguard-image-query', audience: 'ecoguard-query-worker', requiredClaims: ['sub', 'exp', 'jti'] });
      if (owner && payload.sub !== owner || !/^[a-f0-9-]{36}$/.test(payload.jti!)) throw notFound();
      return payload as unknown as Query;
    } catch { throw notFound(); }
  }
  async reserve(owner: string, input: Record<string, unknown>) {
    const file = object(input.file);
    if (!/^[a-f0-9]{64}$/.test(String(file.checksum)) || !Number.isSafeInteger(file.size) || Number(file.size) < 1 || Number(file.size) > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(String(file.contentType))) throw new ApiError(400, 'INVALID_QUERY', 'Use a supported image up to 10 MiB.');
    if (input.purpose !== 'collection' && input.purpose !== 'lost-pet') throw new ApiError(400, 'INVALID_QUERY', 'Choose a supported image search.');
    const id = randomUUID();
    const query: Query = { sub: owner, jti: id, exp: Math.floor(Date.now() / 1000) + 600, file: { checksum: String(file.checksum), size: Number(file.size), contentType: String(file.contentType) }, ...(input.purpose === 'lost-pet' ? { window: lostPetImageQuery(object(input.options ?? {})) } : {}) };
    const token = await new SignJWT({ file: query.file, ...(query.window ? { window: query.window } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuer('ecoguard-image-query').setAudience('ecoguard-query-worker').setSubject(owner).setJti(id).setExpirationTime(query.exp).sign(await this.signingKey());
    const checksum = Buffer.from(query.file.checksum, 'hex').toString('base64');
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: `queries/${id}/input`, ContentType: query.file.contentType, ContentLength: query.file.size, ChecksumSHA256: checksum, IfNoneMatch: '*' }), { expiresIn: 300, unhoistableHeaders: new Set(['x-amz-checksum-sha256']), signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']) });
    return { token, upload: { url, headers: { 'Content-Type': query.file.contentType, 'x-amz-checksum-sha256': checksum, 'If-None-Match': '*' } } };
  }
  async start(owner: string, token: string) {
    const query = await this.verify(token, owner);
    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: `queries/${query.jti}/input`, ChecksumMode: 'ENABLED' }));
    if (head.ContentLength !== query.file.size || head.ContentType !== query.file.contentType || head.ChecksumSHA256 !== Buffer.from(query.file.checksum, 'hex').toString('base64')) throw new ApiError(422, 'UPLOAD_MISMATCH', 'The query upload does not match its reservation.');
    await this.lambda.send(new InvokeCommand({ FunctionName: this.processor, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ queryToken: token })) }));
  }
  async poll(owner: string, token: string) {
    const query = await this.verify(token, owner);
    let result;
    try { const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: `queries/${query.jti}/result.json` })); result = JSON.parse(await response.Body!.transformToString()); }
    catch (error) { if (missing(error)) return { pending: true as const }; throw error; }
    if (result.error) throw new ApiError(422, 'QUERY_PROCESSING_FAILED', 'The query image could not be processed. Try a different image.');
    return { detection: validateDetection(result), ...(query.window ? { window: query.window } : {}) };
  }
  private async removeVersions(prefix: string) {
    let KeyMarker: string | undefined, VersionIdMarker: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: prefix, KeyMarker, VersionIdMarker }));
      const Objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(item => ({ Key: item.Key!, VersionId: item.VersionId! }));
      if (Objects.length) {
        const removed = await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects, Quiet: true } }));
        if (removed.Errors?.length) throw new Error('Temporary query cleanup will retry.');
      }
      KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined; VersionIdMarker = page.NextVersionIdMarker;
    } while (KeyMarker);
  }
  async run(token: string) {
    const query = await this.verify(token);
    const prefix = `queries/${query.jti}/`;
    try { await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: prefix + 'claim', Body: '', IfNoneMatch: '*' })); }
    catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) return; throw error; }
    let result: Detection | { error: true } = { error: true };
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: prefix + 'input', ChecksumMode: 'ENABLED' }));
      const response = await this.lambda.send(new InvokeCommand({ FunctionName: this.inference, Payload: Buffer.from(JSON.stringify({ mode: 'image', key: prefix + 'input', version: head.VersionId, ...query.file })) }));
      if (response.FunctionError || !response.Payload) throw new Error('Image inference failed.');
      result = validateDetection(JSON.parse(Buffer.from(response.Payload).toString()));
    } catch { /* Return a bounded public error; never expose model/runtime details. */ }
    finally { await this.removeVersions(prefix + 'input'); }
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: prefix + 'result.json', Body: JSON.stringify(result), ContentType: 'application/json' }));
  }
  async cleanupExpired() {
    // Bound each scheduled run; a lifecycle rule provides a final cleanup backstop.
    let token: string | undefined;
    let inspected = 0;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'queries/', MaxKeys: 100, ContinuationToken: token }));
      for (const item of page.Contents ?? []) {
        inspected++;
        if (item.Key && item.LastModified && item.LastModified.getTime() < Date.now() - 20 * 60000) await this.removeVersions(item.Key);
      }
      token = page.NextContinuationToken;
    } while (token && inspected < 1000);
  }
}
