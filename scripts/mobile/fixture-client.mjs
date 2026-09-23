import { get } from 'node:http'

// Native CLI calls block the smoke runner's event loop. Use a fresh connection
// so a health probe cannot reuse an idle socket closed during adb / simctl work.
export function fixtureState() {
  return new Promise((resolve, reject) => {
    const request = get('http://127.0.0.1:8787/health', { agent: false }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error(`Fixture HTTP ${response.statusCode}`)
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.setTimeout(5000, () => request.destroy(new Error('Fixture health timed out')))
    request.on('error', reject)
  })
}
