import { describe, expect, it } from 'vitest';
import { toggleFocus } from '../src/tui/app.js';

describe('TUI focus navigation', () => {
  it('toggles focus for Tab', () => {
    expect(toggleFocus('workflows')).toBe('node');
    expect(toggleFocus('node')).toBe('workflows');
  });
});
