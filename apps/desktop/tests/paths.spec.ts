import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveHarnessEntry, resolveSplashDocument } from '../src/paths.ts'

describe('resolveHarnessEntry', () => {
  it('reads the staged deployment from resources in a packaged app', () => {
    expect(resolveHarnessEntry({
      packaged: true,
      resourcesPath: join('/Applications', 'DeepSeek Harness.app', 'Contents', 'Resources'),
      appPath: join('/Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar'),
    })).toBe(join('/Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'harness', 'lib', 'bin.js'))
  })

  it('reads the sibling CLI package when running from the workspace', () => {
    expect(resolveHarnessEntry({
      packaged: false,
      resourcesPath: '/unused',
      appPath: join('/work', 'deepseek-harness', 'apps', 'desktop'),
    })).toBe(join('/work', 'deepseek-harness', 'apps', 'desktop', '..', 'cli', 'lib', 'bin.js'))
  })

  it('honours an explicit override in either layout', () => {
    const override = join('/elsewhere', 'checkout', 'apps', 'cli', 'lib', 'bin.js')
    for (const packaged of [true, false]) {
      expect(resolveHarnessEntry({
        packaged, resourcesPath: '/res', appPath: '/app', entryOverride: override,
      })).toBe(override)
    }
  })

  it('ignores an empty override rather than spawning the app path', () => {
    expect(resolveHarnessEntry({
      packaged: true, resourcesPath: '/res', appPath: '/app', entryOverride: '',
    })).toBe(join('/res', 'harness', 'lib', 'bin.js'))
  })
})

describe('resolveSplashDocument', () => {
  it('resolves beside the bundled entry, which is inside the asar when packaged', () => {
    expect(resolveSplashDocument(join('/app', 'app.asar')))
      .toBe(join('/app', 'app.asar', 'static', 'splash.html'))
  })
})
