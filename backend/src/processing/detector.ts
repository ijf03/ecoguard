import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../http/errors.js';
import { command } from './command.js';

export interface Detection {
  species: Record<string, number>;
  model: { identity: string; version: string; weightsSha256: string; confidence: number };
}
export interface Detector { detect(bytes: Buffer, signal?: AbortSignal): Promise<Detection> }
export const animalClasses = ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'];
export function validateDetection(value: Detection): Detection {
  if (!value || !value.species || !value.model || !value.model.identity || !value.model.version ||
      !/^[a-f0-9]{64}$/.test(value.model.weightsSha256) || !Number.isFinite(value.model.confidence) ||
      value.model.confidence <= 0 || value.model.confidence > 1 ||
      Object.entries(value.species).some(([name, count]) => !animalClasses.includes(name) || !Number.isSafeInteger(count) || count < 1)) {
    throw new Error('Invalid detection result');
  }
  return value;
}
export class PythonDetector implements Detector {
  constructor(private readonly executable: string, private readonly weights: string, private readonly confidence = '0.25') {}
  async detect(bytes: Buffer, signal?: AbortSignal): Promise<Detection> {
    if (signal) {
      const output = await command(this.executable, [fileURLToPath(new URL('../../workers/detect.py', import.meta.url)), this.weights, this.confidence], { input: bytes, signal, timeout: 120000 });
      return validateDetection(JSON.parse(output.toString()));
    }
    return new Promise((resolve, reject) => {
      const failure = () => new ApiError(503, 'DETECTION_FAILED', 'Configure ECOGUARD_PYTHON, ECOGUARD_MODEL_PATH and ECOGUARD_CONFIDENCE; see docs/DETECTION.md. Retry processing after setup.');
      const child = spawn(this.executable, [fileURLToPath(new URL('../../workers/detect.py', import.meta.url)), this.weights, this.confidence],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let total = 0;
      const timer = setTimeout(() => { child.kill(); reject(failure()); }, 120000);
      child.on('error', () => { clearTimeout(timer); reject(failure()); });
      child.stdin.on('error', () => {});
      child.stderr.resume();
      child.stdout.on('data', chunk => { total += chunk.length; if (total > 65536) child.kill(); else chunks.push(Buffer.from(chunk)); });
      child.on('close', code => {
        clearTimeout(timer);
        try {
          if (code !== 0 || total > 65536) throw failure();
          resolve(validateDetection(JSON.parse(Buffer.concat(chunks).toString())));
        } catch { reject(failure()); }
      });
      child.stdin.end(bytes);
    });
  }
}
