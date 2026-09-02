const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });

export async function onRequestGet({ env, params }) {
  const id = decodeURIComponent(params.id);
  const post = await env.BLOG.get(`post:${id}`, "json");
  if (!post || post.show_on_website !== true) return json({ error: "Not found" }, 404);
  return json(post);
}
