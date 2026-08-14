import { describe, expect, it } from 'vitest'
import { harnessArguments, parseReadyUrl } from '../src/harness.ts'

describe('parseReadyUrl', () => {
  it('accepts the URL line the web bundle prints when its tree has settled', () => {
    expect(parseReadyUrl('dsh web: http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080')
  })

  it('keeps the loopback origin when the launcher also reports a LAN address', () => {
    expect(parseReadyUrl('dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.4:3080)'))
      .toBe('http://127.0.0.1:3080')
  })

  it('rejects a non-loopback address so the window never loads a remote origin', () => {
    expect(parseReadyUrl('dsh web: http://192.168.1.4:3080')).toBeUndefined()
    expect(parseReadyUrl('dsh web: http://harness.example.com:3080')).toBeUndefined()
  })

  it('ignores ordinary launcher output', () => {
    expect(parseReadyUrl('')).toBeUndefined()
    expect(parseReadyUrl('warning: something happened')).toBeUndefined()
    expect(parseReadyUrl('  dsh web: http://127.0.0.1:3080')).toBeUndefined()
  })

  it('ignores a readiness line whose address does not parse', () => {
    expect(parseReadyUrl('dsh web: http://[oops')).toBeUndefined()
  })
})

describe('harnessArguments', () => {
  it('binds loopback on an OS-assigned port so concurrent launches never collide', () => {
    expect(harnessArguments('/opt/dsh/lib/bin.js', 'web'))
      .toEqual(['--expose-internals', '/opt/dsh/lib/bin.js', '--profile', 'web', '--host', '127.0.0.1', '--port', '0'])
  })

  it('passes runtime flags before the launcher entry', () => {
    const args = harnessArguments('/opt/dsh/lib/bin.js', 'web')
    expect(args.indexOf('--expose-internals')).toBeLessThan(args.indexOf('/opt/dsh/lib/bin.js'))
  })
})
