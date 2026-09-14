import { describe, expect, it } from 'vitest';
import { defaultTerminalInfo } from 'ink-picture';
import { graphicalProtocol } from '../src/tui/workflow-image.js';

describe('workflow image protocol selection', () => {
  it('uses only graphical protocols and has no character-art fallback', () => {
    expect(graphicalProtocol(defaultTerminalInfo)).toBeUndefined();
    expect(graphicalProtocol({ ...defaultTerminalInfo, supportsSixelGraphics: true })).toBe('sixel');
    expect(graphicalProtocol({ ...defaultTerminalInfo, supportsITerm2Graphics: true })).toBe('iterm2');
    expect(graphicalProtocol({ ...defaultTerminalInfo, supportsKittyGraphics: true })).toBe('kitty');
  });
});
