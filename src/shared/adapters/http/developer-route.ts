import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FileDeveloperRegistry } from '../../infrastructure/developer/file-developer-registry.js';

const DeveloperBody = z.object({ uuid: z.string().min(1).max(64) });

/** Tells the app whether a device uuid belongs to a developer; the app keeps the answer only in memory. */
export function registerDeveloperRoute(http: FastifyInstance, registry: FileDeveloperRegistry): void {
  http.post('/api/v1/developer', async (request, reply) => {
    const body = DeveloperBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send();
    }
    return { isDeveloper: registry.has(body.data.uuid) };
  });
}
