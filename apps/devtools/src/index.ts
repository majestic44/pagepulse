import Fastify from 'fastify';
import { createLogger, loadEnvironment } from '@pagepulse/config';

const env = loadEnvironment();
const app = Fastify({ loggerInstance: createLogger('devtools', env.LOG_LEVEL) });
let generation = 0;
const deliveries: unknown[] = [];
app.get('/targets/jobs', (_request, reply) =>
  reply
    .type('text/html')
    .send(
      `<!doctype html><html><body><main><h1>Open roles</h1><article data-job-id="base"><h2>Support Engineer</h2><p>Remote</p></article>${generation > 0 ? `<article data-job-id="new-${generation}"><h2>Network Engineer ${generation}</h2><p>Remote</p></article>` : ''}<time>${generation} minutes ago</time></main></body></html>`,
    ),
);
app.get('/targets/feed.json', () => ({
  generation,
  jobs: [
    { id: 'base', title: 'Support Engineer' },
    ...(generation > 0
      ? [{ id: `new-${generation}`, title: `Network Engineer ${generation}` }]
      : []),
  ],
}));
app.get('/targets/feed.xml', (_request, reply) =>
  reply
    .type('application/atom+xml')
    .send(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Jobs</title><entry><id>base</id><title>Support Engineer</title></entry>${generation > 0 ? `<entry><id>new-${generation}</id><title>Network Engineer ${generation}</title></entry>` : ''}</feed>`,
    ),
);
app.post('/admin/advance', () => ({ generation: ++generation }));
app.post('/webhook', (request) => {
  deliveries.push(request.body);
  return { accepted: true, count: deliveries.length };
});
app.get('/webhook/deliveries', () => ({ deliveries }));
app.delete('/webhook/deliveries', () => {
  deliveries.splice(0);
  return { cleared: true };
});
await app.listen({ host: '0.0.0.0', port: env.DEVTOOLS_PORT });
