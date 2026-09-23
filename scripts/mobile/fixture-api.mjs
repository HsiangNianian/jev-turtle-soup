// Local/CI synthetic data only. No external services, model calls, email, or credentials.
import { createServer } from 'node:http'

let requests = 0
let questions = 0
const puzzle = {
  puzzleId: 'mobile-smoke-daily',
  date: new Date().toISOString().slice(0, 10),
  title: 'The Silent Bell',
  surface: 'A bell rang. Everyone smiled, although no one could hear it. Why?',
  difficulty: '普通',
  tags: ['本格'],
  locale: 'en',
  genreScore: 10,
  plays: 0,
  solves: null,
  relaxed: false,
  locked: true,
}
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  response.setHeader('Content-Type', 'application/json')
  if (path === '/health')
    return response.end(
      JSON.stringify({ ready: true, dailyRequests: requests, askRequests: questions }),
    )
  if (path === '/api/daily') {
    requests++
    return response.end(JSON.stringify({ today: puzzle, history: [] }))
  }
  if (path === '/api/game/ask') {
    questions++
    return response.end(
      JSON.stringify({
        reply: 'Yes.',
        verdict: 'yes',
        solved: false,
        revealed: false,
        closeness: 20,
        replyLocale: 'en',
        debug: {},
      }),
    )
  }
  if (path === '/api/library/puzzles') return response.end(JSON.stringify({ items: [] }))
  if (path === '/api/reports') return response.end(JSON.stringify({ id: 'fixture-report' }))
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'Unsupported fixture route' }))
})
server.listen(8787, '127.0.0.1', () => console.log('Mobile fixture API: http://127.0.0.1:8787'))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
