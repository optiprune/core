const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });

export async function onRequestGet({ env, params }) {
  const requestedId = decodeURIComponent(params.id);
  const listed = await env.BLOG.list({ prefix: "post:" });

  for (const key of listed.keys) {
    const post = await env.BLOG.get(key.name, "json");
    if (!post) continue;

    const recordId = String(post.id || "");
    const recordSlug = String(post.slug || "");
    const keyId = key.name.startsWith("post:") ? key.name.slice(5) : key.name;

    if (requestedId === recordId || requestedId === recordSlug || requestedId === keyId) {
      return json(post);
    }
  }

  return json({ error: "Not found" }, 404);
}
