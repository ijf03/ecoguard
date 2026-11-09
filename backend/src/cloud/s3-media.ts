import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { CloudMedia } from './firestore-media.js';

export class S3MediaStorage {
  constructor(private readonly client: S3Client, readonly bucket: string) {}
  async upload(item: CloudMedia) {
    const checksum = Buffer.from(item.checksum, 'hex').toString('base64');
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: item.storageKey, ContentType: item.contentType,
      ContentLength: item.size, ChecksumSHA256: checksum, IfNoneMatch: '*' });
    return {
      url: await getSignedUrl(this.client, command, { expiresIn: Math.min(300, Math.max(1, Math.floor((item.uploadExpiresAt - Date.now()) / 1000))), unhoistableHeaders: new Set(['x-amz-checksum-sha256']), signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']) }),
      headers: { 'Content-Type': item.contentType, 'x-amz-checksum-sha256': checksum, 'If-None-Match': '*' },
    };
  }
  async download(item: CloudMedia, thumbnail = false) {
    if (!item.sourceVersion || thumbnail && !item.thumbnailKey) return undefined;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket,
      Key: thumbnail ? item.thumbnailKey! : item.storageKey,
      ...(!thumbnail ? { VersionId: item.sourceVersion } : {}),
      ResponseContentType: thumbnail ? 'image/jpeg' : item.contentType, ResponseContentDisposition: 'inline',
      ResponseCacheControl: 'private, max-age=60',
    }), { expiresIn: 300 });
  }
  async head(item: CloudMedia) {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: item.storageKey, ChecksumMode: 'ENABLED' }));
    return { version: result.VersionId, size: result.ContentLength, checksum: result.ChecksumSHA256, contentType: result.ContentType };
  }
  async removeVersion(key: string, version: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key, VersionId: version }));
  }
  /** Remove every version and delete marker; repeatable after partial failure. */
  async cleanup(item: Pick<CloudMedia, 'id' | 'storageKey'>) {
    // A source key can have malicious/presigned late writes. Tombstones persist; reconciliation repeats cleanup.
    for (const prefix of [item.storageKey, `thumbnails/${item.id}/`]) {
      let keyMarker: string | undefined;
      let versionMarker: string | undefined;
      do {
        const page = await this.client.send(new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: prefix,
          ...(keyMarker ? { KeyMarker: keyMarker } : {}), ...(versionMarker ? { VersionIdMarker: versionMarker } : {}) }));
        const versions = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
          .filter(v => v.Key === item.storageKey || v.Key?.startsWith(`thumbnails/${item.id}/`))
          .map(v => ({ Key: v.Key!, VersionId: v.VersionId! }));
        if (versions.length) {
          const result = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: versions, Quiet: true } }));
          if (result.Errors?.length) throw new Error('Versioned storage cleanup needs reconciliation.');
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
      } while (keyMarker);
    }
  }
}
