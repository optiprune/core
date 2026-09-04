const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });

export async function onRequestGet({ env, params }) {
  // Normalize the incoming identifier (strip trailing slashes and decode once).
  const rawParam = String(params.id || "").trim();
  const rawId = decodeURIComponent(rawParam);
  const requestedId = rawId.endsWith("/") ? rawId.slice(0, -1) : rawId;

  if (!requestedId) {
    return json({ error: "Post ID or slug is required" }, 400);
  }

  // 1. Direct fetch: if key is stored as `post:<id>` or `post:<slug>`
  let post = await env.BLOG.get(`post:${requestedId}`, "json");

  // 2. Direct fetch fallback: if stored without prefix
  if (!post) {
    post = await env.BLOG.get(requestedId, "json");
  }

  // 3. Slug alias check: if you map slugs to IDs via `slug:<slug>` -> `id`
  if (!post) {
    const aliasedId = await env.BLOG.get(`slug:${requestedId}`);
    if (aliasedId) {
      post = await env.BLOG.get(`post:${aliasedId}`, "json");
    }
  }

  // 4. Ultimate fallback (Temporary migration safety net):
  // If post still wasn't found, perform a single list check in case the slug is purely inside JSON
  if (!post) {
    const listed = await env.BLOG.list({ prefix: "post:", limit: 100 });
    for (const key of listed.keys) {
      const candidate = await env.BLOG.get(key.name, "json");
      if (!candidate) continue;

      if (String(candidate.id) === requestedId || String(candidate.slug) === requestedId) {
        post = candidate;
        // Self-heal: populate the direct slug index for next time
        if (candidate.slug) {
          await env.BLOG.put(`slug:${candidate.slug}`, String(candidate.id || key.name));
        }
        break;
      }
    }
  }

  if (!post) {
    return json({ error: "Not found" }, 404);
  }

  return json(post);
}
