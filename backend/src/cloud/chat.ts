import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { ApiError } from '../http/errors.js';
import { tagName } from '../media/search.js';
import type { CloudMedia, FirestoreMediaStore } from './firestore-media.js';

interface IntentResult {
  action?: string; parameters?: Record<string, unknown>; allRequiredParamsPresent?: boolean;
  fulfillmentText?: string; intentDetectionConfidence?: number; intent?: { isFallback?: boolean };
}
export interface Chatbot { query(owner: string, input: Record<string, unknown>): Promise<{ reply: string; media: CloudMedia[] }> }
const project = 'fit3184-g80-ecoguard-dg26';
const help = 'Try “show me two dogs”, “find cats and dogs”, or “help me find my lost ginger cat”.';
const list = (value: unknown) => value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];

function midnight(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) throw new Error('Invalid date entity.');
  const utc = Date.parse(day + 'T00:00:00Z');
  let guess = utc;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(guess).map(part => [part.type, part.value]));
    const localAsUtc = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    guess = utc - (localAsUtc - guess);
  }
  return guess;
}
export function intentDateWindow(parameters: Record<string, unknown>, now = Date.now()) {
  const period = parameters.period;
  let start: unknown, end: unknown;
  if (period && typeof period === 'object' && !Array.isArray(period)) {
    const dates = period as Record<string, unknown>; start = dates.startDate; end = dates.endDate;
  } else if (typeof parameters.date === 'string' && parameters.date) start = end = parameters.date;
  if (!start) return undefined;
  if (typeof start !== 'string' || typeof end !== 'string') throw new Error('Invalid date entities.');
  const since = new Date(midnight(start.slice(0, 10))).toISOString();
  const endDay = end.slice(0, 10);
  const next = new Date(Date.parse(endDay + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const until = new Date(Math.min(midnight(next) - 1, now)).toISOString();
  return { since, until };
}

export class DialogflowChat implements Chatbot {
  private readonly auth = new GoogleAuth({ keyFilename: fileURLToPath(new URL('../../config/aws-wif.json', import.meta.url)), scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  constructor(private readonly store: FirestoreMediaStore, private readonly detect?: (session: string, text: string) => Promise<IntentResult>) {}
  async query(owner: string, input: Record<string, unknown>) {
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 512 || typeof input.sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.sessionId)) throw new ApiError(400, 'INVALID_CHAT', 'Send a message up to 512 characters with a valid chat session.');
    const session = createHash('sha256').update(owner + '\0' + input.sessionId).digest('hex').slice(0, 32);
    let result: IntentResult;
    if (this.detect) result = await this.detect(session, input.message);
    else {
      try {
        const client = await this.auth.getClient();
        const response = await client.request<{ queryResult: IntentResult }>({ url: `https://dialogflow.googleapis.com/v2/projects/${project}/agent/sessions/${session}:detectIntent`, method: 'POST', timeout: 15000,
          headers: { 'x-goog-user-project': project }, data: { queryInput: { text: { text: input.message, languageCode: 'en' } }, queryParams: { timeZone: 'Australia/Melbourne' } } });
        result = response.data.queryResult;
      } catch { throw new ApiError(503, 'CHAT_UNAVAILABLE', 'The conversation service is temporarily unavailable. You can still use the search forms.'); }
    }
    if (result.intent?.isFallback || !['SearchSightings', 'LostPetSightings'].includes(result.action ?? '') || (result.intentDetectionConfidence ?? 0) < 0.35) return { reply: result.fulfillmentText || help, media: [] };
    if (!result.allRequiredParamsPresent) return { reply: result.fulfillmentText || 'Which animal species would you like to find?', media: [] };
    const parameters = result.parameters ?? {};
    const species = list(parameters.species).map(tagName);
    const counts = list(parameters.counts).map(Number);
    if (!species.length || species.length > 16 || counts.length && counts.length !== species.length || counts.some(count => !Number.isSafeInteger(count) || count < 1)) return { reply: 'Please give one minimum count for each species, for example “two cats and one dog”.', media: [] };
    const tags = Object.fromEntries(species.map((name, i) => [name, counts[i] ?? 1]));
    for (const description of list(parameters.descriptions).map(tagName)) tags[description] = 1;
    const lost = result.action === 'LostPetSightings';
    let window;
    try { window = intentDateWindow(parameters); } catch { return { reply: 'Please use a clear date, such as today, yesterday or last week.', media: [] }; }
    if (lost && !window) window = { since: new Date(Date.now() - 30 * 86400000).toISOString(), until: new Date().toISOString() };
    if (window && window.since > window.until) return { reply: 'That date window has no sightings yet. Try an earlier date.', media: [] };
    let media = await this.store.search(owner, tags, lost ? window : undefined);
    if (!lost && window) media = media.filter(item => item.createdAt >= window.since && item.createdAt <= window.until);
    return { reply: media.length ? `I found ${media.length} ${lost ? 'possible public sighting' : 'matching sighting'}${media.length === 1 ? '' : 's'}. Select a result to view it.${lost ? ' These are possible matches, not pet identity confirmations.' : ''}` : 'No sightings match every filter yet. Try fewer descriptive tags, a lower count or a different date.', media };
  }
}
