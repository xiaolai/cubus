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
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
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
@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT],
            alias = BlePlugin.BLUETOOTH_ALIAS,
        ),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = BlePlugin.LOCATION_ALIAS),
    ],
)
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

        /**
         * HEX, because that is what this boundary already speaks.
         *
         * The reasoning for encoding at all is sound — JSON cannot carry a byte array — but the
         * project had already answered WHICH encoding, and it is hex everywhere: `ble_write` does
         * `hex::decode`, `ble_read` returns `hex::encode`, `NotificationPayload.data` says "Hex …
         * a byte array costs ~6x the bytes of hex", and `ble-polyfill.js`'s `toBytes` THROWS on a
         * non-hex string. This field was written as base64 with a comment confidently explaining
         * the part that was right, which is how the wrong half survived review: JS would have sent
         * hex, Kotlin would have decoded it as base64, and the cube would have received bytes
         * nobody chose.
         */
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

    /**
     * Device ids with a connect in flight. A second `ble_connect` for the same id is refused rather
     * than started, because two `connectGatt` calls produce two `BluetoothGatt` objects and only one
     * can be remembered — the other stays open forever, delivering callbacks that advance a queue
     * belonging to a connection the app has already forgotten.
     */
    private val connecting = ConcurrentHashMap.newKeySet<String>()

    /** One in-flight GATT operation per connection, and everything else waiting behind it. */
    private inner class Conn(val id: String, val gatt: BluetoothGatt) {
        val queue = ArrayDeque<Op>()

        /**
         * The operation the radio is actually running, or null. Replaces a bare `busy` flag AND the
         * three process-wide `pending*` maps keyed by characteristic uuid, which is what made a
         * second operation on the same uuid overwrite the first's completion — including across
         * different connections, since the maps were not per-device. One slot on the one object
         * that owns the queue makes that unrepresentable.
         */
        var active: Op? = null
        var services: List<android.bluetooth.BluetoothGattService> = emptyList()

        /** Set once, on teardown. A closed connection settles new work immediately, never queues it. */
        var closed = false
    }

    /** What an operation is waiting for. Checked in the callback, so a stray one cannot settle it. */
    private enum class Kind { READ, WRITE, DESCRIPTOR }

    private inner class Op(
        val kind: Kind,
        val characteristic: UUID,
        /** Names the operation in its own failure message — "subscribe", not always "subscribe". */
        val label: String,
        val start: () -> Boolean,
        val settle: (Result<ByteArray>) -> Unit,
    ) {
        var timeout: Runnable? = null
    }

    private fun conn(id: String): Conn? = connections[id]

    /**
     * Run [op] when the connection is free, and never before. See the class note: Android GATT
     * takes one operation at a time and rejects — or silently loses — the rest.
     */
    private fun enqueue(c: Conn, op: Op) {
        synchronized(c) {
            if (c.closed) {
                op.settle(Result.failure(RuntimeException("the device disconnected")))
                return
            }
            c.queue.add(op)
            if (c.active == null) pump(c)
        }
    }

    private fun pump(c: Conn) {
        synchronized(c) {
            if (c.active != null) return
            while (true) {
                val next = c.queue.poll() ?: return
                c.active = next
                arm(c, next)
                if (next.start()) return
                // Refused before it began: settle it and take the next, rather than recursing.
                c.active = null
                disarm(next)
                next.settle(Result.failure(RuntimeException("the GATT stack refused the ${next.label}")))
            }
        }
    }

    /**
     * Settle the active operation, if the callback that arrived is the one it was waiting for.
     *
     * The kind and characteristic are CHECKED rather than assumed. A GATT stack may deliver a
     * callback for work that has already timed out, or for a characteristic nothing is waiting on;
     * settling on arrival alone would hand one operation's result to another.
     */
    private fun finish(c: Conn, kind: Kind, characteristic: UUID, result: Result<ByteArray>) {
        val op = synchronized(c) {
            val a = c.active
            if (a == null || a.kind != kind || a.characteristic != characteristic) return
            c.active = null
            disarm(a)
            a
        }
        op.settle(result)
        pump(c)
    }

    /**
     * Every operation gets a deadline, because Android GATT can simply not call back.
     *
     * Without one, a lost callback left `busy` true for the life of the process and every later
     * command on that connection queued behind an operation that would never complete — a cube that
     * works for a few seconds and then stops responding, with nothing logged. Ten seconds is far
     * longer than any real GATT round trip and short enough that a user notices an error instead of
     * a hang.
     *
     * AND A TIMEOUT ENDS THE CONNECTION, not just the operation. A stack that lost one callback does
     * not recover: the late callback, if it ever comes, lands on whatever operation is active THEN
     * and settles it with the wrong result (audit 2026-09-04, mobile B5) — and a stack that stays
     * silent leaves every following operation to time out in turn, ten seconds each. Tearing the
     * connection down fails the queue at once with a sentence, tells the web side the cube is gone
     * (the same `ble-disconnect` a remote drop sends), and lets its reconnect flow do what it is
     * built for. The GATT object is closed, so the late callback has nowhere to land.
     */
    private fun arm(c: Conn, op: Op) {
        val fire = Runnable {
            val reason = "the ${op.label} timed out after $OP_TIMEOUT_MS ms — no GATT callback arrived"
            finish(c, op.kind, op.characteristic, Result.failure(RuntimeException(reason)))
            if (connections[c.id] === c) {
                runCatching { c.gatt.disconnect() }
                teardown(c.id, "$reason; the connection was closed because a stack that lost a callback does not recover")
                events?.send(
                    JSObject().apply {
                        put("event", "ble-disconnect")
                        put("device", c.id)
                    },
                )
            }
        }
        op.timeout = fire
        main.postDelayed(fire, OP_TIMEOUT_MS)
    }

    private fun disarm(op: Op) {
        op.timeout?.let { main.removeCallbacks(it) }
        op.timeout = null
    }

    /**
     * Let a connection go, failing everything that was waiting on it.
     *
     * One place, so a disconnect cannot do half the job. Both disconnect paths — the remote drop in
     * `onConnectionStateChange` and the explicit `ble_disconnect` — used to remove the connection
     * and leave its active and queued operations behind: their invokes never settled, so the web
     * side awaited a promise that could not resolve, and their closures stayed reachable from the
     * process-wide pending maps for as long as the app ran.
     */
    private fun teardown(id: String, reason: String): Boolean {
        val c = connections.remove(id) ?: return false
        val pending = synchronized(c) {
            c.closed = true
            val all = ArrayList<Op>(c.queue.size + 1)
            c.active?.let {
                disarm(it)
                all.add(it)
            }
            c.active = null
            all.addAll(c.queue)
            c.queue.clear()
            all
        }
        for (op in pending) op.settle(Result.failure(RuntimeException(reason)))
        runCatching { c.gatt.close() }
        return true
    }

    // ---- helpers -------------------------------------------------------------------------------

    /**
     * The alias this Android version actually needs granted, or null when it is already granted.
     *
     * API 31 split Bluetooth out of location. Below that, a BLE SCAN is a location capability and
     * needs `ACCESS_FINE_LOCATION`; this returned null there, so the plugin scanned with nothing
     * granted — and an unpermitted scan on those releases does not fail, it simply reports no
     * results, which reads as a cube that will not advertise.
     */
    private fun neededAlias(): String? {
        val alias =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) BLUETOOTH_ALIAS else LOCATION_ALIAS
        return if (getPermissionState(alias) == PermissionState.GRANTED) null else alias
    }

    /**
     * Ask for the permission, then run [proceed]. A manifest entry alone grants nothing since
     * Android 6, and this plugin previously had no request path at all — on a fresh install every
     * command could only reject, permanently, with no prompt ever shown.
     */
    private fun withPermission(invoke: Invoke, proceed: () -> Unit) {
        val alias = neededAlias()
        if (alias == null) {
            proceed()
            return
        }
        pendingPermissionAction[invoke.id] = proceed
        requestPermissionForAlias(alias, invoke, "onPermissionResult")
    }

    /**
     * What to run once the user has answered, keyed by the INVOKE — not by its command name. Two
     * concurrent invokes of one command are two entries; keyed by name, the second overwrote the
     * first and one of the two promises never settled.
     */
    private val pendingPermissionAction = ConcurrentHashMap<Long, () -> Unit>()

    @PermissionCallback
    private fun onPermissionResult(invoke: Invoke) {
        val proceed = pendingPermissionAction.remove(invoke.id)
        val alias = neededAlias()
        if (alias != null) {
            return invoke.reject("Bluetooth permission was not granted")
        }
        if (proceed == null) {
            return invoke.reject("the permission result arrived with nothing waiting on it")
        }
        // Inside Tauri's ActivityResult callback there is no try/catch above this frame: a
        // throwing first post-grant command — `startScan` with Bluetooth toggled off meanwhile —
        // crashed the app instead of rejecting one promise.
        runCatching(proceed).onFailure {
            invoke.reject("${invoke.command} failed after the permission was granted: ${it.message}")
        }
    }

    /**
     * Below API 31 a BLE scan is a LOCATION capability, and having the permission is not enough:
     * with Location Services switched off the scan does not fail, it returns nothing, which reads
     * as a cube that will not advertise. Named as the cause instead. API 28 grew the direct
     * question; before it the answer is the secure setting's mode.
     */
    private fun locationServicesOff(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val lm = activity.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            lm?.isLocationEnabled == false
        } else {
            @Suppress("DEPRECATION")
            Settings.Secure.getInt(activity.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF) ==
                Settings.Secure.LOCATION_MODE_OFF
        }
    }

    private fun characteristic(c: Conn, service: String, ch: String): BluetoothGattCharacteristic? =
        c.services.firstOrNull { it.uuid == uuid(service) }?.getCharacteristic(uuid(ch))

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
    fun ble_request_device(invoke: Invoke) = withPermission(invoke) { scanFor(invoke) }

    @SuppressLint("MissingPermission")
    private fun scanFor(invoke: Invoke) {
        val args = invoke.parseArgs(RequestArgs::class.java)
        val scanner = adapter?.bluetoothLeScanner ?: return invoke.reject("Bluetooth is off or absent")
        if (locationServicesOff()) {
            return invoke.reject(
                "Location Services are off — before Android 12 the system will not scan for Bluetooth " +
                    "devices without them; turn Location on and try again",
            )
        }
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
                                    put(company.toString(), toHex(bytes))
                                }
                            },
                        )
                        // `rssi` is not optional on the wire. `AdvertisedDevice` declares it
                        // `Option<i16>` with no `#[serde(default)]`, and serde still requires an
                        // ABSENT field to be present — so omitting it fails the whole command
                        // rather than defaulting to null.
                        put("rssi", result.rssi)
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
    fun ble_connect(invoke: Invoke) = withPermission(invoke) { connectTo(invoke) }

    @SuppressLint("MissingPermission")
    private fun connectTo(invoke: Invoke) {
        val args = invoke.parseArgs(DeviceArgs::class.java)
        // From the last scan ONLY — the same rule the desktop keeps ("was not returned by the last
        // scan"). `getRemoteDevice` accepted any well-formed MAC and would connect to whatever
        // answered at it, which made this command a looser surface on one platform than on the
        // others; and a device that was never seen advertising is not one the user chose.
        val device = seen[args.id]
            ?: return invoke.reject("device ${args.id} was not returned by the last scan")

        if (connections.containsKey(args.id)) return invoke.reject("device ${args.id} is already connected")
        // Refused, not serialised: a second attempt while the first is in flight would leave one of
        // the two GATT objects unreachable and still open.
        if (!connecting.add(args.id)) return invoke.reject("device ${args.id} is already connecting")

        var settled = false
        /** Settle the connect exactly once, and stop holding the id as pending. */
        fun settle(ok: Boolean, message: String = "") {
            synchronized(this@BlePlugin) {
                if (settled) return
                settled = true
            }
            connecting.remove(args.id)
            if (ok) invoke.resolve() else invoke.reject(message)
        }

        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothAdapter.STATE_CONNECTED) {
                    // Services are discovered before resolving: every later command addresses a
                    // characteristic by (service, characteristic), and without the table those
                    // lookups return null for a device that is in fact perfectly connected.
                    //
                    // The RESULT is checked. `discoverServices` returning false means no callback is
                    // coming, so a connect that ignored it waited forever on a promise nothing would
                    // settle — and the web side could not even disconnect, because the GATT object
                    // had not been stored anywhere it could reach.
                    if (!g.discoverServices()) {
                        runCatching { g.close() }
                        settle(false, "the device connected but service discovery would not start")
                    }
                } else if (newState == BluetoothAdapter.STATE_DISCONNECTED) {
                    // Everything waiting on this connection fails here, rather than being dropped.
                    // `had` is false when a timeout already tore this connection down (and already
                    // sent the disconnect event) — the late callback must not send a second one.
                    val had = teardown(args.id, "the device disconnected")
                    runCatching { g.close() }
                    if (!settled) {
                        settle(false, "the device disconnected during connect (status $status)")
                    } else if (had) {
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
                // PUBLISHED ONLY ON SUCCESS. This used to insert the connection first and check the
                // status afterwards, so a failed discovery rejected `ble_connect` and still left a
                // usable-looking `Conn` in the map — every later command then addressed a device
                // whose service table was empty, and failed with "no characteristic" instead of
                // saying the connection had never come up.
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    teardown(args.id, "service discovery failed")
                    runCatching { g.disconnect() }
                    runCatching { g.close() }
                    settle(false, "service discovery failed with status $status")
                    return
                }
                val c = Conn(args.id, g)
                c.services = g.services ?: emptyList()
                connections[args.id] = c
                settle(true)
            }

            // ---- API 33 callbacks, and the API 24–32 ones they replaced -------------------------
            //
            // BOTH, because minSdk is 24. Android calls the legacy overload on every release before
            // 33, so a plugin that implements only the new one never learns that a read completed or
            // that a notification arrived: reads hang until their deadline and the packet stream is
            // silent, on the majority of devices in service. The WRITE path in this same file had
            // already been split for exactly this reason — the callbacks were simply missed.
            //
            // The legacy overloads read `ch.value`, which is a buffer the stack reuses, so it is
            // copied immediately rather than handed on.

            override fun onCharacteristicRead(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                value: ByteArray,
                status: Int,
            ) = completeRead(args.id, ch.uuid, value, status)

            @Deprecated("Called by Android below API 33; kept because minSdk is 24.")
            @Suppress("DEPRECATION")
            override fun onCharacteristicRead(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                status: Int,
            ) = completeRead(args.id, ch.uuid, ch.value?.copyOf() ?: ByteArray(0), status)

            override fun onCharacteristicWrite(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                status: Int,
            ) {
                conn(args.id)?.let {
                    finish(it, Kind.WRITE, ch.uuid, gattResult(status, ByteArray(0), "write"))
                }
            }

            override fun onDescriptorWrite(
                g: BluetoothGatt,
                d: BluetoothGattDescriptor,
                status: Int,
            ) {
                conn(args.id)?.let {
                    finish(
                        it,
                        Kind.DESCRIPTOR,
                        d.characteristic.uuid,
                        gattResult(status, ByteArray(0), "descriptor write"),
                    )
                }
            }

            override fun onCharacteristicChanged(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
                value: ByteArray,
            ) = deliver(args.id, g, ch, value)

            @Deprecated("Called by Android below API 33; kept because minSdk is 24.")
            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(
                g: BluetoothGatt,
                ch: BluetoothGattCharacteristic,
            ) = deliver(args.id, g, ch, ch.value?.copyOf() ?: ByteArray(0))
        }

        // `connectGatt` can return null when the stack refuses outright, and then no callback ever
        // arrives — the same silent hang `discoverServices` produces, one step earlier.
        val gatt = runCatching { device.connectGatt(activity, false, cb, BluetoothDevice.TRANSPORT_LE) }
            .getOrNull()
        if (gatt == null) {
            settle(false, "the Bluetooth stack refused to connect to ${args.id}")
        }
    }

    /** Both read overloads land here, so the two API eras cannot drift apart. */
    private fun completeRead(id: String, characteristic: UUID, value: ByteArray, status: Int) {
        conn(id)?.let { finish(it, Kind.READ, characteristic, gattResult(status, value, "read")) }
    }

    /**
     * The packet path. HEX, because that is what this boundary speaks — `ble_read` returns
     * `hex::encode`, `ble_write` takes `hex::decode`, and `ble-polyfill.js`'s `toBytes` throws on a
     * non-hex string. (The tensor boundary in `cube-vision` uses base64 for a stated reason: it
     * carries ~170 KB a frame, where hex's 2x costs real time. A 20-byte cube packet does not.)
     *
     * What leaves here is the GATT triple. `android_ble.rs::relay` re-keys it to the `{ sub, data }`
     * that `ble-bridge.js` validates — Kotlin never learns that subscription ids exist.
     */
    private fun deliver(
        id: String,
        g: BluetoothGatt,
        ch: BluetoothGattCharacteristic,
        value: ByteArray,
    ) {
        events?.send(
            JSObject().apply {
                put("event", "ble-notification")
                put("device", id)
                put(
                    "service",
                    g.services.firstOrNull { s -> s.characteristics.contains(ch) }?.uuid?.toString() ?: "",
                )
                put("characteristic", ch.uuid.toString())
                put("data", toHex(value))
            },
        )
    }

    /** One status→Result mapping, so every operation reports its own name on failure. */
    private fun gattResult(status: Int, value: ByteArray, label: String): Result<ByteArray> =
        if (status == BluetoothGatt.GATT_SUCCESS) Result.success(value)
        else Result.failure(RuntimeException("$label failed with status $status"))

    @Command
    fun ble_discover_services(invoke: Invoke) {
        val args = invoke.parseArgs(DeviceArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        // A BARE array, because `ble_discover_services` deserialises `Vec<String>`. Wrapping it
        // in `{ services: [...] }` failed at the bridge boundary — the same wrapper `ble_read`
        // has a `ReadReply` struct for, which is why exactly one of the three commands worked.
        // `resolveObject` serialises straight through Jackson, so the reply is the array itself.
        invoke.resolveObject(c.services.map { it.uuid.toString() })
    }

    @Command
    fun ble_discover_characteristics(invoke: Invoke) {
        val args = invoke.parseArgs(ServiceArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val svc = c.services.firstOrNull { it.uuid == uuid(args.service) }
            ?: return invoke.reject("device ${args.id} has no service ${args.service}")
        // Plain maps rather than `JSObject`, because `resolveObject` hands the value to Jackson
        // and a bare array is what `Vec<CharacteristicInfo>` expects. Field names are the serde
        // ones (`CharacteristicInfo` is `rename_all = "camelCase"`).
        val list = svc.characteristics.map { ch ->
            val p = ch.properties
            mapOf(
                "uuid" to ch.uuid.toString(),
                // ALL SEVEN of `CharacteristicProperties`, not the five the app happens to read.
                // None of them carry `#[serde(default)]`, and serde requires an absent field to be
                // present — so omitting `broadcast` and `authenticatedSignedWrites` fails the whole
                // command rather than defaulting them to false. Exactly the trap `rssi` fell into
                // on `AdvertisedDevice`, in the same session, one struct along.
                "properties" to mapOf(
                    "broadcast" to (p and BluetoothGattCharacteristic.PROPERTY_BROADCAST != 0),
                    "read" to (p and BluetoothGattCharacteristic.PROPERTY_READ != 0),
                    "writeWithoutResponse" to
                        (p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0),
                    "write" to (p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0),
                    "notify" to (p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0),
                    "indicate" to (p and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0),
                    "authenticatedSignedWrites" to
                        (p and BluetoothGattCharacteristic.PROPERTY_SIGNED_WRITE != 0),
                ),
            )
        }
        invoke.resolveObject(list)
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

        enqueue(
            c,
            Op(
                kind = Kind.DESCRIPTOR,
                characteristic = ch.uuid,
                label = "subscribe",
                start = {
                    // Local delivery first, then tell the remote device. If the descriptor write
                    // cannot even start, undo the local half rather than leaving this side
                    // believing it is subscribed while the peripheral was never asked.
                    if (!c.gatt.setCharacteristicNotification(ch, true)) {
                        false
                    } else if (writeDescriptor(c.gatt, cccd, value)) {
                        true
                    } else {
                        c.gatt.setCharacteristicNotification(ch, false)
                        false
                    }
                },
                settle = { r ->
                    r.fold({ invoke.resolve() }, {
                        // The descriptor write was refused or failed at the peripheral, so roll the
                        // local half back here too: the two sides agree, or neither is subscribed.
                        runCatching { c.gatt.setCharacteristicNotification(ch, false) }
                        invoke.reject(it.message ?: "subscribe failed")
                    })
                },
            ),
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
            ?: return invoke.reject("characteristic has no CCCD")

        enqueue(
            c,
            Op(
                kind = Kind.DESCRIPTOR,
                characteristic = ch.uuid,
                label = "unsubscribe",
                start = {
                    c.gatt.setCharacteristicNotification(ch, false) &&
                        writeDescriptor(c.gatt, cccd, BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
                },
                settle = { r ->
                    r.fold({ invoke.resolve() }, { invoke.reject(it.message ?: "unsubscribe failed") })
                },
            ),
        )
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_read(invoke: Invoke) {
        val args = invoke.parseArgs(CharArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val ch = characteristic(c, args.service, args.characteristic)
            ?: return invoke.reject("no characteristic ${args.characteristic} on ${args.service}")
        enqueue(
            c,
            Op(
                kind = Kind.READ,
                characteristic = ch.uuid,
                label = "read",
                start = { c.gatt.readCharacteristic(ch) },
                settle = { r ->
                    r.fold(
                        // Hex, and BARE: `android_ble::read` unwraps a `{ data }` object, which is
                        // the one place the wrapper is expected. Kept as-is deliberately.
                        { bytes -> invoke.resolve(JSObject().apply { put("data", toHex(bytes)) }) },
                        { invoke.reject(it.message ?: "read failed") },
                    )
                },
            ),
        )
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_write(invoke: Invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        val c = conn(args.id) ?: return invoke.reject("no connected device with id ${args.id}")
        val ch = characteristic(c, args.service, args.characteristic)
            ?: return invoke.reject("no characteristic ${args.characteristic} on ${args.service}")
        val bytes = hex(args.data)
            ?: return invoke.reject("data is not hex: ${args.data.take(24)}")
        val type =
            if (args.withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        enqueue(
            c,
            Op(
                kind = Kind.WRITE,
                characteristic = ch.uuid,
                label = "write",
                start = { writeCharacteristic(c.gatt, ch, bytes, type) },
                settle = { r ->
                    r.fold({ invoke.resolve() }, { invoke.reject(it.message ?: "write failed") })
                },
            ),
        )
    }

    @SuppressLint("MissingPermission")
    @Command
    fun ble_disconnect(invoke: Invoke) {
        val args = invoke.parseArgs(DeviceArgs::class.java)
        val c = conn(args.id) ?: return invoke.resolve()
        // `teardown` fails everything still queued and closes the GATT object. Without it those
        // invokes stayed pending forever on a connection that no longer existed.
        c.gatt.disconnect()
        teardown(args.id, "the connection was closed")
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
        // ---- pure helpers ----------------------------------------------------------------------
        //
        // In the companion, not on the instance, for ONE reason: a JVM test can call them. They
        // depend on nothing but their arguments, and the defect they hid — `uuid("fff0")` building
        // a twelve-digit UUID group — is the kind a single assertion catches and no amount of
        // reading reliably does. Everything that needs a radio stays on the instance.
        /**
         * Android wants full 128-bit UUIDs; the protocol layer speaks both.
         *
         * The 16- and 32-bit forms expand into the Bluetooth Base UUID, which means the value becomes
         * the FIRST GROUP — eight hex digits, zero-padded on the left. This prepended a further
         * `"0000"` to an already-padded eight, so `uuid("fff0")` produced a twelve-digit first group
         * (`00000000fff0-0000-…`): malformed for every short UUID, which is the only kind the protocol
         * layer actually writes down. `padStart` alone is the whole operation.
         */
        fun uuid(s: String): UUID =
            if (s.length == 4 || s.length == 8) {
                UUID.fromString("${s.padStart(8, '0')}-0000-1000-8000-00805f9b34fb")
            } else {
                UUID.fromString(s)
            }

        /** Bytes → lowercase hex, the encoding every other half of this bridge uses. */
        fun toHex(bytes: ByteArray): String {
            val sb = StringBuilder(bytes.size * 2)
            for (b in bytes) sb.append(HEX[(b.toInt() shr 4) and 0xf]).append(HEX[b.toInt() and 0xf])
            return sb.toString()
        }

        /**
         * Hex → bytes, or null. DIGITS ONLY: `String.toInt(16)` accepts a sign, so `"+f"` and
         * `"-1"` parsed as bytes nobody sent. Every character is checked against the sixteen hex
         * digits before any parsing, which is also what `hex::decode` on the Rust side does.
         */
        fun hex(s: String): ByteArray? {
            if (s.length % 2 != 0) return null
            val out = ByteArray(s.length / 2)
            for (i in out.indices) {
                val hi = Character.digit(s[i * 2], 16)
                val lo = Character.digit(s[i * 2 + 1], 16)
                if (hi < 0 || lo < 0) return null
                out[i] = ((hi shl 4) or lo).toByte()
            }
            return out
        }

        /**
         * A port of `cube_ble::matches_request`, clause for clause.
         *
         * Every clause is an AND within one filter and the filters are ORed, which is Web Bluetooth's
         * own rule. Written out rather than approximated because the two builds have to agree about
         * which devices EXIST — a looser rule here shows the user a cube the desktop would not, and a
         * tighter one hides a cube the desktop finds.
         */
        fun matches(
            name: String,
            services: List<String>,
            manufacturer: Map<Int, ByteArray>,
            args: RequestArgs,
        ): Boolean {
            if (args.acceptAllDevices) return true
            val filters = args.filters ?: return false
            if (filters.isEmpty()) return false
            return filters.any { f ->
                // At least one criterion, exactly as `cube_ble::matches_request` requires. Without
                // this the closure falls through to `true` and an empty filter matches every
                // advertiser in range — the two builds disagreeing about what exists, which is the
                // one thing this port was written out clause for clause to prevent.
                if (f.name == null &&
                    f.namePrefix == null &&
                    f.services.isNullOrEmpty() &&
                    f.manufacturerData.isNullOrEmpty()
                ) {
                    return@any false
                }
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


        /** Client Characteristic Configuration — the descriptor that actually enables notify. */
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private val HEX = "0123456789abcdef".toCharArray()

        /** See [arm]: long enough for any real GATT round trip, short enough to surface as an error. */
        private const val OP_TIMEOUT_MS = 10_000L

        /**
         * The permission aliases this plugin asks for, by Android era.
         *
         * TWO groups, because the model changed in API 31 and the OLD one is not optional on the
         * devices that still use it: scanning below API 31 requires a LOCATION permission, which is
         * why `ACCESS_FINE_LOCATION` is declared in the manifest with `maxSdkVersion="30"`. Asking
         * only for the API 31+ pair left every device from 24 to 30 scanning with no permission at
         * all — which does not throw, it just returns nothing, so the cube simply never appears.
         */
        const val BLUETOOTH_ALIAS = "bluetooth"
        const val LOCATION_ALIAS = "location"
    }
}
