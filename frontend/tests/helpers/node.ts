export async function dragNode(page, ariaLabel) {
  const source = page.locator(`[aria-label="${ariaLabel}"]`).first()
  const target = page.locator('.react-flow')

  const srcBox = await source.boundingBox()
  const tgtBox = await target.boundingBox()

  await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2)
  await page.mouse.up()

  // reactflow node appears
  await page.waitForSelector('[data-testid^="rf__node-"]')
}
