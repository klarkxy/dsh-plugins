// Navigate through the host-owned Plugins page; no private UI store access.
export async function openClassmatesSettings(page) {
  if (!await page.getByRole('button', { name: '返回插件列表', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '插件', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '返回插件列表', exact: true }).click();
  }
  await page.getByRole('button', { name: /^查看 (?:队友角色|@klarkxy\/dsh-classmates)$/ }).click();
  await page.getByRole('button', { name: '新建角色', exact: true }).waitFor();
}

export async function scrollPluginSettingsToTop(page) {
  await page.getByRole('button', { name: '返回插件列表', exact: true }).scrollIntoViewIfNeeded();
}
