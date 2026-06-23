import { Hono } from 'hono';
import type { Env } from './env';
import { twilioRoutes } from './routes/twilio';
import { accessMiddleware } from './auth/access';
import { adminRoutes } from './routes/admin';
import { handleDialQueue } from './queue/dial';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/', twilioRoutes);

// 管理APIにAccessミドルウェアを適用
app.use('/admin/*', accessMiddleware);
app.route('/', adminRoutes);

// APIに該当しないパスは静的アセットへフォールバック
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// Object.assign で queue ハンドラを追加する。
// app.fetch / app.request はそのまま（既存テストが import app して app.request() する構造を維持）。
// Workers ランタイムは export default に .fetch があれば HTTP, .queue があればキューを呼ぶ。
export default Object.assign(app, { queue: handleDialQueue });
