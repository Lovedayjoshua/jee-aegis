package ng.jee.aegis.connector.service

import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import ng.jee.aegis.connector.data.AegisApiClient
import ng.jee.aegis.connector.data.SecureStore
import ng.jee.aegis.connector.worker.TelemetryWorker

class AegisMessagingService : FirebaseMessagingService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val cleanToken = token.trim()
        if (cleanToken.isEmpty()) return
        val store = SecureStore(applicationContext)
        store.fcmToken = cleanToken
        if (store.isRegistered() && store.lastSyncedFcmToken != cleanToken) {
            serviceScope.launch {
                val ok = AegisApiClient(store).refreshFcmToken(cleanToken)
                if (ok) {
                    store.lastSyncedFcmToken = cleanToken
                }
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val store = SecureStore(applicationContext)
        if (!store.isRegistered()) return

        val commandId = message.data["command_id"] ?: return
        val commandType = message.data["command_type"] ?: return
        val targetDeviceId = message.data["device_id"]
        if (!targetDeviceId.isNullOrBlank() && targetDeviceId != store.deviceId) return
        if (store.isCommandExecuted(commandId)) return

        val intent = Intent(applicationContext, AegisForegroundService::class.java).apply {
            action = AegisForegroundService.ACTION_EXECUTE_COMMAND
            putExtra(AegisForegroundService.EXTRA_COMMAND_ID, commandId)
            putExtra(AegisForegroundService.EXTRA_COMMAND_TYPE, commandType)
        }

        // Start foreground service directly when permitted (e.g. high-priority FCM data message);
        // fall back to an expedited WorkManager request if Android restricts background service start.
        val started = runCatching {
            ContextCompat.startForegroundService(applicationContext, intent)
            true
        }.getOrDefault(false)

        if (!started) {
            val input = Data.Builder()
                .putString(AegisForegroundService.EXTRA_COMMAND_ID, commandId)
                .putString(AegisForegroundService.EXTRA_COMMAND_TYPE, commandType)
                .build()

            val work = OneTimeWorkRequestBuilder<TelemetryWorker>()
                .setInputData(input)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()

            WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                "aegis_cmd_$commandId",
                ExistingWorkPolicy.KEEP,
                work
            )
        }
    }
}
