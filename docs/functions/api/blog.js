const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate", // Guarantees fresh data instantly
    },
  });

export async function onRequestGet({ env }) {
  const listed = await env.BLOG.list({ prefix: "post:" });
  const posts = (
    await Promise.all(
      listed.keys.map(async ({ name }) => {
        try {
          return await env.BLOG.get(name, "json");
        } catch {
          return null;
        }
      }),
    )
  )
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.published_at || b.created_at || 0) -
        new Date(a.published_at || a.created_at || 0),
    );

  return json(
    posts.map(({ body, content, ...post }) => ({
      ...post,
      excerpt:
        post.excerpt ||
        String(body || content || "")
          .replace(/<[^>]+>/g, "")
          .slice(0, 160),
    })),
  );
}
