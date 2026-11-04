import { fileURLToPath } from 'node:url';
import { command } from './command.js';

export interface ImageValidator { validate(bytes: Buffer): Promise<void> }
export class PythonImageValidator implements ImageValidator {
  constructor(private readonly executable: string) {}
  async validate(bytes: Buffer) {
    await command(this.executable, [fileURLToPath(new URL('../../workers/thumbnail.py', import.meta.url)), '--validate'], { input: bytes });
  }
}
