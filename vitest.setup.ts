import { vi } from 'vitest';

// DoFirst's migrated tests use the Jest global API (jest.fn()).
// Provide a compatibility alias so they run unchanged under Vitest.
(globalThis as unknown as Record<string, unknown>).jest = vi;
