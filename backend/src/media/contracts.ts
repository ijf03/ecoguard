export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface Media {
  id: string;
  filename: string;
  checksum: string;
  storageKey: string;
  contentType: ImageType;
  size: number;
  createdAt: string;
  visibility: 'private' | 'public';
  processingStatus: 'pending' | 'complete' | 'failed';
  species: Record<string, number>;
  manualTags: string[];
  detectionModel?: import('../processing/detector.js').Detection['model'];
  processingError?: string;
  thumbnailKey?: string;
  width?: number;
  height?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}
export interface MediaRepository {
  list(): Promise<Media[]>;
  get(id: string): Promise<Media | undefined>;
  findChecksum(checksum: string): Promise<Media | undefined>;
  save(media: Media): Promise<void>;
  saveMany(media: Media[]): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
}
export interface Storage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  stageDelete?(keys: string[]): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>;
}
