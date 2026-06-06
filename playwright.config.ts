import path from 'node:path'
import { defineConfig } from '@playwright/test'
import appConfig from '../tinycld/playwright.config'

// Package-scoped Playwright: inherit the app shell's webServer + browser config,
// then point testDir at THIS package's tests/ through the app shell's
// node_modules symlink. Routing via node_modules (not this repo's real path)
// keeps node resolution walking up into the app shell's install, so
// @playwright/test and other deps resolve there — not from a (nonexistent)
// local node_modules. The @tinycld/calendar symlink lives in the workspace-root
// node_modules (deps hoist there in this layout).
const WS_ROOT = path.resolve(import.meta.dirname, '..')
const TEST_DIR = path.join(WS_ROOT, 'node_modules', '@tinycld', 'calendar', 'tests')

export default defineConfig({
    ...appConfig,
    testDir: TEST_DIR,
})
