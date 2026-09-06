document.querySelector('#open')?.addEventListener('click', () => {
  browser.tabs.create({ url: 'https://example.com' });
});
