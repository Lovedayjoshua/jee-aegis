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
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import ng.jee.aegis.connector.MainActivity
import ng.jee.aegis.connector.R
import ng.jee.aegis.connector.data.AegisApiClient
import ng.jee.aegis.connector.data.SecureStore
import org.json.JSONObject

class AegisForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var store: SecureStore
    private lateinit var api: AegisApiClient

    private var alarmRingtone: Ringtone? = null
    private var alarmActive = false
    private var torchOn = false
    private var cameraAssistActive = false

    override fun onCreate() {
        super.onCreate()
        store = SecureStore(this)
        api = AegisApiClient(store)
        ensureNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("AEGIS Connector Active"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val commandId = intent?.getStringExtra(EXTRA_COMMAND_ID)
        val commandType = intent?.getStringExtra(EXTRA_COMMAND_TYPE)

        when (action) {
            ACTION_STOP_ALARM -> stopAlarm()
            ACTION_STOP_CAMERA_ASSIST -> stopCameraAssist()
            ACTION_EXECUTE_COMMAND -> {
                if (!commandId.isNullOrBlank() && !commandType.isNullOrBlank()) {
                    scope.launch { handleCommand(commandId, commandType) }
                }
            }
            ACTION_SYNC_NOW -> {
                scope.launch {
                    sendTelemetrySnapshot()
                    val pending = api.fetchPendingCommands()
                    pending.forEach { handleCommand(it.id, it.commandType) }
                }
            }
        }
        return START_STICKY
    }

    private suspend fun handleCommand(commandId: String, commandType: String) {
        val result: Result<Unit> = runCatching {
            when (commandType) {
                "RING_START" -> startAlarm()
                "RING_STOP" -> stopAlarm()
                "TORCH_ON" -> setTorch(true)
                "TORCH_OFF" -> setTorch(false)
                "LOCATE_NOW" -> sendTelemetrySnapshot(forceLocation = true)
                "CAMERA_ASSIST_START" -> startCameraAssist()
                "CAMERA_ASSIST_STOP" -> stopCameraAssist()
                "SYNC_STATUS" -> sendTelemetrySnapshot()
                else -> error("Unsupported command: $commandType")
            }
        }

        if (result.isSuccess) {
            api.ackCommand(commandId, "acked")
        } else {
            api.ackCommand(commandId, "failed", result.exceptionOrNull()?.message ?: "Execution failed")
        }
        sendTelemetrySnapshot()
    }

    private fun startAlarm() {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val ringtone = RingtoneManager.getRingtone(applicationContext, uri)
            ?: error("No alarm ringtone available")

        ringtone.audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ringtone.isLooping = true
        }
        ringtone.play()
        alarmRingtone = ringtone
        alarmActive = true
        updateNotification("Recovery Alarm Active — Tap Stop to silence")
    }

    private fun stopAlarm() {
        alarmRingtone?.stop()
        alarmRingtone = null
        alarmActive = false
        updateNotification(
            if (cameraAssistActive) "Camera Assistance Active (Owner Visible)"
            else "AEGIS Connector Active"
        )
    }

    private fun setTorch(enabled: Boolean) {
        val cm = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = cm.cameraIdList.firstOrNull { id ->
            cm.getCameraCharacteristics(id)
                .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: error("Device flashlight hardware unavailable")

        cm.setTorchMode(cameraId, enabled)
        torchOn = enabled
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
        updateNotification("AEGIS Connector Active")
    }

    @SuppressLint("MissingPermission")
    private suspend fun sendTelemetrySnapshot(forceLocation: Boolean = false) {
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
            .put("camera", hasCamera)
            .put("microphone", hasMic)
            .put("notifications", hasNotif)
            .put("torch_available", packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH))

        val payload = JSONObject()
            .put("battery_level", batteryPct)
            .put("is_charging", isCharging)
            .put("network_type", getNetworkType())
            .put("permissions", permissions)
            .put("torch_on", torchOn)
            .put("alarm_active", alarmActive)
            .put("camera_assist_active", cameraAssistActive)

        if (hasFineLoc) {
            val fused = LocationServices.getFusedLocationProviderClient(this)
            val task = if (forceLocation) {
                fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            } else {
                fused.lastLocation
            }
            task.addOnSuccessListener { loc ->
                if (loc != null) {
                    payload.put("latitude", loc.latitude)
                    payload.put("longitude", loc.longitude)
                    payload.put("location_accuracy_m", loc.accuracy.toDouble())
                }
                scope.launch { api.sendHeartbeat(payload) }
            }.addOnFailureListener {
                scope.launch { api.sendHeartbeat(payload) }
            }
        } else {
            api.sendHeartbeat(payload)
        }
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
                PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Stop Alarm", stopIntent)
        }

        if (cameraAssistActive) {
            val stopCamIntent = PendingIntent.getService(
                this,
                2,
                Intent(this, AegisForegroundService::class.java).setAction(ACTION_STOP_CAMERA_ASSIST),
                PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Stop Camera Assist", stopCamIntent)
        }

        return builder.build()
    }

    override fun onDestroy() {
        stopAlarm()
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
    }
}
