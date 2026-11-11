import { test as base, expect, type Page } from '@playwright/test';
import type { MessageAction } from '@buzz/author';
export { expect };
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    const outbound: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== 'http://127.0.0.1:43817') {
        outbound.push(route.request().url()); await route.abort();
      } else await route.continue();
    });
    await use(page);
    expect(errors, 'No browser runtime exceptions').toEqual([]);
    expect(outbound, 'No outbound network traffic; only boundary mocks may share data').toEqual([]);
  },
});
export type Message = Parameters<MessageAction['matches']>[0];
export const id = (n: number) => n.toString(16).padStart(64, '0');
export const message = (overrides: Partial<Message> = {}): Message => ({
  id: id(1), channelId: 'engineering', authorId: id(100), createdAt: 1700000000,
  content: 'Fix the conversation search', mentions: [], attachments: [], reactions: [], replyCount: 0, participants: [], ...overrides,
});
export const snapshot = (root: Message | undefined, replies: Message[] = [], overrides = {}) => ({
  status: 'ready', root, replies, error: undefined, canLoadMore: false, limited: false, ...overrides,
});
export async function mount(page: Page, options: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).harness);
  await page.evaluate(options => (window as any).harness.mount(options), { message: message(), snapshot: snapshot(message()), ...options });
  await page.getByRole('button', { name: 'Message menu', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
export const state = (page: Page) => page.evaluate(() => ({ stats: (window as any).harness.stats, calls: (window as any).harness.calls }));
