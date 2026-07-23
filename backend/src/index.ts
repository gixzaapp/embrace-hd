import { createApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await createApp();
  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[embrace-hd-backend] listening on http://0.0.0.0:${env.port}`);
    console.log(`[embrace-hd-backend] local: http://localhost:${env.port}`);
    if (!env.revenueCatSecretKey) {
      console.warn(
        '[embrace-hd-backend] REVENUECAT_SECRET_API_KEY not set — subscription verify returns non-premium'
      );
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
