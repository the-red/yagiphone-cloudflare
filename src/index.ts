import { Hono } from 'hono';
import type { Env } from './env';
import { twilioRoutes } from './routes/twilio';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/', twilioRoutes);

// APIに該当しないパスは静的アセットへフォールバック
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
