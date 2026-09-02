const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' },
});

export async function onRequestGet({ env }) {
  const listed = await env.BLOG.list({ prefix: 'post:' });
  const posts = (await Promise.all(listed.keys.map(async ({ name }) => {
    try { return await env.BLOG.get(name, 'json'); } catch { return null; }
  }))).filter(Boolean)
    .filter(post => post.show_on_website === true)
    .sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));

  return json(posts.map(({ body, content, ...post }) => ({
    ...post,
    excerpt: post.excerpt || String(body || content || '').replace(/<[^>]+>/g, '').slice(0, 160),
  })));
}
