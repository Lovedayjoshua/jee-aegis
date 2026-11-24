package ng.jee.aegis.connector

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import ng.jee.aegis.connector.data.AegisApiClient
import ng.jee.aegis.connector.data.SecureStore
import ng.jee.aegis.connector.databinding.ActivityMainBinding
import ng.jee.aegis.connector.service.AegisForegroundService
import ng.jee.aegis.connector.service.ScreenShareService
import ng.jee.aegis.connector.worker.TelemetryWorker
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var store: SecureStore
    private lateinit var api: AegisApiClient
    private var lastRequestedPermission: String? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        refreshPermissionBadges()
        val perm = lastRequestedPermission
        if (!granted && perm != null) {
            handleDeniedPermission(perm)
        }
    }

    private val foregroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        refreshPermissionBadges()
        if (granted) {
            // If foreground location was just granted on Android 10+, offer background location opt-in
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundLocationPermission()) {
                showBackgroundLocationConsentDialog()
            }
        } else {
            handleDeniedPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    private val backgroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        refreshPermissionBadges()
        if (!granted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            handleDeniedPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    private val screenShareLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val intent = Intent(this, ScreenShareService::class.java).apply {
                action = ScreenShareService.ACTION_START
                putExtra(ScreenShareService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(ScreenShareService.EXTRA_DATA, result.data)
            }
            ContextCompat.startForegroundService(this, intent)
            binding.btnToggleScreenShare.text = "Stop Screen Share (Active)"
        } else {
            Toast.makeText(this, "Screen share permission declined", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        store = SecureStore(this)
        api = AegisApiClient(store)

        if (!store.userEmail.isNullOrBlank()) {
            binding.inputEmail.setText(store.userEmail)
        }
        val savedDeviceName = store.deviceName?.takeIf { it.isNotBlank() }
            ?: "${Build.MANUFACTURER} ${Build.MODEL}"
        binding.inputDeviceName.setText(savedDeviceName)

        binding.btnConnectDevice.setOnClickListener { registerDevice() }
        binding.btnSyncNow.setOnClickListener { triggerSync() }
        binding.btnDisconnect.setOnClickListener { disconnectDevice() }
        binding.btnStopLocalAlarm.setOnClickListener { stopLocalAlarm() }
        binding.btnToggleScreenShare.setOnClickListener { toggleScreenShare() }

        // Granular permission requests: user grants or declines each feature individually
        binding.btnPermLocation.setOnClickListener {
            requestForegroundLocationPermission()
        }
        binding.btnPermBgLocation.setOnClickListener {
            requestBackgroundLocationWithConsent()
        }
        binding.btnPermCamera.setOnClickListener {
            requestStandardPermission(Manifest.permission.CAMERA)
        }
        binding.btnPermMic.setOnClickListener {
            requestStandardPermission(Manifest.permission.RECORD_AUDIO)
        }
        binding.btnPermNotif.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                requestStandardPermission(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        renderConnectionState()
        refreshPermissionBadges()

        if (store.isRegistered()) {
            startConnectorService()
            scheduleTelemetryWorker()
            lifecycleScope.launch {
                ensureFcmTokenSynced()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        renderConnectionState()
        refreshPermissionBadges()
    }

    private fun requestStandardPermission(permission: String) {
        lastRequestedPermission = permission
        permissionLauncher.launch(permission)
    }

    private fun hasForegroundLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    private fun hasBackgroundLocationPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            hasForegroundLocationPermission()
        }

    private fun requestForegroundLocationPermission() {
        lastRequestedPermission = Manifest.permission.ACCESS_FINE_LOCATION
        foregroundLocationLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    private fun requestBackgroundLocationWithConsent() {
        if (!hasForegroundLocationPermission()) {
            AlertDialog.Builder(this)
                .setTitle("Foreground Location Required First")
                .setMessage(
                    "Android requires foreground location permission before background location can be enabled. Grant foreground location now?"
                )
                .setPositiveButton("Continue") { _, _ ->
                    requestForegroundLocationPermission()
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Toast.makeText(this, "Background location is already included on this Android version.", Toast.LENGTH_SHORT).show()
            return
        }

        if (hasBackgroundLocationPermission()) {
            Toast.makeText(this, "Background location is already granted.", Toast.LENGTH_SHORT).show()
            return
        }

        showBackgroundLocationConsentDialog()
    }

    private fun showBackgroundLocationConsentDialog() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        AlertDialog.Builder(this)
            .setTitle("Background Location for Device Recovery")
            .setMessage(
                "To locate your phone from the JEE AEGIS dashboard when the app is closed or the screen is locked, select 'Allow all the time' on the next Android settings screen.\n\nJEE AEGIS only reports location during heartbeats or when you trigger Locate Now."
            )
            .setPositiveButton("Continue to Settings") { _, _ ->
                lastRequestedPermission = Manifest.permission.ACCESS_BACKGROUND_LOCATION
                backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
            .setNegativeButton("Not Now", null)
            .show()
    }

    private fun handleDeniedPermission(permission: String) {
        val permanentlyDenied = !ActivityCompat.shouldShowRequestPermissionRationale(this, permission)
        if (permanentlyDenied) {
            AlertDialog.Builder(this)
                .setTitle("Permission Blocked in Settings")
                .setMessage(
                    "This permission is currently disabled in Android Settings. You can enable it manually in App Settings whenever you want to use this feature."
                )
                .setPositiveButton("Open App Settings") { _, _ ->
                    openAppSystemSettings()
                }
                .setNegativeButton("Dismiss", null)
                .show()
        } else {
            Toast.makeText(this, "Permission declined. Feature will remain disabled.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openAppSystemSettings() {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null)
        )
        runCatching { startActivity(intent) }
    }

    private suspend fun fetchFcmTokenSafely(): String? {
        val fetched = withTimeoutOrNull(4_000L) {
            suspendCancellableCoroutine<String?> { cont ->
                runCatching {
                    FirebaseMessaging.getInstance().token
                        .addOnSuccessListener { token ->
                            if (cont.isActive) cont.resume(token?.trim()?.takeIf { it.isNotEmpty() })
                        }
                        .addOnFailureListener {
                            if (cont.isActive) cont.resume(null)
                        }
                }.onFailure {
                    if (cont.isActive) cont.resume(null)
                }
            }
        }
        if (!fetched.isNullOrBlank()) {
            store.fcmToken = fetched
            return fetched
        }
        return store.fcmToken?.takeIf { it.isNotBlank() }
    }

    private suspend fun ensureFcmTokenSynced() {
        if (!store.isRegistered()) return
        val token = fetchFcmTokenSafely() ?: return
        if (store.lastSyncedFcmToken == token) return
        val synced = api.refreshFcmToken(token)
        if (synced) {
            store.lastSyncedFcmToken = token
        }
    }

    private fun registerDevice() {
        val email = binding.inputEmail.text.toString().trim()
        val password = binding.inputPassword.text.toString()
        val deviceName = binding.inputDeviceName.text.toString().trim()

        if (email.isEmpty() || password.isEmpty() || deviceName.isEmpty()) {
            Toast.makeText(this, "Enter email, password, and device name", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnConnectDevice.isEnabled = false
        lifecycleScope.launch {
            // Explicitly request FCM token before completing device registration
            val fcmToken = fetchFcmTokenSafely()
            val result = api.loginAndRegisterDevice(email, password, deviceName)
            binding.btnConnectDevice.isEnabled = true
            result.onSuccess {
                if (!fcmToken.isNullOrBlank()) {
                    val synced = api.refreshFcmToken(fcmToken)
                    if (synced) {
                        store.lastSyncedFcmToken = fcmToken
                    }
                }
                startConnectorService()
                scheduleTelemetryWorker()
                renderConnectionState()
                Toast.makeText(this@MainActivity, "Device connected to JEE AEGIS", Toast.LENGTH_SHORT).show()
            }.onFailure { err ->
                Toast.makeText(this@MainActivity, err.message, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun triggerSync() {
        val intent = Intent(this, AegisForegroundService::class.java).apply {
            action = AegisForegroundService.ACTION_SYNC_NOW
        }
        ContextCompat.startForegroundService(this, intent)
        Toast.makeText(this, "Syncing status & commands...", Toast.LENGTH_SHORT).show()
    }

    private fun stopLocalAlarm() {
        val intent = Intent(this, AegisForegroundService::class.java).apply {
            action = AegisForegroundService.ACTION_STOP_ALARM
        }
        runCatching { startService(intent) }
        Toast.makeText(this, "Alarm stopped", Toast.LENGTH_SHORT).show()
    }

    private fun disconnectDevice() {
        stopService(Intent(this, AegisForegroundService::class.java))
        WorkManager.getInstance(this).cancelUniqueWork("aegis_telemetry_sync")
        store.clearDevice()
        renderConnectionState()
    }

    private fun startConnectorService() {
        val intent = Intent(this, AegisForegroundService::class.java).apply {
            action = AegisForegroundService.ACTION_SYNC_NOW
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun scheduleTelemetryWorker() {
        val work = PeriodicWorkRequestBuilder<TelemetryWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "aegis_telemetry_sync",
            ExistingPeriodicWorkPolicy.UPDATE,
            work
        )
    }

    private fun toggleScreenShare() {
        if (ScreenShareService.isSharing) {
            val stopIntent = Intent(this, ScreenShareService::class.java).apply {
                action = ScreenShareService.ACTION_STOP
            }
            startService(stopIntent)
            binding.btnToggleScreenShare.text = "Start Screen Share (MediaProjection)"
        } else {
            val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            screenShareLauncher.launch(mgr.createScreenCaptureIntent())
        }
    }

    private fun renderConnectionState() {
        val registered = store.isRegistered()
        val expiredReason = store.sessionExpiredReason
        binding.txtStatus.text = when {
            registered -> "Connected • Device ID: ${store.deviceId}"
            !expiredReason.isNullOrBlank() -> "Session Expired • $expiredReason"
            else -> "Not Connected • Sign in to link this Android phone"
        }
        binding.btnSyncNow.isEnabled = registered
        binding.btnDisconnect.isEnabled = registered
    }

    private fun refreshPermissionBadges() {
        fun granted(perm: String): String =
            if (ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED)
                "Granted" else "Declined"

        binding.btnPermLocation.text =
            "Foreground Location (${granted(Manifest.permission.ACCESS_FINE_LOCATION)})"
        binding.btnPermBgLocation.text =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                "Background Location (${granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)})"
            } else {
                "Background Location (Included)"
            }
        binding.btnPermCamera.text = "Camera (${granted(Manifest.permission.CAMERA)})"
        binding.btnPermMic.text = "Microphone (${granted(Manifest.permission.RECORD_AUDIO)})"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            binding.btnPermNotif.text =
                "Notifications (${granted(Manifest.permission.POST_NOTIFICATIONS)})"
        } else {
            binding.btnPermNotif.text = "Notifications (Granted)"
        }
    }
}
