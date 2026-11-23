package ng.jee.aegis.connector.worker

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import ng.jee.aegis.connector.data.AegisApiClient
import ng.jee.aegis.connector.data.SecureStore
import ng.jee.aegis.connector.service.AegisForegroundService

class TelemetryWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val store = SecureStore(applicationContext)
        if (!store.isRegistered()) return Result.success()

        val cmdId = inputData.getString(AegisForegroundService.EXTRA_COMMAND_ID)
        val cmdType = inputData.getString(AegisForegroundService.EXTRA_COMMAND_TYPE)

        val intent = Intent(applicationContext, AegisForegroundService::class.java).apply {
            if (!cmdId.isNullOrBlank() && !cmdType.isNullOrBlank()) {
                action = AegisForegroundService.ACTION_EXECUTE_COMMAND
                putExtra(AegisForegroundService.EXTRA_COMMAND_ID, cmdId)
                putExtra(AegisForegroundService.EXTRA_COMMAND_TYPE, cmdType)
            } else {
                action = AegisForegroundService.ACTION_SYNC_NOW
            }
        }

        val started = runCatching {
            ContextCompat.startForegroundService(applicationContext, intent)
            true
        }.getOrDefault(false)

        if (!started) {
            // If Android blocked foreground service launch from background worker, at least poll pending commands
            val api = AegisApiClient(store)
            api.fetchPendingCommands()
        }
        return Result.success()
    }
}
