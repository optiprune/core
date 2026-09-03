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
  const aliases = new Set([
    requestedId,
    requestedId === "version1-16-0" ? "version-1-16-0" : requestedId,
    requestedId === "version-1-16-0" ? "version1-16-0" : requestedId,
  ]);

  for (const id of aliases) {
    const direct = await env.BLOG.get(`post:${id}`, "json");
    if (direct) return json(direct);
  }

  const listed = await env.BLOG.list({ prefix: "post:" });
  for (const key of listed.keys) {
    const post = await env.BLOG.get(key.name, "json");
    if (post && aliases.has(String(post.id || post.slug || ""))) {
      return json(post);
    }
  }

  return json({ error: "Not found" }, 404);
}
