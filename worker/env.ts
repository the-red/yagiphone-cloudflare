import type { DialMessage } from './queue/dial';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_ENABLED: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  TWILIO_VALIDATE: string;
  /** yagiphone-dial キューへの発行バインディング */
  DIAL_QUEUE: Queue<DialMessage>;
}
