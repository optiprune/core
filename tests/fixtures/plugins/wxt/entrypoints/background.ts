export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.info('Fixture extension installed');
  });
});
