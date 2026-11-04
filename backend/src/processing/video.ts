import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../http/errors.js';
import { command } from './command.js';
import { validateDetection, type Detection, type Detector } from './detector.js';

export interface VideoResult extends Detection { duration: number; sampledAt: number[] }
export interface VideoProcessor { process(bytes: Buffer, detector: Detector): Promise<VideoResult> }
export function sampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new ApiError(422, 'INVALID_VIDEO', 'Video duration must be greater than zero and at most 120 seconds.');
  return Array.from({ length: Math.ceil(duration / 10) }, (_, index) => index * 10);
}
export function validateVideo(bytes: Buffer, contentType: string): 'video/mp4' {
  if (contentType !== 'video/mp4' || bytes.length < 24 || bytes.toString('ascii', 4, 8) !== 'ftyp' ||
      !['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(bytes.toString('ascii', 8, 12))) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Supply an MP4 video with matching video/mp4 Content-Type.');
  }
  return 'video/mp4';
}
export class FFmpegVideoProcessor implements VideoProcessor {
  constructor(private readonly ffmpeg: string, private readonly ffprobe: string,
    private readonly options: { tempRoot?: string; timeoutMs?: number; run?: typeof command } = {}) {}
  async process(bytes: Buffer, detector: Detector): Promise<VideoResult> {
    const directory = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), 'ecoguard-video-'));
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 180000);
    const run = this.options.run ?? command;
    try {
      const input = join(directory, 'input.mp4');
      await writeFile(input, bytes);
      const probe = JSON.parse((await run(this.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', input], { signal })).toString());
      const streams = probe.streams?.filter((stream: { codec_type: string }) => stream.codec_type === 'video');
      const stream = streams?.[0];
      const duration = Number(probe.format?.duration);
      const sampledAt = sampleTimes(duration);
      if (streams.length !== 1 || stream.codec_name !== 'h264' || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) ||
          stream.width < 1 || stream.height < 1 || stream.width > 3840 || stream.height > 2160 ||
          !String(probe.format?.format_name).split(',').includes('mp4')) {
        throw new ApiError(422, 'INVALID_VIDEO', 'Require MP4/H.264 with one video stream, at most 3840x2160.');
      }
      const species: Record<string, number> = {};
      let model: Detection['model'] | undefined;
      for (const timestamp of sampledAt) {
        signal.throwIfAborted();
        const frame = await run(this.ffmpeg, ['-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe',
          '-ss', String(timestamp), '-i', input, '-map', '0:v:0', '-frames:v', '1', '-vf', "scale=1280:1280:force_original_aspect_ratio=decrease", '-threads', '1',
          '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { signal, maxBytes: 4 * 1024 * 1024 });
        if (!frame.length) throw new ApiError(422, 'INVALID_VIDEO', 'A sampled frame could not be decoded.');
        const result = validateDetection(await detector.detect(frame, signal));
        signal.throwIfAborted();
        if (model && JSON.stringify(model) !== JSON.stringify(result.model)) throw new Error('Model changed during processing');
        model = result.model;
        for (const [name, count] of Object.entries(result.species)) species[name] = Math.max(species[name] ?? 0, count);
      }
      return { duration, sampledAt, species, model: model! };
    } finally {
      // Commands close before rejecting; no process still holds the input when cleanup starts.
      await rm(directory, { recursive: true, force: true });
    }
  }
}
