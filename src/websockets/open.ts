import { Socket } from 'net'
import { sendWsResponse } from '../utils'
import { WebSocket } from 'uWebSockets.js'

async function handleOpen(ws: WebSocket): Promise<void> {
  const { nodeSocket } = ws as WebSocket & { nodeSocket: Socket }
  let receivedMessageCount = 0

  // listen for data from ln node
  nodeSocket.on('data', async data => {
    receivedMessageCount += 1
    nodeSocket.pause()
    // console.debug({ receivedMessageCount })
    await sendWsResponse({ ws, data })
    nodeSocket.resume()
  })

  nodeSocket.on('close', () => {
    ws.close()
  })
}

export default handleOpen
