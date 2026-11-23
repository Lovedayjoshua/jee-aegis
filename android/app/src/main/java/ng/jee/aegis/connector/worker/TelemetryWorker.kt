package ng.jee.aegis.connector.worker

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import ng.jee.aegis.connector.data.SecureStore
import ng.jee.aegis.connector.service.AegisForegroundService

class TelemetryWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val store = SecureStore(applicationContext)
        if (!store.isRegistered()) return Result.success()

        val intent = Intent(applicationContext, AegisForegroundService::class.java).apply {
            action = AegisForegroundService.ACTION_SYNC_NOW
        }
        ContextCompat.startForegroundService(applicationContext, intent)
        return Result.success()
    }
}
