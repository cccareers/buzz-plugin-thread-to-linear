import { test, expect, mount, message, snapshot, state, id } from './support';

// Buzz v1.0.0 navigation/buzz-links.ts CHANNEL_ID permits a leading
// alphanumeric followed by at most 255 alphanumeric, dot, dash or underscore.
for (const channelId of ['engineering.frontend', 'a'.repeat(256)]) {
  test(`supports Buzz channel ${channelId.length === 256 ? 'at the length boundary' : 'with dots'}`, async ({ page }) => {
    const selected = message({ channelId });
    await mount(page, { message: selected, snapshot: snapshot(selected) });
    expect(await page.evaluate(row => (window as any).harness.matches(row), selected)).toBe(true);
    await expect(page.getByLabel('Description (Markdown)')).toHaveValue(/Selected message/);
    await page.getByRole('button', { name: 'Copy draft', exact: true }).click();
    const copied = (await state(page)).calls[0].args.text;
    expect(copied).toContain(`channel=${channelId}`);
  });
}

test('warns when the bounded thread reader has more context available', async ({ page }) => {
  await mount(page, { snapshot: snapshot(message(), [], { canLoadMore: true, limited: false }) });
  await expect(page.getByText('The complete thread context was unavailable. Review the available excerpts.')).toBeVisible();
  expect((await state(page)).stats.refresh).toBe(1);
});

test('keeps Buzz event-ID ordering when messages have equal timestamps', async ({ page }) => {
  const root = message({ id: id(1), content: 'Thread opener', createdAt: 1 });
  const selected = message({ id: id(2), threadRootId: root.id, content: 'Earlier selected', createdAt: 2, createdAtMs: 2000 });
  const reply = message({ id: id(3), threadRootId: root.id, content: 'Later reply', createdAt: 2, createdAtMs: 2000 });
  await mount(page, { message: selected, snapshot: snapshot(root, [selected, reply]) });
  await expect(page.getByLabel('Description (Markdown)')).toHaveValue(/Earlier selected[\s\S]*Later reply/);
});

for (const channelId of ['_private', '-invalid', 'a'.repeat(257)]) {
  test(`hides action for channel IDs Buzz cannot navigate: ${channelId.length > 256 ? 'too long' : channelId}`, async ({ page }) => {
    await mount(page);
    expect(await page.evaluate(row => (window as any).harness.matches(row), message({ channelId }))).toBe(false);
  });
}
