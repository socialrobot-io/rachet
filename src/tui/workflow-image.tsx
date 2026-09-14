import { useMemo } from 'react';
import { Box, Text } from 'ink';
import Image, { useTerminalInfo, type ImageProtocolName, type TerminalInfo } from 'ink-picture';
import type { WorkflowDefinition } from '../domain/contracts.js';
import { renderWorkflowPng } from './workflow-graph.js';

export function graphicalProtocol(info: TerminalInfo): ImageProtocolName | undefined {
  if (info.supportsKittyGraphics) return 'kitty';
  if (info.supportsITerm2Graphics) return 'iterm2';
  if (info.supportsSixelGraphics) return 'sixel';
  return undefined;
}

export function WorkflowImage({ definition, width, height }: { definition: WorkflowDefinition; width: number; height: number }) {
  const terminalInfo = useTerminalInfo();
  const protocol = graphicalProtocol(terminalInfo);
  const pixelWidth = Math.max(800, Math.round(width * terminalInfo.cellWidth));
  const png = useMemo(() => renderWorkflowPng(definition, pixelWidth), [definition, pixelWidth]);

  if (!protocol) {
    return <Box height={height} flexDirection="column" justifyContent="center" alignItems="center">
      <Text color="yellow">Inline SVG preview is unavailable in this terminal.</Text>
      <Text dimColor>Press o to open the generated SVG.</Text>
    </Box>;
  }

  return <Image
    src={png}
    width={width}
    height={height}
    objectFit="contain"
    protocol={protocol}
    alt="Rendered workflow diagram"
  />;
}
