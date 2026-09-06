export interface Env {
  ASSETS: Fetcher;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404
      ? new Response(`Hello from ${env.ENVIRONMENT}`, { headers: { 'content-type': 'text/plain' } })
      : asset;
  },
};
