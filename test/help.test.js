import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import help from '../action/help.js';
import { ACTIONS } from '../action/registry.js';

describe('help', () => {
  it('lists every registered action', async () => {
    const { actions, lines } = await help();
    assert.equal(actions.length, Object.keys(ACTIONS).length);
    for (const name of Object.keys(ACTIONS)) {
      assert.ok(lines.some(l => l.startsWith(name)), `${name} should be listed`);
    }
  });

  it('lists actions alphabetically', async () => {
    const names = (await help()).actions.map(a => a.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });

  it('shows each action\'s arguments', async () => {
    const { lines } = await help();
    const render = lines.find(l => l.startsWith('render'));
    for (const p of ACTIONS.render.params) {
      assert.ok(render.includes(`<${p}>`), `render should show <${p}>`);
    }
  });

  it('marks queued actions', async () => {
    const { lines } = await help();
    assert.ok(lines.find(l => l.startsWith('isolate')).includes('[queued]'));
    assert.ok(!lines.find(l => l.startsWith('find')).includes('[queued]'));
  });

  it('shows an action with no arguments without pretending it has some', async () => {
    const { lines } = await help();
    assert.ok(lines.find(l => l.startsWith('explore')).includes('—'));
  });

  it('details a single action, by object or by string', async () => {
    const byObject = await help({ action: 'render' });
    const byString = await help('render');
    assert.deepEqual(byObject.lines, byString.lines);
    assert.equal(byObject.actions.length, 1);
    assert.ok(byObject.lines.some(l => l.includes('--visual=')));
    assert.ok(byObject.lines.some(l => l.includes('job queue')));
  });

  it('says an inline action replies immediately', async () => {
    const { lines } = await help('find');
    assert.ok(lines.some(l => l.includes('replies with its result')));
  });

  it('handles an unknown action by listing what exists', async () => {
    const { lines, actions } = await help('nope');
    assert.match(lines[0], /unknown action: nope/);
    assert.ok(lines[1].includes('render'));
    assert.deepEqual(actions, []);
  });

  it('includes itself, so `help help` works', async () => {
    const { lines } = await help('help');
    assert.equal(lines[0], 'help');
  });

  it('returns only serializable data — it crosses a socket', async () => {
    const result = await help();
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.ok(result.lines.every(l => typeof l === 'string'));
  });
});
