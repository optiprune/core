export async function GET() {
  return new Response(JSON.stringify({ ok: true }));
}

export const prerender = false;
