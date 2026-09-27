import { describe, expect, it } from 'vitest'
import {
  newRoomCode,
  parseRoomCommand,
  readRoomBody,
  roomCreationId,
  roomOriginAllowed,
} from '../shared/room-security'
import { parseRoomCode, ROOM_FRAME_BYTES } from '../shared/room-protocol'

const url = 'https://hgt.mmstudio.games/api/rooms'
describe('room input and cross-site protections', () => {
  it('allows same-origin browsers and authenticated native request shapes', async () => {
    for (const origin of [null, 'https://hgt.mmstudio.games']) {
      const headers = new Headers({ 'content-type': 'application/json', 'x-room-protocol': '1' })
      if (origin) headers.set('origin', origin)
      const request = new Request(url, { method: 'POST', headers, body: '{"requestId":"value"}' })
      expect(await readRoomBody(request)).toEqual({ requestId: 'value' })
    }
  })
  it.each(['https://evil.example', 'null', 'http://hgt.mmstudio.games'])(
    'rejects %s before parsing',
    async (origin) => {
      const request = new Request(url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'x-room-protocol': '1' },
        body: '{}',
      })
      await expect(readRoomBody(request)).rejects.toMatchObject({ status: 403 })
      expect(() =>
        roomOriginAllowed(new Request(url, { headers: { origin, upgrade: 'websocket' } })),
      ).toThrow()
    },
  )
  it('rejects HTML forms and bodies without the non-simple protocol header', async () => {
    for (const headers of [
      { 'content-type': 'text/plain' },
      { 'content-type': 'application/json' },
    ]) {
      await expect(
        readRoomBody(new Request(url, { method: 'POST', headers, body: '{}' })),
      ).rejects.toMatchObject({ status: 415 })
    }
  })
  it('enforces a byte cap even without a trustworthy Content-Length', async () => {
    await expect(
      readRoomBody(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-room-protocol': '1' },
          body: JSON.stringify({ text: '汉'.repeat(ROOM_FRAME_BYTES) }),
        }),
      ),
    ).rejects.toMatchObject({ status: 413 })
    expect(() => parseRoomCommand(JSON.stringify({ text: '汉'.repeat(ROOM_FRAME_BYTES) }))).toThrow(
      '太长',
    )
  })
  it('rejects client-supplied authority, unknown commands, and non-UUID request IDs', () => {
    const valid = { type: 'discuss', commandId: crypto.randomUUID(), text: '你好' }
    expect(parseRoomCommand(JSON.stringify(valid))).toEqual(valid)
    for (const payload of [
      { ...valid, uid: 'victim' },
      { ...valid, solved: true },
      { ...valid, type: 'setState' },
      { ...valid, commandId: '1' },
    ]) {
      expect(() => parseRoomCommand(JSON.stringify(payload))).toThrow()
    }
  })
  it('accepts only canonical invitation URLs or sufficiently random codes', () => {
    for (let i = 0; i < 50; i++) expect(parseRoomCode(newRoomCode())).not.toBeNull()
    const code = newRoomCode()
    expect(parseRoomCode(`https://hgt.mmstudio.games/rooms/join?code=${code}`)).toBe(code)
    expect(parseRoomCode(`https://evil.example/rooms/join?code=${code}`)).toBeNull()
    expect(parseRoomCode('javascript:alert(1)')).toBeNull()
    expect(parseRoomCode('123456')).toBeNull()
  })
  it('makes creation retries idempotent but isolates accounts', async () => {
    const request = crypto.randomUUID()
    expect(await roomCreationId('alice', request)).toBe(await roomCreationId('alice', request))
    expect(await roomCreationId('bob', request)).not.toBe(await roomCreationId('alice', request))
  })
})
