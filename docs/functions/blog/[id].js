export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Allow static files (.js, .css, .png, etc.) to pass through
  if (url.pathname.includes(".")) {
    return context.next();
  }

  // Fetch the static blog shell without triggering a redirect loop
  const res = await context.env.ASSETS.fetch(new URL("/blog/", context.request.url));

  return new Response(res.body, {
    status: 200,
    headers: {
      ...Object.fromEntries(res.headers.entries()),
      "content-type": "text/html; charset=utf-8",
    },
  });
}