package ng.jee.aegis.connector.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import ng.jee.aegis.connector.BuildConfig

class SecureStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "jee_aegis_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    init {
        // Purge any legacy user-editable api_base_url setting so it can never override production config
        if (prefs.contains("api_base_url")) {
            prefs.edit().remove("api_base_url").apply()
        }
    }

    val apiBaseUrl: String
        get() = BuildConfig.DEFAULT_API_BASE_URL.trimEnd('/')

    var sessionExpiredReason: String?
        get() = prefs.getString("session_expired_reason", null)
        set(value) = prefs.edit().putString("session_expired_reason", value).apply()

    var userEmail: String?
        get() = prefs.getString("user_email", null)
        set(value) = prefs.edit().putString("user_email", value).apply()

    var deviceName: String?
        get() = prefs.getString("device_name", null)
        set(value) = prefs.edit().putString("device_name", value).apply()

    var userToken: String?
        get() = prefs.getString("user_token", null)
        set(value) = prefs.edit().putString("user_token", value).apply()

    var deviceId: String?
        get() = prefs.getString("device_id", null)
        set(value) = prefs.edit().putString("device_id", value).apply()

    var deviceSecret: String?
        get() = prefs.getString("device_secret", null)
        set(value) = prefs.edit().putString("device_secret", value).apply()

    var fcmToken: String?
        get() = prefs.getString("fcm_token", null)
        set(value) = prefs.edit().putString("fcm_token", value).apply()

    var lastSyncedFcmToken: String?
        get() = prefs.getString("last_synced_fcm_token", null)
        set(value) = prefs.edit().putString("last_synced_fcm_token", value).apply()

    fun isRegistered(): Boolean = !deviceId.isNullOrBlank() && !deviceSecret.isNullOrBlank()

    @Synchronized
    fun isCommandExecuted(commandId: String): Boolean {
        val recent = prefs.getString("executed_command_ids", "").orEmpty()
            .split(",")
            .filter { it.isNotBlank() }
        return commandId in recent
    }

    @Synchronized
    fun markCommandExecuted(commandId: String) {
        val recent = prefs.getString("executed_command_ids", "").orEmpty()
            .split(",")
            .filter { it.isNotBlank() && it != commandId }
            .takeLast(49) + commandId
        prefs.edit().putString("executed_command_ids", recent.joinToString(",")).apply()
    }

    @Synchronized
    fun markSessionExpired(reason: String) {
        prefs.edit()
            .remove("device_secret")
            .remove("user_token")
            .putString("session_expired_reason", reason)
            .apply()
    }

    fun clearDevice() {
        // Keep device_id, user_email, and device_name so re-signing in on this phone
        // re-links the existing device record and its command/telemetry history.
        prefs.edit()
            .remove("device_secret")
            .remove("user_token")
            .remove("last_synced_fcm_token")
            .remove("executed_command_ids")
            .remove("session_expired_reason")
            .apply()
    }
}
