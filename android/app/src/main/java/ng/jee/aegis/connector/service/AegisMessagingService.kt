package ng.jee.aegis.connector.service

import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import ng.jee.aegis.connector.data.SecureStore

class AegisMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        SecureStore(applicationContext).fcmToken = token
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val commandId = message.data["command_id"] ?: return
        val commandType = message.data["command_type"] ?: return

        val intent = Intent(applicationContext, AegisForegroundService::class.java).apply {
            action = AegisForegroundService.ACTION_EXECUTE_COMMAND
            putExtra(AegisForegroundService.EXTRA_COMMAND_ID, commandId)
            putExtra(AegisForegroundService.EXTRA_COMMAND_TYPE, commandType)
        }
        ContextCompat.startForegroundService(applicationContext, intent)
    }
}
