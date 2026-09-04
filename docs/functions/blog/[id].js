export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Let asset requests continue through the normal Pages pipeline.
  if (url.pathname.includes(".")) {
    return context.next();
  }

  // Use the concrete generated file so neither the catch-all route nor
  // Astro's trailing-slash normalization can redirect this internal fetch.
  const shellUrl = new URL("/blog/index.html", context.request.url);
  const res = await context.env.ASSETS.fetch(shellUrl);

  if (!res.ok) {
    return context.next();
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      ...Object.fromEntries(res.headers.entries()),
      "content-type": "text/html; charset=utf-8",
    },
  });
}
