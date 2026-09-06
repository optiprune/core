import HomePage from '../pages/home.page.js';

describe('home page', () => {
  it('has a title', async () => {
    await HomePage.open();
    await expect(browser).toHaveTitle(/Home/);
  });
});
