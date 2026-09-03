(() => {
  const allowedPaths = ["/", "/blog", "/docs"];
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (!allowedPaths.includes(path)) return;
  fetch("/api/blog")
    .then((response) => (response.ok ? response.json() : []))
    .then((posts) => {
      const post = posts.find((item) => {
        const published = new Date(item.published_at || item.created_at || 0).getTime();
        return item.show_on_website === true && Date.now() - published < 172800000;
      });
      if (!post) return;
      const root = document.querySelector("[data-docs-announcement]");
      const link = root?.querySelector("[data-docs-announcement-link]");
      if (!root || !link) return;
      link.textContent = `${post.title} — Read the release note →`;
      link.href = `/blog/${encodeURIComponent(post.id)}`;
      root.hidden = false;
    })
    .catch(() => {});
})();
