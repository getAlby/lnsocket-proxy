import net, { isIP } from 'net'
import { SocksClient, SocksClientOptions, SocksClientChainOptions } from 'socks';
import { HttpResponse, HttpRequest, us_socket_context_t } from 'uWebSockets.js'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { arrayBufferToString, safetyPatchRes } from '../utils'
import { Socket } from 'net'
import { RESTRICT_ORIGINS } from '../constants'
import { SocksCommand, SocksCommandOption, SocksProxyType } from 'socks/typings/common/constants'

const connectionsRateLimiter = new RateLimiterMemory({
  points: 10, // connection attempts
  duration: 1, // per second per ip
  execEvenly: false, // Do not delay actions evenly
  blockDuration: 0, // Do not block if consumed more than points
  keyPrefix: 'ws-connection-limit-ip' // must be unique for limiters with different purpose
})

function isTor(address: String): boolean {
  return address.endsWith(".onion")
}

async function handleUpgrade(
  res: HttpResponse,
  req: HttpRequest,
  context: us_socket_context_t
): Promise<void> {
  safetyPatchRes(res)

  const secWebSocketKey = req.getHeader('sec-websocket-key')
  const secWebSocketProtocol = req.getHeader('sec-websocket-protocol')
  const secWebSocketExtensions = req.getHeader('sec-websocket-extensions')
  const origin = req.getHeader('origin')
  const ip = arrayBufferToString(res.getRemoteAddressAsText())
  const nodeHost = req.getParameter(0)

  const torProxyHost = process.env.TOR_PROXY_HOST || 'localhost'
  const torProxyPort = process.env.TOR_PROXY_PORT || '9050'

  if (RESTRICT_ORIGINS && !RESTRICT_ORIGINS.includes(origin)) {
    res.cork(() => {
      if (res.done) return
      res.writeStatus('400 Bad Request').end()
    })

    return
  }

  if (!nodeHost) {
    if (res.done) return

    res.cork(() => {
      res.writeStatus('400 Bad Request').end()
    })

    return
  }

  const [nodeIP, nodePort = '9735'] = nodeHost.split(':')

  //   if (!isIP(nodeIP)) {
  //   if (res.done) return

  //   res.cork(() => {
  //     res.writeStatus('400 Bad Request').end()
  //   })

  //   return
  // }

  try {
    await connectionsRateLimiter.consume(ip)
  } catch {
    if (res.done) return

    res.cork(() => {
      res.writeStatus('429 Too Many Requests').end()
    })

    return
  }

  let nodeSocket: Socket

  if (isTor(nodeIP)) {
    // create Tor connections
    const commandOption: SocksCommandOption = 'connect';
    const proxyType: SocksProxyType = 5;
    const sockOptions = {
      proxy: {
        host: torProxyHost,
        port: parseInt(torProxyPort),
        type: proxyType,
      },
      command: commandOption,
      destination: {
        host: nodeIP,
        port: parseInt(nodePort)
      }
    }
    const connection = await SocksClient.createConnection(sockOptions);
    nodeSocket = connection.socket;
  }

  try {
    nodeSocket = await new Promise((resolve, reject) => {
      const connection = net.createConnection(parseInt(nodePort), nodeIP)

      connection.on('connect', () => resolve(connection))

      connection.on('error', err => {
        reject(err)
      })
    })
  } catch (error) {
    if (res.done) return

    res.cork(() => {
      res
        .writeStatus('404 Not Found')
        .end((error as { message: string }).message)
    })

    return
  }

  if (res.done) return

  res.cork(() => {
    // upgrade to WebSocket and attach additional data
    res.upgrade(
      {
        origin,
        ip,
        nodeSocket
      },
      secWebSocketKey,
      secWebSocketProtocol,
      secWebSocketExtensions,
      context
    )
  })
}

export default handleUpgrade
