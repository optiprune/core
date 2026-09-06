export default defineContentScript({
  matches: ['https://example.com/*'],
  main() {
    document.documentElement.dataset.fixtureExtension = 'active';
  },
});
