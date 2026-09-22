import { afterEach, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../src/components/ErrorBoundary'

vi.mock('../src/lib/telemetry', () => ({ reportError: vi.fn() }))
import { reportError } from '../src/lib/telemetry'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it('does not duplicate a resource failure already reported by pre-bundle recovery', () => {
  const error = new Error('Failed to fetch dynamically imported module: /assets/Page.js')
  vi.stubGlobal('window', { __tsAssetError: error })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const boundary = new ErrorBoundary({ children: null })
  boundary.componentDidCatch(error, { componentStack: 'at Page' })
  expect(reportError).not.toHaveBeenCalled()
})
it('keeps application error messages and full component stacks in separate fields', () => {
  vi.stubGlobal('window', {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new Error('render failure')
  const boundary = new ErrorBoundary({ children: null })
  boundary.componentDidCatch(error, { componentStack: 'at Page' })
  expect(reportError).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'render failure',
      stack: expect.stringContaining('at Page'),
    }),
    'react',
  )
  expect(vi.mocked(reportError).mock.calls[0][0]).toMatchObject({
    stack: expect.stringContaining(error.stack!),
  })
})
