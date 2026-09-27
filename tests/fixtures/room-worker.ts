// Only bundled by rooms-runtime.test.ts. No diagnostic RPCs are exported in production.
import { SoupRoom as ProductionRoom } from '../../worker/room-object.ts'
export { RoomLimit } from '../../worker/room-limit.ts'
export { default } from '../../worker/index.ts'
export class SoupRoom extends ProductionRoom {
  async expireLeaseForTest() {
    const row = this.ctx.storage.sql
      .exec<{ payload: string }>('SELECT payload FROM head WHERE id=1')
      .one()
    const state = JSON.parse(row.payload)
    state.processing.deadline = Date.now() - 1
    this.ctx.storage.sql.exec('UPDATE head SET payload=? WHERE id=1', JSON.stringify(state))
    await this.alarm()
  }
  async flushForTest() {
    await this.alarm()
  }
  expireTicketsForTest() {
    this.ctx.storage.sql.exec('UPDATE tickets SET expires=0')
  }
  abortForTest() {
    this.ctx.abort('Simulated process loss')
  }
  historyForTest(count: number) {
    const row = this.ctx.storage.sql
      .exec<{ payload: string }>('SELECT payload FROM head WHERE id=1')
      .one()
    const state = JSON.parse(row.payload)
    for (let i = 0; i < count; i++) {
      const e = {
        seq: ++state.eventSeq,
        id: crypto.randomUUID(),
        at: Date.now(),
        type: 'discussion',
        actorId: state.hostId,
        text: `History ${i}`,
      }
      this.ctx.storage.sql.exec(
        'INSERT INTO events(seq,payload,type) VALUES(?,?,?)',
        e.seq,
        JSON.stringify(e),
        e.type,
      )
    }
    state.revision++
    this.ctx.storage.sql.exec('UPDATE head SET payload=? WHERE id=1', JSON.stringify(state))
  }
}
