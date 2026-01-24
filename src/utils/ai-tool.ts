import * as os from 'os';

export enum AIToolType {
  Claude = 'claude',
  Droid = 'droid',
}

export interface AIToolConfig {
  type: AIToolType;
  name: string;
  command: string;
  installCmd: string;
  buildRunCommand(promptFile: string): string;
}

const isWindows = os.platform() === 'win32';

export const AI_TOOLS: Record<AIToolType, AIToolConfig> = {
  [AIToolType.Claude]: {
    type: AIToolType.Claude,
    name: 'Claude Code',
    command: 'claude',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    buildRunCommand: (promptFile: string) =>
      `claude --dangerously-skip-permissions "$(cat '${promptFile}')"`,
  },
  [AIToolType.Droid]: {
    type: AIToolType.Droid,
    name: 'Factory Droid',
    command: 'droid',
    installCmd: isWindows
      ? 'irm https://app.factory.ai/cli/windows | iex'
      : 'curl -fsSL https://app.factory.ai/cli | sh',
    buildRunCommand: (promptFile: string) =>
      `droid exec --skip-permissions-unsafe -f '${promptFile}'`,
  },
};

export function getAIToolConfig(type: AIToolType): AIToolConfig {
  return AI_TOOLS[type];
}

export function getAllAITools(): AIToolConfig[] {
  return Object.values(AI_TOOLS);
}
