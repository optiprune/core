export async function onRequest(context) {
  // Let static assets (CSS, JS, images, etc.) pass through normally
  const url = new URL(context.request.url);
  if (url.pathname.includes(".")) {
    return context.next();
  }

  // Rewrite any /blog/* request directly to /blog/index.html internally
  const blogUrl = new URL("/blog/index.html", context.request.url);
  return context.env.ASSETS.fetch(new Request(blogUrl, context.request));
}