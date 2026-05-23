import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('logger LOG_LEVEL env propagation', () => {
  let savedLevel: string | undefined;

  beforeEach(() => {
    savedLevel = process.env.LOG_LEVEL;
    vi.resetModules();
  });

  afterEach(() => {
    if (savedLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = savedLevel;
  });

  it('defaults to info when LOG_LEVEL is unset', async () => {
    delete process.env.LOG_LEVEL;
    const { logger } = await import('../src/utils/logger.js');
    expect(logger.level).toBe('info');
  });

  it('honors LOG_LEVEL=debug', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('../src/utils/logger.js');
    expect(logger.level).toBe('debug');
  });

  it('honors LOG_LEVEL=warn', async () => {
    process.env.LOG_LEVEL = 'warn';
    const { logger } = await import('../src/utils/logger.js');
    expect(logger.level).toBe('warn');
  });
});
