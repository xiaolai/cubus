package im.cubus.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The Android half of the BLE bridge, behind the SAME nine commands the desktop already exposes.
 *
 * Why Kotlin rather than btleplug. btleplug's Android backend (droidplug) needs its own Java
 * classes compiled into the APK plus `platform::init(&env)` with a JNIEnv, and its Java half
 * depends on a jni-utils SNAPSHOT that is not on Maven Central — so it would mean vendoring and
 * building two third-party Java trees. The ecosystem's own answer to that (tauri-plugin-blec)
 * is to use Kotlin on Android for exactly this reason. This does the same thing without adopting
 * a second plugin, because that plugin models ONE connected device and our command surface is
 * addressed by device id throughout; adopting it would make Android quietly different from every
 * other platform, which is the thing AGENTS.md's seam rule exists to prevent.
 *
 * WHAT THIS IS NOT: verified. It compiles, and compiling is not evidence — the crate this replaces
 * says so in as many words. Nothing here has touched a radio. `NATIVE_BLE_UNSUPPORTED` in
 * `apps/web/lib/ble-bridge.js` still lists 'android', so the app does not offer the affordance;
 * removing that one entry is what turns this on, and it must not happen before someone has run it
 * on a phone with a real cube.
 *
 * THE ONE RULE ANDROID GATT IMPOSES: a connection may have exactly ONE outstanding operation.
 * Issuing a second read/write/descriptor-write before the previous callback lands does not queue —
 * it returns false, or worse, silently drops. Every operation therefore goes through [enqueue],
 * and the queue advances only in a callback. Getting this wrong produces a device that works when
 * you test it slowly and fails when the protocol layer talks at speed, which is the failure mode
 * that is hardest to attribute.
 */
@TauriPlugin
class BlePlugin(private val activity: Activity) : Plugin(activity) {

    // ---- argument shapes, mirroring the Rust structs the desktop commands take -----------------

    @InvokeArg
    class ChannelArgs {
        lateinit var channel: Channel
    }

    /**
     * The whole `requestDevice` option shape, not a summary of it.
     *
     * An earlier draft took only service UUIDs and name prefixes. That is the divergence
     * `cube_ble::RequestOptions` warns about in as many words: the protocol layer emits
     * manufacturer-ONLY filters, which is how it finds a cube advertising without a recognisable
     * name, and dropping them made the native scan blind to devices the browser build could see —
     * the two builds silently disagreeing about what exists. The matching below is a port of
     * `cube_ble::matches_request`, clause for clause, for the same reason.
     */
    @InvokeArg
    class ManufacturerFilter {
        var companyIdentifier: Int = -1
        var dataPrefix: String? = null
    }

    @InvokeArg
    class DeviceFilter {
        var name: String? = null
        var namePrefix: String? = null
        var services: Array<String>? = null
        var manufacturerData: Array<ManufacturerFilter>? = null
    }

    @InvokeArg
    class RequestArgs {
        var filters: Array<DeviceFilter>? = null
        var acceptAllDevices: Boolean = false
        var timeoutMs: Long = 20_000
    }

    @InvokeArg
    class DeviceArgs {
        lateinit var id: String
    }

    @InvokeArg
    class ServiceArgs {
        lateinit var id: String
        lateinit var service: String
    }

    @InvokeArg
    class CharArgs {
        lateinit var id: String
        lateinit var service: String
        lateinit var characteristic: String
    }

    @InvokeArg
    class WriteArgs {
        lateinit var id: String
        lateinit var service: String
        lateinit var characteristic: String

        /** Base64. The bridge is JSON, and a Kotlin ByteArray does not survive it intact. */
        lateinit var data: String
        var withResponse: Boolean = true
    }

    // ---- state ---------------------------------------------------------------------------------

    /**
     * Where notifications and disconnects go, handed over by Rust at startup.
     *
     * NOT `trigger()`. That only reaches listeners registered from JS, and the web side listens for
     * the GLOBAL `ble-notification` / `ble-disconnect` events the desktop already emits — the whole
     * point of doing Android behind these nine command names is that `ble-bridge.js` does not learn
     * a platform. So Kotlin sends to a Channel, Rust receives on it and re-emits the same two global
     * events, and the JS cannot tell which half of the app produced them.
     */
    @Volatile
    private var events: Channel? = null

    private val main = Handler(Looper.getMainLooper())
    private val manager by lazy {
        activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    }
    private val adapter: BluetoothAdapter? get() = manager.adapter

    /** Advertisers seen during the last scan, by address — the ids the web side then connects to. */
    private val seen = ConcurrentHashMap<String, BluetoothDevice>()
    private val connections = ConcurrentHashMap<String, Conn>()

    /** One in-flight GATT operation per connection, and everything else waiting behind it. */
    private inner class Conn(val gatt: BluetoothGatt) {
        val queue = ArrayDeque<Op>()
        var busy = false
        var services: List<android.bluetooth.BluetoothGattService> = emptyList()
    }

    private inner class Op(val start: () -> Boolean, val fail: (String) -> Unit)

    private fun conn(id: String): Conn? = connections[id]

    /**
     * Run [op] when the connection is free, and never before. See the class note: Android GATT
     * takes one operation at a time and rejects — or silently loses — the rest.
     */
    private fun enqueue(c: Conn, op: Op) {
        synchronized(c) {
            c.queue.add(op)
            if (!c.busy) pump(c)
        }
    }

    private fun pump(c: Conn) {
        synchronized(c) {
            if (c.busy) return
            val next = c.queue.poll() ?: return
            c.busy = true
            if (!next.start()) {
                c.busy = false
                next.fail("the GATT stack refused the operation")
                pump(c)
            }
        }
    }

    private fun done(c: Conn) {
        synchronized(c) { c.busy = false }
        pump(c)
    }

    // ---- helpers -------------------------------------------------------------------------------

    /** Android wants full 128-bit UUIDs; the protocol layer speaks both. */
    private fun uuid(s: String): UUID =
        if (s.length == 4 || s.length == 8) UUID.fromString("0000${s.padStart(8, '0').takeLast(8)}-0000-1000-8000-00805f9b34fb")
        else UUID.fromString(s)

    private fun missingPermission(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        val needed = listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        val absent = needed.filter {
            activity.checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        return if (absent.isEmpty()) null else "missing runtime permission: ${absent.joinToString()}"
    }

    private fun characteristic(c: Conn, service: String, ch: String): BluetoothGattCharacteristic? =
        c.services.firstOrNull { it.uuid == uuid(service) }?.getCharacteristic(uuid(ch))

    private fun hex(s: String): ByteArray? =
        runCatching {
            check(s.length % 2 == 0)
            ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        }.getOrNull()

    /**
     * A port of `cube_ble::matches_request`, clause for clause.
     *
     * Every clause is an AND within one filter and the filters are ORed, which is Web Bluetooth's
     * own rule. Written out rather than approximated because the two builds have to agree about
     * which devices EXIST — a looser rule here shows the user a cube the desktop would not, and a
     * tighter one hides a cube the desktop finds.
     */
    private fun matches(
        name: String,
        services: List<String>,
        manufacturer: Map<Int, ByteArray>,
        args: RequestArgs,
    ): Boolean {
        if (args.acceptAllDevices) return true
        val filters = args.filters ?: return false
        if (filters.isEmpty()) return false
        return filters.any { f ->
            if (f.name != null && name != f.name) return@any false
            if (f.namePrefix != null && !name.startsWith(f.namePrefix!!)) return@any false
            for (s in f.services ?: emptyArray()) {
                if (!services.contains(uuid(s).toString())) return@any false
            }
            for (m in f.manufacturerData ?: emptyArray()) {
                val payload = manufacturer[m.companyIdentifier] ?: return@any false
                val prefix = m.dataPrefix
                if (prefix != null) {
                    val want = hex(prefix) ?: return@any false
                    if (payload.size < want.size) return@any false
                    for (i in want.indices) if (payload[i] != want[i]) return@any false
                }
            }
            true
        }
    }

    // ---- commands ------------------------------------------------------------------------------

    /** Called once by Rust at plugin setup. Until it lands, packets have nowhere to go. */
    @Command
    fun ble_set_event_channel(invoke: Invoke) {
        events = invoke.parseArgs(ChannelArgs::class.java).channel
        invoke.resolve()
    }

    /**
     * Scan until something matches, then stop.
     *
     * Filtering is done HERE rather than handed to `ScanFilter`, so the accept/reject rule is the
     * same one the desktop applies (`cube_ble::matches_request`) — service UUID or name prefix.
     * Android's own filters would silently differ on the name-prefix case, which it does not have.
     */
    @SuppressLint("MissingPermission")
    @Command
    fun ble_request_device(invoke: Invoke) {
        val args = invoke.parseArgs(RequestArgs::class.java)
        missingPermission()?.let { return invoke.reject(it) }
        val scanner = adapter?.bluetoothLeScanner ?: return invoke.reject("Bluetooth is off or absent")
        seen.clear()

        var settled = false
        lateinit var callback: ScanCallback
        val stop = Runnable {
            synchronized(this) {
                if (settled) return@Runnable
                settled = true
                scanner.stopScan(callback)
                invoke.reject("no matching device appeared within ${args.timeoutMs} ms")
            }
        }
        callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device ?: return
                val name = result.scanRecord?.deviceName ?: device.name ?: ""
                val services = result.scanRecord?.serviceUuids?.map { it.uuid.toString() } ?: emptyList()
                val manufacturer = mutableMapOf<Int, ByteArray>()
                result.scanRecord?.manufacturerSpecificData?.let { sparse ->
                    for (i in 0 until sparse.size()) {
                        sparse.valueAt(i)?.let { manufacturer[sparse.keyAt(i)] = it }
                    }
                }
                if (!matches(name, services, manufacturer, args)) return
                synchronized(this@BlePlugin) {
                    if (settled) return
                    settled = true
                }
                main.removeCallbacks(stop)
                scanner.stopScan(this)
                seen[device.address] = device
                invoke.resolve(
                    JSObject().apply {
                        put("id", device.address)
                        put("name", name)
                        put("services", JSArray(services.toTypedArray()))
                        // Passed through untouched, exactly as the desktop does: the protocol layer
                        // reads a MAC out of it per brand, and neither side knows how.
                        put(
                            "manufacturerData",
                            JSObject().apply {
                                for ((company, bytes) in manufacturer) {
                                    put(company.toString(), Base64.encodeToString(bytes, Base64.NO_WRAP))
                                }
                            },
                        )
                    },
                )
            }

            override fun onScanFailed(errorCode: Int) {
                synchronized(this@BlePlugin) {
                    if (settled) return
                    settled = true
                }
                main.removeCallbacks(stop)
                invoke.reject("scan failed with code $errorCode")
            }
        }
        scanner.startScan(
            null,
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
            callback,
        )
        main.postDelayed(stop, args.timeoutMs)
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_connect(invoke: Invoke) {
        val args = invoke.parseArgs(DeviceArgs::class.java)
        missingPermission()?.let { return invoke.reject(it) }
        val device = seen[args.id]
            ?: adapter?.getRemoteDevice(args.id)
            ?: return invoke.reject("no device with id ${args.id}")

        var settled = false
        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothAdapter.STATE_CONNECTED) {
                    // Services are discovered before resolving: every later command addresses a
                    // characteristic by (service, characteristic), and without the table those
                    // lookups return null for a device that is in fact perfectly connected.
                    g.discoverServices()
                } else if (newState == BluetoothAdapter.STATE_DISCONNECTED) {
                    connections.remove(args.id)
                    g.close()
                    if (!settled) {
                        settled = true
                        invoke.reject("the device disconnected during connect (status $status)")
                    } else {
                        events?.send(
                            JSObject().apply {
                                put("event", "ble-disconnect")
                                put("device", args.id)
                            },
                        )
                    }
                }
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                val c = connections.getOrPut(args.id) { Conn(g) }
                c.services = g.services ?: emptyList()
                if (!settled) {
                    settled = true
                    if (status == BluetoothGatt.GATT_SUCCESS) invoke.resolve()
                    else invoke.reject("service discovery failed with status $status")
                }
            }

            override fun onCharacteristicRead(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                value: ByteArray,
                status: Int,
            ) {
                pendingRead.remove(ch.uuid)?.let { done ->
                    if (status == BluetoothGatt.GATT_SUCCESS) done(Result.success(value))
                    else done(Result.failure(RuntimeException("read failed with status $status")))
                }
                conn(args.id)?.let { done(it) }
            }

            override fun onCharacteristicWrite(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                status: Int,
            ) {
                pendingWrite.remove(ch.uuid)?.let { done ->
                    if (status == BluetoothGatt.GATT_SUCCESS) done(Result.success(Unit))
                    else done(Result.failure(RuntimeException("write failed with status $status")))
                }
                conn(args.id)?.let { done(it) }
            }

            override fun onDescriptorWrite(
                g: BluetoothGatt,
                d: BluetoothGattDescriptor,
                status: Int,
            ) {
                pendingDescriptor.remove(d.characteristic.uuid)?.let { done ->
                    if (status == BluetoothGatt.GATT_SUCCESS) done(Result.success(Unit))
                    else done(Result.failure(RuntimeException("subscribe failed with status $status")))
                }
                conn(args.id)?.let { done(it) }
            }

            override fun onCharacteristicChanged(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                value: ByteArray,
            ) {
                // The packet path. Base64 because the bridge is JSON — a byte array does not
                // survive it, and a lossy encoding here corrupts a protocol nobody would suspect.
                events?.send(
                    JSObject().apply {
                        put("event", "ble-notification")
                        put("device", args.id)
                        put(
                            "service",
                            g.services.firstOrNull { s -> s.characteristics.contains(ch) }?.uuid?.toString() ?: "",
                        )
                        put("characteristic", ch.uuid.toString())
                        put("data", Base64.encodeToString(value, Base64.NO_WRAP))
                    },
                )
            }
        }
        device.connectGatt(activity, false, cb, BluetoothDevice.TRANSPORT_LE)
    }

    private val pendingRead = ConcurrentHashMap<UUID, (Result<ByteArray>) -> Unit>()
    private val pendingWrite = ConcurrentHashMap<UUID, (Result<Unit>) -> Unit>()
    private val pendingDescriptor = ConcurrentHashMap<UUID, (Result<Unit>) -> Unit>()

    @Command
    fun ble_discover_services(invoke: Invoke) {
        val args = invoke.parseArgs(DeviceArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        invoke.resolve(
            JSObject().apply {
                put("services", JSArray(c.services.map { it.uuid.toString() }.toTypedArray()))
            },
        )
    }

    @Command
    fun ble_discover_characteristics(invoke: Invoke) {
        val args = invoke.parseArgs(ServiceArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val svc = c.services.firstOrNull { it.uuid == uuid(args.service) }
            ?: return invoke.reject("device ${args.id} has no service ${args.service}")
        val list = svc.characteristics.map { ch ->
            JSObject().apply {
                put("uuid", ch.uuid.toString())
                put(
                    "properties",
                    JSObject().apply {
                        val p = ch.properties
                        put("read", p and BluetoothGattCharacteristic.PROPERTY_READ != 0)
                        put("write", p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0)
                        put(
                            "writeWithoutResponse",
                            p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0,
                        )
                        put("notify", p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0)
                        put("indicate", p and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0)
                    },
                )
            }
        }
        invoke.resolve(JSObject().apply { put("characteristics", JSArray(list.toTypedArray())) })
    }

    /**
     * Turn notifications on, which on Android is TWO steps and fails silently if you do one.
     *
     * `setCharacteristicNotification` only tells the local stack to deliver them; the remote device
     * is not told anything until its Client Characteristic Configuration descriptor is written. A
     * subscribe that skips the descriptor connects, reports success, and then no packet ever
     * arrives — the exact shape of bug that gets blamed on the cube.
     */
    @SuppressLint("MissingPermission")
    @Command
    fun ble_subscribe(invoke: Invoke) {
        val args = invoke.parseArgs(CharArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val ch = characteristic(c, args.service, args.characteristic)
            ?: return invoke.reject("no characteristic ${args.characteristic} on ${args.service}")
        val cccd = ch.getDescriptor(CCCD) ?: return invoke.reject("characteristic has no CCCD")
        val indicate = ch.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
        val value =
            if (indicate) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE

        pendingDescriptor[ch.uuid] = { r ->
            r.fold({ invoke.resolve() }, { invoke.reject(it.message ?: "subscribe failed") })
        }
        enqueue(
            c,
            Op({
                c.gatt.setCharacteristicNotification(ch, true) && writeDescriptor(c.gatt, cccd, value)
            }, { msg -> pendingDescriptor.remove(ch.uuid); invoke.reject(msg) }),
        )
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_unsubscribe(invoke: Invoke) {
        val args = invoke.parseArgs(CharArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val ch = characteristic(c, args.service, args.characteristic)
            ?: return invoke.reject("no characteristic ${args.characteristic} on ${args.service}")
        val cccd = ch.getDescriptor(CCCD)
        pendingDescriptor[ch.uuid] = { r ->
            r.fold({ invoke.resolve() }, { invoke.reject(it.message ?: "unsubscribe failed") })
        }
        enqueue(
            c,
            Op({
                c.gatt.setCharacteristicNotification(ch, false) &&
                    cccd != null &&
                    writeDescriptor(c.gatt, cccd, BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
            }, { msg -> pendingDescriptor.remove(ch.uuid); invoke.reject(msg) }),
        )
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_read(invoke: Invoke) {
        val args = invoke.parseArgs(CharArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val ch = characteristic(c, args.service, args.characteristic)
            ?: return invoke.reject("no characteristic ${args.characteristic} on ${args.service}")
        pendingRead[ch.uuid] = { r ->
            r.fold(
                { bytes ->
                    invoke.resolve(
                        JSObject().apply { put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)) },
                    )
                },
                { invoke.reject(it.message ?: "read failed") },
            )
        }
        enqueue(c, Op({ c.gatt.readCharacteristic(ch) }, { msg -> pendingRead.remove(ch.uuid); invoke.reject(msg) }))
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_write(invoke: Invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val ch = characteristic(c, args.service, args.characteristic)
            ?: return invoke.reject("no characteristic ${args.characteristic} on ${args.service}")
        val bytes = Base64.decode(args.data, Base64.NO_WRAP)
        val type =
            if (args.withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        pendingWrite[ch.uuid] = { r ->
            r.fold({ invoke.resolve() }, { invoke.reject(it.message ?: "write failed") })
        }
        enqueue(c, Op({ writeCharacteristic(c.gatt, ch, bytes, type) }, { msg -> pendingWrite.remove(ch.uuid); invoke.reject(msg) }))
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_disconnect(invoke: Invoke) {
        val args = invoke.parseArgs(DeviceArgs::class.java)
        val c = connections.remove(args.id) ?: return invoke.resolve()
        c.gatt.disconnect()
        c.gatt.close()
        invoke.resolve()
    }

    /**
     * The write calls changed shape in API 33, and the old ones do not merely warn — they were
     * deprecated because they were never thread-safe: the value lived on the characteristic object,
     * so two writes in flight raced over one buffer. Both are here because minSdk is 24.
     */
    @SuppressLint("MissingPermission")
    private fun writeCharacteristic(
        gatt: BluetoothGatt,
        ch: BluetoothGattCharacteristic,
        bytes: ByteArray,
        type: Int,
    ): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(ch, bytes, type) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                ch.writeType = type
                ch.value = bytes
                gatt.writeCharacteristic(ch)
            }
        }

    @SuppressLint("MissingPermission")
    private fun writeDescriptor(
        gatt: BluetoothGatt,
        d: BluetoothGattDescriptor,
        value: ByteArray,
    ): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(d, value) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                d.value = value
                gatt.writeDescriptor(d)
            }
        }

    companion object {
        /** Client Characteristic Configuration — the descriptor that actually enables notify. */
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}
