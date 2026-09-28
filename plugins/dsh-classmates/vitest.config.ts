import { defineConfig } from 'vitest/config';

// Recorded demo projects contain their own executable test programs. They are
// separate deliverables; this package's acceptance suite lives under tests/.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
