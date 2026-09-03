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
  const id = requestedId === "version1-16-0" ? "version-1-16-0" : requestedId;
  const post = await env.BLOG.get(`post:${id}`, "json");
  if (!post) return json({ error: "Not found" }, 404);
  return json(post);
}
