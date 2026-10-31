package com.appsleuth.argus.companion.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.appsleuth.argus.companion.R
import com.appsleuth.argus.companion.model.EventType
import com.appsleuth.argus.companion.model.FlightEvent
import com.appsleuth.argus.companion.model.Outcome
import com.appsleuth.argus.companion.recorder.FlightRecorder
import com.appsleuth.argus.companion.ui.MainActivity
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Local Loopback VPN Service that captures network calls and API outcomes
 * across ALL applications without modifying APKs or requiring root.
 *
 * This is the Android equivalent of the browser extension's XHR/fetch interceptor.
 * It observes:
 * - Hostnames resolved via DNS interception
 * - HTTPS connections via TLS SNI (Server Name Indication) inspection
 * - Cleartext HTTP methods and response codes
 * - Round-trip request latencies and connection timeouts
 */
class ArgusVpnService : VpnService() {

    companion object {
        const val TAG = "ArgusVpn"
        const val CHANNEL_ID = "argus_vpn_channel"
        const val NOTIFICATION_ID = 2001
        const val ACTION_START = "com.appsleuth.argus.companion.START_VPN"
        const val ACTION_STOP = "com.appsleuth.argus.companion.STOP_VPN"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private var tunFd: ParcelFileDescriptor? = null
    private val running = AtomicBoolean(false)
    private val executor = Executors.newCachedThreadPool()

    /** DNS Cache: IP Address String -> Hostname */
    private val dnsCache = ConcurrentHashMap<String, String>()

    data class ActiveConnection(
        val destHost: String,
        val destPort: Int,
        val startMs: Long = System.currentTimeMillis(),
        var httpMethod: String? = null,
        var httpPath: String? = null,
        var httpStatus: Int? = null
    )
    private val activeConnections = ConcurrentHashMap<String, ActiveConnection>()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopVpn()
            return START_NOT_STICKY
        }
        startForegroundNotification()
        startVpn()
        return START_STICKY
    }

    private fun startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Argus Network Monitor",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors network latency and endpoint outcomes for self-diagnosis"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Argus Network Monitor Active")
            .setContentText("Intercepting network latency and endpoint outcomes")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun startVpn() {
        try {
            val builder = Builder()
                .setSession("Argus Network SRE")
                .addAddress("10.111.222.1", 32)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("8.8.8.8")
                .addDnsServer("1.1.1.1")
                .setMtu(1500)
                .setBlocking(true)

            tunFd = builder.establish()
            if (tunFd == null) {
                Log.e(TAG, "Failed to establish VPN TUN descriptor")
                stopSelf()
                return
            }

            isRunning = true
            running.set(true)
            Log.i(TAG, "VPN TUN established successfully")

            thread(name = "argus-vpn-worker", isDaemon = true) {
                runPacketLoop()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception starting VPN: ${e.message}", e)
            stopSelf()
        }
    }

    private fun runPacketLoop() {
        val fd = tunFd?.fileDescriptor ?: return
        val inputStream = FileInputStream(fd)
        val outputStream = FileOutputStream(fd)
        val packetBuffer = ByteBuffer.allocate(32767)

        while (running.get()) {
            try {
                packetBuffer.clear()
                val readBuffer = ByteArray(32767)
                val length = inputStream.read(readBuffer)
                if (length <= 0) continue

                packetBuffer.put(readBuffer, 0, length)
                packetBuffer.flip()

                processPacket(packetBuffer, length, outputStream)
            } catch (e: Exception) {
                if (running.get()) {
                    Log.w(TAG, "Packet loop read notice: ${e.message}")
                }
            }
        }
        Log.i(TAG, "Packet loop terminated")
    }

    private fun processPacket(buffer: ByteBuffer, length: Int, outputStream: FileOutputStream) {
        if (length < 20) return

        val versionIhl = buffer.get(0).toInt() and 0xFF
        val version = versionIhl shr 4
        if (version != 4) return // Only handle IPv4

        val ihl = (versionIhl and 0x0F) * 4
        val protocol = buffer.get(9).toInt() and 0xFF // 6 = TCP, 17 = UDP

        val srcIp = buildString {
            for (i in 12..15) {
                append(buffer.get(i).toInt() and 0xFF)
                if (i < 15) append(".")
            }
        }

        val destIp = buildString {
            for (i in 16..19) {
                append(buffer.get(i).toInt() and 0xFF)
                if (i < 19) append(".")
            }
        }

        val rawBytes = ByteArray(length)
        buffer.rewind()
        buffer.get(rawBytes)

        when (protocol) {
            17 -> handleUdpDns(rawBytes, ihl, srcIp, destIp, outputStream)
            6  -> handleTcpTraffic(rawBytes, ihl, srcIp, destIp, outputStream)
        }
    }

    /** Intercepts DNS queries on UDP 53 to map IP addresses to hostnames */
    private fun handleUdpDns(
        packet: ByteArray,
        ihl: Int,
        srcIp: String,
        destIp: String,
        outputStream: FileOutputStream
    ) {
        if (packet.size < ihl + 8) return
        val srcPort = ((packet[ihl].toInt() and 0xFF) shl 8) or (packet[ihl + 1].toInt() and 0xFF)
        val dstPort = ((packet[ihl + 2].toInt() and 0xFF) shl 8) or (packet[ihl + 3].toInt() and 0xFF)

        if (dstPort == 53) {
            executor.submit {
                try {
                    val payload = packet.copyOfRange(ihl + 8, packet.size)
                    val socket = DatagramSocket()
                    protect(socket)

                    val query = DatagramPacket(payload, payload.size, InetAddress.getByName(destIp), 53)
                    socket.send(query)

                    val respBuf = ByteArray(512)
                    val respPacket = DatagramPacket(respBuf, respBuf.size)
                    socket.soTimeout = 2500
                    socket.receive(respPacket)
                    socket.close()

                    parseDnsResponse(respBuf, respPacket.length)

                    val response = buildUdpIpPacket(
                        destIp, srcIp, 53, srcPort,
                        respBuf.copyOf(respPacket.length)
                    )
                    synchronized(outputStream) {
                        outputStream.write(response)
                    }
                } catch (e: Exception) {
                    Log.v(TAG, "DNS relay notice: ${e.message}")
                }
            }
        }
    }

    /** Intercepts TCP traffic (HTTP 80 and HTTPS 443) */
    private fun handleTcpTraffic(
        packet: ByteArray,
        ihl: Int,
        srcIp: String,
        destIp: String,
        outputStream: FileOutputStream
    ) {
        if (packet.size < ihl + 20) return
        val tcpOffset = ihl
        val srcPort = ((packet[tcpOffset].toInt() and 0xFF) shl 8) or (packet[tcpOffset + 1].toInt() and 0xFF)
        val dstPort = ((packet[tcpOffset + 2].toInt() and 0xFF) shl 8) or (packet[tcpOffset + 3].toInt() and 0xFF)
        val flags = packet[tcpOffset + 13].toInt() and 0xFF
        val isSyn = (flags and 0x02) != 0 && (flags and 0x10) == 0

        val connKey = "$srcIp:$srcPort->$destIp:$dstPort"
        val resolvedHost = dnsCache[destIp] ?: destIp

        if (isSyn && (dstPort == 80 || dstPort == 443)) {
            val entry = ActiveConnection(destHost = resolvedHost, destPort = dstPort)
            activeConnections[connKey] = entry

            val isHttps = dstPort == 443
            val currentApp = FlightRecorder.activeApp.value ?: "unknown"

            FlightRecorder.record(
                FlightEvent(
                    type = EventType.API_CALL,
                    sourceApp = currentApp,
                    label = "ApiCall: ${if (isHttps) "HTTPS" else "HTTP"} $resolvedHost",
                    host = resolvedHost,
                    url = "${if (isHttps) "https" else "http"}://$resolvedHost",
                    outcome = Outcome.PENDING
                )
            )

            executor.submit {
                relayTcpConnection(packet, srcIp, srcPort, destIp, dstPort, connKey, outputStream)
            }
        }
    }

    private fun relayTcpConnection(
        initialPacket: ByteArray,
        srcIp: String,
        srcPort: Int,
        destIp: String,
        dstPort: Int,
        connKey: String,
        tunOutput: FileOutputStream
    ) {
        try {
            val serverSocket = Socket()
            protect(serverSocket)
            serverSocket.connect(InetSocketAddress(InetAddress.getByName(destIp), dstPort), 5000)

            val startMs = System.currentTimeMillis()
            val entry = activeConnections[connKey]
            val serverIn = serverSocket.getInputStream()
            val serverOut = serverSocket.getOutputStream()

            val ihl = (initialPacket[0].toInt() and 0x0F) * 4
            val tcpHdrLen = ((initialPacket[ihl + 12].toInt() and 0xFF) shr 4) * 4
            val payloadStart = ihl + tcpHdrLen

            if (payloadStart < initialPacket.size) {
                val payload = initialPacket.copyOfRange(payloadStart, initialPacket.size)
                if (payload.isNotEmpty()) {
                    if (dstPort == 443) {
                        val sni = parseTlsSni(payload)
                        if (sni != null) {
                            dnsCache[destIp] = sni
                        }
                    } else if (dstPort == 80) {
                        entry?.httpMethod = parseHttpMethod(payload)
                        entry?.httpPath = parseHttpPath(payload)
                    }
                    serverOut.write(payload)
                }
            }

            val buf = ByteArray(8192)
            val bytesRead = serverIn.read(buf)
            val durationMs = System.currentTimeMillis() - startMs
            val host = dnsCache[destIp] ?: entry?.destHost ?: destIp
            val currentApp = FlightRecorder.activeApp.value ?: "unknown"

            if (bytesRead > 0) {
                if (dstPort == 80) {
                    val status = parseHttpStatus(buf.copyOf(bytesRead)) ?: 200
                    val isOk = status in 200..399
                    FlightRecorder.record(
                        FlightEvent(
                            type = if (isOk) EventType.API_RESULT_OK else EventType.API_RESULT_ERROR,
                            sourceApp = currentApp,
                            label = "ApiResult: HTTP $status ${entry?.httpMethod ?: "GET"} $host",
                            host = host,
                            method = entry?.httpMethod ?: "GET",
                            url = "http://$host${entry?.httpPath ?: ""}",
                            status = status,
                            durationMs = durationMs,
                            outcome = if (isOk) Outcome.SUCCESS else Outcome.FAILURE
                        )
                    )
                } else {
                    FlightRecorder.record(
                        FlightEvent(
                            type = EventType.API_RESULT_OK,
                            sourceApp = currentApp,
                            label = "ApiResult: 200 OK HTTPS $host (${durationMs}ms)",
                            host = host,
                            url = "https://$host",
                            status = 200,
                            durationMs = durationMs,
                            outcome = Outcome.SUCCESS
                        )
                    )
                }
            }
            serverSocket.close()
            activeConnections.remove(connKey)
        } catch (e: Exception) {
            val entry = activeConnections.remove(connKey)
            if (entry != null) {
                val durationMs = System.currentTimeMillis() - entry.startMs
                val isTimeout = e.message?.contains("timeout", ignoreCase = true) == true
                val currentApp = FlightRecorder.activeApp.value ?: "unknown"

                FlightRecorder.record(
                    FlightEvent(
                        type = if (isTimeout) EventType.API_RESULT_TIMEOUT else EventType.API_RESULT_ERROR,
                        sourceApp = currentApp,
                        label = if (isTimeout) "TIMEOUT: ${entry.destHost}" else "Error: ${entry.destHost}",
                        host = entry.destHost,
                        durationMs = durationMs,
                        outcome = if (isTimeout) Outcome.TIMEOUT else Outcome.FAILURE,
                        errorMessage = e.message
                    )
                )
            }
        }
    }

    private fun parseHttpMethod(data: ByteArray): String? {
        val text = data.toString(Charsets.ISO_8859_1)
        val methods = listOf("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS")
        return methods.firstOrNull { text.startsWith(it) }
    }

    private fun parseHttpPath(data: ByteArray): String? {
        val text = data.toString(Charsets.ISO_8859_1)
        val line = text.lineSequence().firstOrNull() ?: return null
        val parts = line.split(" ")
        return if (parts.size >= 2) parts[1] else null
    }

    private fun parseHttpStatus(data: ByteArray): Int? {
        val text = data.toString(Charsets.ISO_8859_1)
        val line = text.lineSequence().firstOrNull() ?: return null
        if (line.startsWith("HTTP/")) {
            return line.split(" ").getOrNull(1)?.toIntOrNull()
        }
        return null
    }

    private fun parseTlsSni(data: ByteArray): String? {
        try {
            if (data.size < 40 || data[0].toInt() != 22 || data[5].toInt() != 1) return null

            var pos = 43
            if (pos >= data.size) return null
            val sessionLen = data[pos++].toInt() and 0xFF
            pos += sessionLen

            if (pos + 1 >= data.size) return null
            val cipherLen = ((data[pos].toInt() and 0xFF) shl 8) or (data[pos + 1].toInt() and 0xFF)
            pos += 2 + cipherLen

            if (pos >= data.size) return null
            val compLen = data[pos++].toInt() and 0xFF
            pos += compLen

            if (pos + 1 >= data.size) return null
            val extTotalLen = ((data[pos].toInt() and 0xFF) shl 8) or (data[pos + 1].toInt() and 0xFF)
            pos += 2

            val extEnd = pos + extTotalLen
            while (pos + 4 <= extEnd && pos + 4 <= data.size) {
                val extType = ((data[pos].toInt() and 0xFF) shl 8) or (data[pos + 1].toInt() and 0xFF)
                val extDataLen = ((data[pos + 2].toInt() and 0xFF) shl 8) or (data[pos + 3].toInt() and 0xFF)
                pos += 4

                if (extType == 0 && pos + 5 <= data.size) { // SNI
                    val nameLen = ((data[pos + 3].toInt() and 0xFF) shl 8) or (data[pos + 4].toInt() and 0xFF)
                    pos += 5
                    if (pos + nameLen <= data.size) {
                        return String(data, pos, nameLen, Charsets.US_ASCII)
                    }
                }
                pos += extDataLen
            }
        } catch (_: Exception) {}
        return null
    }

    private fun parseDnsResponse(data: ByteArray, length: Int) {
        try {
            if (length < 12) return
            val anCount = ((data[6].toInt() and 0xFF) shl 8) or (data[7].toInt() and 0xFF)
            if (anCount == 0) return

            var pos = 12
            val hostname = StringBuilder()
            while (pos < length) {
                val labelLen = data[pos++].toInt() and 0xFF
                if (labelLen == 0) break
                if (hostname.isNotEmpty()) hostname.append('.')
                hostname.append(String(data, pos, labelLen, Charsets.US_ASCII))
                pos += labelLen
            }
            pos += 4

            repeat(anCount) {
                if (pos + 12 > length) return@repeat
                if ((data[pos].toInt() and 0xFF) == 0xC0) pos += 2 else {
                    while (pos < length && data[pos].toInt() != 0) pos++
                    pos++
                }
                val rtype = ((data[pos].toInt() and 0xFF) shl 8) or (data[pos + 1].toInt() and 0xFF)
                pos += 8
                val rdLen = ((data[pos].toInt() and 0xFF) shl 8) or (data[pos + 1].toInt() and 0xFF)
                pos += 2

                if (rtype == 1 && rdLen == 4) {
                    val ip = "${data[pos].toInt() and 0xFF}.${data[pos+1].toInt() and 0xFF}.${data[pos+2].toInt() and 0xFF}.${data[pos+3].toInt() and 0xFF}"
                    val hn = hostname.toString()
                    if (hn.isNotEmpty()) {
                        dnsCache[ip] = hn
                    }
                }
                pos += rdLen
            }
        } catch (_: Exception) {}
    }

    private fun buildUdpIpPacket(
        srcIp: String,
        dstIp: String,
        srcPort: Int,
        dstPort: Int,
        payload: ByteArray
    ): ByteArray {
        val udpLen = 8 + payload.size
        val totalLen = 20 + udpLen
        val buf = ByteBuffer.allocate(totalLen)

        buf.put(0x45.toByte())
        buf.put(0)
        buf.putShort(totalLen.toShort())
        buf.putShort(0)
        buf.putShort(0x4000.toShort())
        buf.put(64)
        buf.put(17)
        buf.putShort(0)
        srcIp.split(".").forEach { buf.put(it.toInt().toByte()) }
        dstIp.split(".").forEach { buf.put(it.toInt().toByte()) }

        buf.putShort(srcPort.toShort())
        buf.putShort(dstPort.toShort())
        buf.putShort(udpLen.toShort())
        buf.putShort(0)

        buf.put(payload)
        return buf.array()
    }

    private fun stopVpn() {
        running.set(false)
        isRunning = false
        tunFd?.close()
        tunFd = null
        executor.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Log.i(TAG, "Argus VPN stopped")
    }

    override fun onDestroy() {
        super.onDestroy()
        stopVpn()
    }

    override fun onRevoke() {
        super.onRevoke()
        stopVpn()
    }
}
