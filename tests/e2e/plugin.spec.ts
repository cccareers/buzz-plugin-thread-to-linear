import { test, expect, mount, message, snapshot, id, state } from './support';

test('registers the shipped module and matches only eligible delivered messages', async ({ page }) => {
  await mount(page);
  expect(await page.evaluate(() => (window as any).harness.registration)).toEqual({ inject: ['react', 'conversation'], count: 1, id: 'draft-linear-issue', title: 'Draft Linear issue', placement: undefined });
  const cases = [
    [{}, true], [{ delivery: 'accepted' }, true], [{ delivery: 'seen' }, true],
    ...['sending', 'failed', 'unknown'].map(delivery => [{ delivery }, false]),
    [{ id: 'local:123' }, false], [{ id: 'A'.repeat(64) }, false], [{ channelId: '../bad' }, false], [{ channelId: 'x'.repeat(257) }, false],
    [{ threadRootId: 'invalid' }, false], [{ membership: { type: 'member_joined', actor: id(100), target: id(101) } }, false], [{ huddle: { room: 'r', state: 'started' } }, false], [{ audience: 'agents' }, false], [{ notice: 'execution-failure' }, false],
  ];
  for (const [patch, result] of cases) {
    expect(await page.evaluate(m => (window as any).harness.matches(m), { ...message(), ...(patch as object) })).toBe(result);
  }
});

test('includes root, three recent eligible replies and selected message in chronological order', async ({ page }) => {
  const root = message({ content: 'Root **bold** [link](https://evil.test)', createdAt: 1 });
  const selected = message({ id: id(9), threadRootId: root.id, createdAt: 9, content: '# Selected\nsecond line' });
  const replies = Array.from({ length: 5 }, (_, i) => message({ id: id(i + 2), threadRootId: root.id, createdAt: i + 2, content: `Reply ${i + 2}` }));
  replies.push(selected, message({ id: id(20), threadRootId: root.id, audience: 'agents', content: 'SECRET agent text' }), message({ id: id(21), threadRootId: id(99), content: 'OTHER thread' }), message({ id: id(22), channelId: 'private', threadRootId: root.id, content: 'OTHER channel' }));
  await mount(page, { message: selected, snapshot: snapshot(root, replies) });
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Selected');
  const description = await page.getByLabel('Description (Markdown)').inputValue();
  expect(description).toContain('Root \\*\\*bold\\*\\* \\[link\\]\\(https://evil\\.test\\)');
  expect(description).not.toMatch(/Reply 2|Reply 3|SECRET|OTHER/);
  for (const text of ['Reply 4', 'Reply 5', 'Reply 6', 'Selected message']) expect(description).toContain(text);
  expect(description.indexOf('Reply 4')).toBeLessThan(description.indexOf('Reply 5'));
  expect(description.indexOf('Reply 5')).toBeLessThan(description.indexOf('Reply 6'));
  expect(description.match(/Selected message/g)).toHaveLength(1);
  expect(description).toContain(`buzz://message?channel=engineering&id=${selected.id}&thread=${root.id}`);
  expect((await state(page)).stats).toMatchObject({ thread: [{ channelId: 'engineering', rootId: root.id }], refresh: 1, snapshot: 1, dispose: 1 });
});

test('root selection deduplicates and excludes attachment metadata', async ({ page }) => {
  const root = message({ content: '', sourceContent: 'SECRET raw body', attachments: [{ url: 'https://secret.test/file', kind: 'file', name: 'SECRET file' }] });
  await mount(page, { message: root, snapshot: snapshot(root, [root]) });
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Follow up on Buzz thread');
  await expect(page.getByLabel('Description (Markdown)')).not.toHaveValue(/SECRET|Buzz context/);
});

test('selected root appears once even when repeated in the thread snapshot', async ({ page }) => {
  const root = message({ content: 'Unique opener content' });
  await mount(page, { message: root, snapshot: snapshot(root, [root]) });
  const description = await page.getByLabel('Description (Markdown)').inputValue();
  expect(description.match(/Unique opener content/g)).toHaveLength(1);
  expect(description.match(/Selected message/g)).toHaveLength(1);
  expect(description).not.toContain('Thread opener');
});

test('system, undelivered and empty replies do not displace eligible context', async ({ page }) => {
  const root = message({ createdAt: 1, content: 'Root' });
  const selected = message({ id: id(2), threadRootId: root.id, createdAt: 2, content: 'Selected' });
  const eligible = message({ id: id(3), threadRootId: root.id, createdAt: 3, content: 'Keep this reply' });
  const excluded = [
    { membership: { type: 'member_joined' as const, actor: id(100), target: id(101) } },
    { huddle: { room: 'r', state: 'started' as const } },
    { notice: 'execution-failure' as const },
    { delivery: 'sending' as const },
    { delivery: 'failed' as const },
    { delivery: 'unknown' as const },
    { audience: 'agents' as const },
    { content: ' \n\t ' },
  ].map((patch, index) => message({ id: id(index + 4), createdAt: index + 4, threadRootId: root.id, content: 'Excluded private context', ...patch }));
  await mount(page, { message: selected, snapshot: snapshot(root, [selected, eligible, ...excluded]) });
  await expect(page.getByLabel('Description (Markdown)')).toHaveValue(/Keep this reply/);
  await expect(page.getByLabel('Description (Markdown)')).not.toHaveValue(/Excluded private context/);
  expect((await state(page)).calls).toEqual([]);
});

test('bounds unicode excerpts and title without broken surrogate pairs', async ({ page }) => {
  const selected = message({ content: '😀'.repeat(200) });
  await mount(page, { message: selected, snapshot: snapshot(selected) });
  const title = await page.getByLabel('Title', { exact: true }).inputValue();
  expect(Array.from(title)).toHaveLength(120);
  expect(title).toBe('😀'.repeat(119) + '…');
  expect(await page.getByLabel('Description (Markdown)').inputValue()).toContain('😀'.repeat(179) + '…');
});

for (const scenario of ['reject', 'missing', 'wrong-root', 'limited', 'error']) {
  test(`partial context notice and selected message survive ${scenario}`, async ({ page }) => {
    const selected = message({ threadRootId: id(2) });
    const root = message({ id: id(2), content: 'Thread root' });
    await mount(page, { message: selected, refresh: scenario === 'reject' ? 'reject' : 'resolve', snapshot: snapshot(scenario === 'missing' ? undefined : scenario === 'wrong-root' ? message({ id: id(3) }) : root, [], { limited: scenario === 'limited', status: scenario === 'error' ? 'error' : 'ready' }) });
    await expect(page.getByText('The complete thread context was unavailable. Review the available excerpts.')).toBeVisible();
    await expect(page.getByLabel('Description (Markdown)')).toHaveValue(/Fix the conversation search/);
    expect((await state(page)).stats.dispose).toBe(1);
  });
}

test('edits are copied exactly and encoded in a Linear URL without invoking issue submission', async ({ page }) => {
  await mount(page);
  await page.getByLabel('Title', { exact: true }).fill('  Fix & verify #1 😀  ');
  await page.getByLabel('Description (Markdown)').fill('## Outcome\n- [ ] café & spaces\nhttps://example.test/?x=1#y');
  await page.getByRole('button', { name: 'Copy draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft copied.');
  await page.getByRole('button', { name: 'Open in Linear' }).click();
  await expect(page.getByRole('status')).toHaveText('Linear opened. Choose a team and submit the issue there.');
  const { calls } = await state(page);
  expect(calls[0]).toEqual({ command: 'clipboard_write_text', args: { text: '# Fix & verify #1 😀\n\n## Outcome\n- [ ] café & spaces\nhttps://example.test/?x=1#y' } });
  expect(calls[1].command).toBe('plugin:opener|open_url');
  const url = new URL(calls[1].args.url);
  expect(url.origin + url.pathname).toBe('https://linear.app/new');
  expect(url.searchParams.get('title')).toBe('Fix & verify #1 😀');
  expect(url.searchParams.get('description')).toBe(await page.getByLabel('Description (Markdown)').inputValue());
  expect(calls).toHaveLength(2);
});

test('blank title disables sharing, edits clear status, oversize opens blank form but copies everything', async ({ page }) => {
  await mount(page);
  await page.getByLabel('Title', { exact: true }).fill('   ');
  await expect(page.getByRole('button', { name: 'Copy draft' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open in Linear' })).toBeDisabled();
  await page.getByLabel('Title', { exact: true }).fill('Issue');
  await page.getByLabel('Description (Markdown)').fill('漢'.repeat(3000));
  await expect(page.getByText('The draft is too long to prefill.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Copy draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft copied.');
  await page.getByRole('button', { name: 'Open blank Linear form' }).click();
  expect((await state(page)).calls).toEqual([{ command: 'clipboard_write_text', args: { text: '# Issue\n\n' + '漢'.repeat(3000) } }, { command: 'plugin:opener|open_url', args: { url: 'https://linear.app/new' } }]);
  await page.getByLabel('Title', { exact: true }).fill('Updated');
  await expect(page.getByRole('status')).toHaveCount(0);
});

for (const native of ['reject', 'absent']) {
  test(`native ${native} failures are actionable and editor remains usable`, async ({ page }) => {
    await mount(page, { native, clipboard: 'reject' });
    await page.getByRole('button', { name: 'Copy draft' }).click();
    await expect(page.getByRole('status')).toHaveText('Clipboard unavailable. Select and copy the draft fields manually.');
    await page.getByRole('button', { name: 'Open in Linear' }).click();
    await expect(page.getByRole('status')).toHaveText('Couldn’t open Linear. Copy the draft and open Linear in your browser.');
    await expect(page.getByRole('button', { name: 'Copy draft' })).toBeEnabled();
  });
}

test('uses browser clipboard when desktop bridge is absent', async ({ page }) => {
  await mount(page, { native: 'absent' });
  await page.getByRole('button', { name: 'Copy draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft copied.');
  expect((await state(page)).calls[0].command).toBe('web:clipboard');
});

test('pending native operation disables both actions and prevents duplicates', async ({ page }) => {
  await mount(page, { native: 'pending' });
  await page.getByRole('button', { name: 'Copy draft' }).click();
  await expect(page.getByRole('button', { name: 'Copy draft' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open in Linear' })).toBeDisabled();
  await page.getByRole('button', { name: 'Copy draft' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Open in Linear' }).dispatchEvent('click');
  expect((await state(page)).calls).toHaveLength(1);
  await page.evaluate(() => (window as any).harness.resolveNative());
  await expect(page.getByRole('status')).toHaveText('Draft copied.');
  await expect(page.getByRole('button', { name: 'Copy draft' })).toBeEnabled();
});

for (const dismissal of ['Close', 'Escape', 'unmount']) {
  test(`loading ${dismissal} disposes once, restores focus and ignores late refresh`, async ({ page }) => {
    await mount(page, { refresh: 'pending' });
    await expect(page.getByRole('status')).toHaveText('Loading Buzz thread context…');
    await expect(page.getByRole('button', { name: 'Copy draft' })).toBeDisabled();
    if (dismissal === 'Close') await page.getByRole('button', { name: 'Close', exact: true }).click();
    else if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => (window as any).harness.unmount());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Message menu' })).toBeFocused();
    await page.evaluate(() => (window as any).harness.resolveRefresh());
    expect((await state(page)).stats).toMatchObject({ dispose: 1, snapshot: 0, close: dismissal === 'unmount' ? 0 : 1 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('relay message updates preserve manual edits without another thread refresh', async ({ page }) => {
  await mount(page);
  await page.getByLabel('Title', { exact: true }).fill('Manual title');
  await page.getByLabel('Description (Markdown)').fill('Manual description');
  await page.evaluate(m => (window as any).harness.rerender(m), message({ content: 'Relay replacement edit' }));
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Manual title');
  await expect(page.getByLabel('Description (Markdown)')).toHaveValue('Manual description');
  expect((await state(page)).stats.refresh).toBe(1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await state(page)).stats.dispose).toBe(1);
});

for (const length of [7500, 7501]) {
  test(`prefill length ${length} obeys exact URL limit`, async ({ page }) => {
    await mount(page);
    await page.getByLabel('Title', { exact: true }).fill('T');
    const prefix = 'https://linear.app/new?title=T&description=';
    await page.getByLabel('Description (Markdown)').fill('a'.repeat(length - prefix.length));
    await page.getByRole('button', { name: length === 7500 ? 'Open in Linear' : 'Open blank Linear form', exact: true }).click();
    const { calls } = await state(page);
    expect(calls[0].args.url).toBe(length === 7500 ? prefix + 'a'.repeat(length - prefix.length) : 'https://linear.app/new');
  });
}

test('thread view creation failure falls back without crashing', async ({ page }) => {
  await mount(page, { threadThrows: true });
  await expect(page.getByText('The complete thread context was unavailable. Review the available excerpts.')).toBeVisible();
  await expect(page.getByLabel('Description (Markdown)')).toHaveValue(/Fix the conversation search/);
  expect((await state(page)).stats).toMatchObject({ refresh: 0, snapshot: 0, dispose: 0 });
});
