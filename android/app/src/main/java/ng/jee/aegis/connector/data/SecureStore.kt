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

    var apiBaseUrl: String
        get() = prefs.getString("api_base_url", BuildConfig.DEFAULT_API_BASE_URL)
            ?: BuildConfig.DEFAULT_API_BASE_URL
        set(value) = prefs.edit().putString("api_base_url", value.trimEnd('/')).apply()

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

    fun clearDevice() {
        prefs.edit()
            .remove("device_id")
            .remove("device_secret")
            .remove("user_token")
            .remove("executed_command_ids")
            .apply()
    }
}
