#!/usr/bin/env node
import prompts from 'prompts';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STRATEGIES = {
  random: {
    label: 'Random Mover',
    description: 'Picks a random legal move (good for testing)',
    code: `import { AgentRunner, RandomStrategy } from '@chessbots/agent-sdk';

const agent = new AgentRunner({
  privateKey: process.env.PRIVATE_KEY!,
  gatewayUrl: process.env.GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app',
  strategy: new RandomStrategy(),
});

agent.start();`,
  },
  stockfish: {
    label: 'Stockfish (UCI)',
    description: 'Wraps a local Stockfish binary via UCI protocol',
    code: `import { AgentRunner, StockfishStrategy } from '@chessbots/agent-sdk';

const agent = new AgentRunner({
  privateKey: process.env.PRIVATE_KEY!,
  gatewayUrl: process.env.GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app',
  strategy: new StockfishStrategy({
    depth: parseInt(process.env.STOCKFISH_DEPTH || '15'),
    binary: process.env.STOCKFISH_PATH || 'stockfish',
  }),
});

agent.start();`,
  },
  custom: {
    label: 'Custom Strategy',
    description: 'Empty template for implementing your own move logic',
    code: `import { AgentRunner, type ChessStrategy, type GameState } from '@chessbots/agent-sdk';

class MyStrategy implements ChessStrategy {
  name = 'MyCustomBot';

  async selectMove(state: GameState): Promise<string> {
    // state.fen - current board position in FEN notation
    // state.legalMoves - array of legal moves in UCI format (e.g. "e2e4")
    // state.moveHistory - array of previous moves
    // state.timeRemaining - time left in seconds

    // TODO: Implement your move selection logic here
    // For now, pick a random move
    const moves = state.legalMoves;
    return moves[Math.floor(Math.random() * moves.length)];
  }
}

const agent = new AgentRunner({
  privateKey: process.env.PRIVATE_KEY!,
  gatewayUrl: process.env.GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app',
  strategy: new MyStrategy(),
});

agent.start();`,
  },
};

type StrategyKey = keyof typeof STRATEGIES;

async function main() {
  console.log('');
  console.log('  ChessBots Agent Creator');
  console.log('  Build an autonomous chess bot for on-chain tournaments');
  console.log('');

  const response = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Project name',
      initial: 'my-chess-bot',
      validate: (v: string) => /^[a-z0-9-]+$/.test(v) || 'Use lowercase letters, numbers, and hyphens only',
    },
    {
      type: 'select',
      name: 'strategy',
      message: 'Choose a starting strategy',
      choices: Object.entries(STRATEGIES).map(([key, val]) => ({
        title: val.label,
        description: val.description,
        value: key,
      })),
    },
  ]);

  if (!response.name || !response.strategy) {
    console.log('\nAborted.');
    process.exit(0);
  }

  const projectDir = resolve(process.cwd(), response.name);
  const strategy = STRATEGIES[response.strategy as StrategyKey];

  if (existsSync(projectDir)) {
    console.error(`\nError: Directory "${response.name}" already exists.`);
    process.exit(1);
  }

  // Create project structure
  mkdirSync(join(projectDir, 'src'), { recursive: true });

  // package.json
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: response.name,
        version: '0.1.0',
        type: 'module',
        scripts: {
          build: 'tsc',
          start: 'node dist/index.js',
          dev: 'tsx src/index.ts',
        },
        dependencies: {
          '@chessbots/agent-sdk': '^0.1.0',
        },
        devDependencies: {
          typescript: '^5.3.0',
          tsx: '^4.7.0',
          '@types/node': '^20.10.0',
        },
      },
      null,
      2,
    ) + '\n',
  );

  // tsconfig.json
  writeFileSync(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          esModuleInterop: true,
          declaration: true,
          skipLibCheck: true,
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n',
  );

  // .env.example
  writeFileSync(
    join(projectDir, '.env.example'),
    `# Your agent's private key (generate with: openssl rand -hex 32, prefix with 0x)
PRIVATE_KEY=0x...

# ChessBots gateway URL
GATEWAY_URL=https://agent-gateway-production-590d.up.railway.app

# Monad RPC URL (for on-chain reads)
RPC_URL=https://rpc.monad.xyz/

# Strategy-specific settings
STRATEGY=${response.strategy}
${response.strategy === 'stockfish' ? 'STOCKFISH_PATH=stockfish\nSTOCKFISH_DEPTH=15\n' : ''}`,
  );

  // .gitignore
  writeFileSync(
    join(projectDir, '.gitignore'),
    `node_modules/
dist/
.env
*.js.map
`,
  );

  // src/index.ts
  writeFileSync(join(projectDir, 'src/index.ts'), strategy.code + '\n');

  console.log('');
  console.log(`  Project created at ./${response.name}`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    cd ${response.name}`);
  console.log('    npm install');
  console.log('    cp .env.example .env     # Add your private key');
  console.log('    npm run dev              # Start your bot');
  console.log('');
  console.log('  Docs: https://chessbots.io/docs');
  console.log('');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
