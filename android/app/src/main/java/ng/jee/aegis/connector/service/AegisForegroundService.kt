package ng.jee.aegis.connector.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.location.Location
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import ng.jee.aegis.connector.MainActivity
import ng.jee.aegis.connector.R
import ng.jee.aegis.connector.data.AegisApiClient
import ng.jee.aegis.connector.data.SecureStore
import org.json.JSONObject
import java.time.Instant
import kotlin.coroutines.resume

class AegisForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var store: SecureStore
    private lateinit var api: AegisApiClient
    private var cameraManager: CameraManager? = null
    private var torchCameraId: String? = null

    private var alarmPlayer: MediaPlayer? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var alarmActive = false
    private var torchOn = false
    private var cameraAssistActive = false

    private val torchCallback = object : CameraManager.TorchCallback() {
        override fun onTorchModeChanged(cameraId: String, enabled: Boolean) {
            super.onTorchModeChanged(cameraId, enabled)
            if (cameraId == torchCameraId) {
                torchOn = enabled
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        store = SecureStore(this)
        api = AegisApiClient(store)
        ensureNotificationChannel()
        runCatching {
            startForeground(NOTIFICATION_ID, buildNotification("AEGIS Connector Active"))
        }
        initTorchSupport()
    }

    private fun initTorchSupport() {
        runCatching {
            val cm = getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return
            cameraManager = cm
            torchCameraId = cm.cameraIdList.firstOrNull { id ->
                cm.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            }
            cm.registerTorchCallback(torchCallback, null)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val commandId = intent?.getStringExtra(EXTRA_COMMAND_ID)
        val commandType = intent?.getStringExtra(EXTRA_COMMAND_TYPE)

        when (action) {
            ACTION_STOP_ALARM -> {
                stopAlarm()
                scope.launch { sendTelemetrySnapshot() }
            }
            ACTION_STOP_CAMERA_ASSIST -> {
                stopCameraAssist()
                scope.launch { sendTelemetrySnapshot() }
            }
            ACTION_EXECUTE_COMMAND -> {
                if (!commandId.isNullOrBlank() && !commandType.isNullOrBlank()) {
                    scope.launch { handleCommandWithWakeLock(commandId, commandType) }
                }
            }
            ACTION_SYNC_NOW -> {
                scope.launch {
                    sendTelemetrySnapshot()
                    val pending = api.fetchPendingCommands()
                    pending.forEach { cmd ->
                        handleCommandWithWakeLock(cmd.id, cmd.commandType)
                    }
                }
            }
        }
        return START_STICKY
    }

    private suspend fun handleCommandWithWakeLock(commandId: String, commandType: String) {
        if (store.isCommandExecuted(commandId)) {
            return
        }

        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "JeeAegis::CommandExecWakeLock"
        )
        try {
            wakeLock?.acquire(30_000L)
            handleCommand(commandId, commandType)
        } finally {
            if (wakeLock?.isHeld == true) {
                runCatching { wakeLock.release() }
            }
        }
    }

    private suspend fun handleCommand(commandId: String, commandType: String) {
        var freshLocation: Location? = null

        val result: Result<Unit> = runCatching {
            when (commandType) {
                "RING_START" -> startAlarm()
                "RING_STOP" -> stopAlarm()
                "TORCH_ON" -> setTorch(true)
                "TORCH_OFF" -> setTorch(false)
                "LOCATE_NOW" -> {
                    freshLocation = resolveCurrentLocation(forceHighAccuracy = true)
                    if (freshLocation == null) {
                        error("Location unavailable: check GPS setting or location permission")
                    }
                }
                "CAMERA_ASSIST_START" -> startCameraAssist()
                "CAMERA_ASSIST_STOP" -> stopCameraAssist()
                "SYNC_STATUS" -> {
                    freshLocation = resolveCurrentLocation(forceHighAccuracy = false)
                }
                else -> error("Unsupported command: $commandType")
            }
        }

        val telemetry = buildTelemetryPayload(freshLocation)
        if (result.isSuccess) {
            store.markCommandExecuted(commandId)
            api.ackCommand(commandId, "acked", telemetry = telemetry)
        } else {
            val errMsg = result.exceptionOrNull()?.message ?: "Execution failed"
            api.ackCommand(commandId, "failed", errorMessage = errMsg, telemetry = telemetry)
        }
    }

    private fun startAlarm() {
        if (alarmActive && alarmPlayer?.isPlaying == true) {
            return
        }
        stopAlarmInternal()

        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: error("No system alarm or ringtone sound available on this device")

        val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(attrs)
                    .build()
                audioManager.requestAudioFocus(req)
                audioFocusRequest = req
            }
            // Raise alarm stream volume to 85% of max within Android's standard volume controls
            runCatching {
                val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
                val currentVol = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
                val targetVol = (maxVol * 0.85).toInt().coerceAtLeast(1)
                if (currentVol < targetVol) {
                    audioManager.setStreamVolume(AudioManager.STREAM_ALARM, targetVol, 0)
                }
            }
        }

        val player = MediaPlayer().apply {
            setDataSource(applicationContext, uri)
            setAudioAttributes(attrs)
            isLooping = true
            prepare()
            start()
        }

        alarmPlayer = player
        alarmActive = true
        isAlarmPlaying = true
        updateNotification("Recovery Alarm Active — Tap Stop Alarm to silence")
    }

    private fun stopAlarmInternal() {
        runCatching {
            alarmPlayer?.let { player ->
                if (player.isPlaying) {
                    player.stop()
                }
                player.reset()
                player.release()
            }
        }
        alarmPlayer = null
        alarmActive = false
        isAlarmPlaying = false

        val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioManager != null) {
            audioFocusRequest?.let { req ->
                runCatching { audioManager.abandonAudioFocusRequest(req) }
            }
        }
        audioFocusRequest = null
    }

    private fun stopAlarm() {
        stopAlarmInternal()
        updateNotification(
            if (cameraAssistActive) "Camera Assistance Active (Owner Visible)"
            else "AEGIS Connector Active"
        )
    }

    private fun setTorch(enabled: Boolean) {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)) {
            error("Flashlight hardware is not supported on this device")
        }
        val cm = cameraManager ?: (getSystemService(Context.CAMERA_SERVICE) as? CameraManager)
            ?: error("Camera service unavailable")
        val id = torchCameraId ?: cm.cameraIdList.firstOrNull { camId ->
            cm.getCameraCharacteristics(camId)
                .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: error("No camera flash unit found")

        if (torchOn == enabled) {
            return
        }

        try {
            cm.setTorchMode(id, enabled)
            torchOn = enabled
        } catch (e: CameraAccessException) {
            val reason = when (e.reason) {
                CameraAccessException.CAMERA_IN_USE -> "Flashlight unavailable: camera is currently in use"
                CameraAccessException.MAX_CAMERAS_IN_USE -> "Flashlight unavailable: maximum cameras in use"
                CameraAccessException.CAMERA_DISABLED -> "Flashlight unavailable: camera is disabled by policy"
                else -> "Flashlight hardware error (${e.reason})"
            }
            error(reason)
        } catch (e: SecurityException) {
            error("Flashlight permission denied: ${e.message}")
        }
    }

    private fun startCameraAssist() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) error("Camera permission not granted by owner")
        cameraAssistActive = true
        updateNotification("Camera Assistance Active — Visible Owner Session")
    }

    private fun stopCameraAssist() {
        cameraAssistActive = false
        updateNotification(
            if (alarmActive) "Recovery Alarm Active — Tap Stop Alarm to silence"
            else "AEGIS Connector Active"
        )
    }

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    private fun isLocationServicesEnabled(): Boolean {
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lm.isLocationEnabled
        } else {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun resolveCurrentLocation(forceHighAccuracy: Boolean): Location? {
        if (!hasLocationPermission() || !isLocationServicesEnabled()) {
            return null
        }
        val fused = LocationServices.getFusedLocationProviderClient(this)

        if (forceHighAccuracy) {
            val fresh = withTimeoutOrNull(10_000L) {
                suspendCancellableCoroutine<Location?> { cont ->
                    val cts = CancellationTokenSource()
                    cont.invokeOnCancellation { cts.cancel() }
                    fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                        .addOnSuccessListener { loc ->
                            if (cont.isActive) cont.resume(loc)
                        }
                        .addOnFailureListener {
                            if (cont.isActive) cont.resume(null)
                        }
                }
            }
            if (fresh != null) return fresh
        }

        return withTimeoutOrNull(4_000L) {
            suspendCancellableCoroutine<Location?> { cont ->
                fused.lastLocation
                    .addOnSuccessListener { loc ->
                        if (cont.isActive) cont.resume(loc)
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
            }
        }
    }

    private fun buildTelemetryPayload(location: Location?): JSONObject {
        val batteryMgr = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryPct = batteryMgr.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val isCharging = batteryMgr.isCharging

        val hasFineLoc = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasBgLoc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        } else true
        val hasCamera = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        val hasMic = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        val hasNotif = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else true

        val permissions = JSONObject()
            .put("location", hasFineLoc)
            .put("background_location", hasBgLoc)
            .put("location_services_enabled", isLocationServicesEnabled())
            .put("camera", hasCamera)
            .put("microphone", hasMic)
            .put("notifications", hasNotif)
            .put("torch_available", packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH))

        val payload = JSONObject()
            .put("battery_level", batteryPct.coerceIn(0, 100))
            .put("is_charging", isCharging)
            .put("network_type", getNetworkType())
            .put("permissions", permissions)
            .put("torch_on", torchOn)
            .put("alarm_active", alarmActive)
            .put("camera_assist_active", cameraAssistActive)

        if (!store.fcmToken.isNullOrBlank()) {
            payload.put("fcm_token", store.fcmToken)
        }

        if (location != null) {
            payload.put("latitude", location.latitude)
            payload.put("longitude", location.longitude)
            payload.put("location_accuracy_m", location.accuracy.toDouble())
            if (location.time > 0) {
                payload.put("location_timestamp", Instant.ofEpochMilli(location.time).toString())
            }
        }
        return payload
    }

    private suspend fun sendTelemetrySnapshot(forceLocation: Boolean = false) {
        val loc = resolveCurrentLocation(forceHighAccuracy = forceLocation)
        val payload = buildTelemetryPayload(loc)
        api.sendHeartbeat(payload)
    }

    private fun getNetworkType(): String {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "offline"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_aegis_service),
                NotificationManager.IMPORTANCE_LOW
            )
            mgr.createNotificationChannel(channel)
        }
    }

    private fun updateNotification(text: String) {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(contentText: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentIntent(openIntent)
            .setOngoing(true)

        if (alarmActive) {
            val stopIntent = PendingIntent.getService(
                this,
                1,
                Intent(this, AegisForegroundService::class.java).setAction(ACTION_STOP_ALARM),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            builder.addAction(0, "Stop Alarm", stopIntent)
        }

        if (cameraAssistActive) {
            val stopCamIntent = PendingIntent.getService(
                this,
                2,
                Intent(this, AegisForegroundService::class.java).setAction(ACTION_STOP_CAMERA_ASSIST),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            builder.addAction(0, "Stop Camera Assist", stopCamIntent)
        }

        return builder.build()
    }

    override fun onDestroy() {
        stopAlarmInternal()
        runCatching { cameraManager?.unregisterTorchCallback(torchCallback) }
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "aegis_connector_channel"
        const val NOTIFICATION_ID = 4001
        const val ACTION_EXECUTE_COMMAND = "ng.jee.aegis.EXECUTE_COMMAND"
        const val ACTION_SYNC_NOW = "ng.jee.aegis.SYNC_NOW"
        const val ACTION_STOP_ALARM = "ng.jee.aegis.STOP_ALARM"
        const val ACTION_STOP_CAMERA_ASSIST = "ng.jee.aegis.STOP_CAMERA_ASSIST"
        const val EXTRA_COMMAND_ID = "command_id"
        const val EXTRA_COMMAND_TYPE = "command_type"

        @Volatile
        var isAlarmPlaying: Boolean = false
    }
}
