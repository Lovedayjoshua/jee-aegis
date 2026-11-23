package ng.jee.aegis.connector

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import kotlinx.coroutines.launch
import ng.jee.aegis.connector.data.AegisApiClient
import ng.jee.aegis.connector.data.SecureStore
import ng.jee.aegis.connector.databinding.ActivityMainBinding
import ng.jee.aegis.connector.service.AegisForegroundService
import ng.jee.aegis.connector.service.ScreenShareService
import ng.jee.aegis.connector.worker.TelemetryWorker
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var store: SecureStore
    private lateinit var api: AegisApiClient

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { refreshPermissionBadges() }

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

        binding.inputBackendUrl.setText(store.apiBaseUrl)
        binding.inputDeviceName.setText("${Build.MANUFACTURER} ${Build.MODEL}")

        binding.btnConnectDevice.setOnClickListener { registerDevice() }
        binding.btnSyncNow.setOnClickListener { triggerSync() }
        binding.btnDisconnect.setOnClickListener { disconnectDevice() }
        binding.btnStopLocalAlarm.setOnClickListener { stopLocalAlarm() }
        binding.btnToggleScreenShare.setOnClickListener { toggleScreenShare() }

        // Granular permission requests: user grants or declines each feature individually
        binding.btnPermLocation.setOnClickListener {
            permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        binding.btnPermCamera.setOnClickListener {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
        binding.btnPermMic.setOnClickListener {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
        binding.btnPermNotif.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        renderConnectionState()
        refreshPermissionBadges()
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

    private fun registerDevice() {
        val url = binding.inputBackendUrl.text.toString().trim()
        val email = binding.inputEmail.text.toString().trim()
        val password = binding.inputPassword.text.toString()
        val deviceName = binding.inputDeviceName.text.toString().trim()

        if (email.isEmpty() || password.isEmpty() || deviceName.isEmpty()) {
            Toast.makeText(this, "Enter email, password, and device name", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnConnectDevice.isEnabled = false
        lifecycleScope.launch {
            val result = api.loginAndRegisterDevice(url, email, password, deviceName)
            binding.btnConnectDevice.isEnabled = true
            result.onSuccess {
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

    private fun renderConnectionState() {
        val registered = store.isRegistered()
        binding.txtStatus.text = if (registered) {
            "Connected • Device ID: ${store.deviceId}"
        } else {
            "Not Connected • Sign in to link this Android phone"
        }
        binding.btnSyncNow.isEnabled = registered
        binding.btnDisconnect.isEnabled = registered
    }

    private fun refreshPermissionBadges() {
        fun granted(perm: String): String =
            if (ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED)
                "Granted" else "Declined"

        binding.btnPermLocation.text = "Location (${granted(Manifest.permission.ACCESS_FINE_LOCATION)})"
        binding.btnPermCamera.text = "Camera (${granted(Manifest.permission.CAMERA)})"
        binding.btnPermMic.text = "Microphone (${granted(Manifest.permission.RECORD_AUDIO)})"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            binding.btnPermNotif.text = "Notifications (${granted(Manifest.permission.POST_NOTIFICATIONS)})"
        } else {
            binding.btnPermNotif.text = "Notifications (Granted)"
        }
    }
}
