export async function waitForAppReady(page) {
  // 1. Initial DOM is loaded
  await page.waitForLoadState('domcontentloaded');

  // 2. React has rendered the login inputs
  await page.waitForFunction(() => {
    return (
      document.querySelector('#emailField') !== null ||
      document.body.innerText.includes('Log in')
    );
  });

  // 3. Let React effects and layout finish
  await page.waitForFunction(() => {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  });
}
