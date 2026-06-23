import { Hono } from 'hono';
import type { Env } from './env';
import { twilioRoutes } from './routes/twilio';
import { accessMiddleware } from './auth/access';
import { adminRoutes } from './routes/admin';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/', twilioRoutes);

// 管理APIにAccessミドルウェアを適用
app.use('/admin/*', accessMiddleware);
app.route('/', adminRoutes);

// APIに該当しないパスは静的アセットへフォールバック
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
