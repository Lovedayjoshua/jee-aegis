package ng.jee.aegis.connector.data

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class PendingCommand(
    val id: String,
    val commandType: String,
    val expiresAt: String
)

class AegisApiClient(private val store: SecureStore) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private suspend fun executeWithRetry(maxAttempts: Int = 3, block: () -> Boolean): Boolean {
        var delayMs = 600L
        for (attempt in 1..maxAttempts) {
            val ok = runCatching { block() }.getOrDefault(false)
            if (ok) return true
            if (attempt < maxAttempts) {
                delay(delayMs)
                delayMs *= 2
            }
        }
        return false
    }

    suspend fun loginAndRegisterDevice(
        baseUrl: String,
        email: String,
        password: String,
        deviceName: String
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            store.apiBaseUrl = baseUrl
            val loginBody = JSONObject()
                .put("email", email)
                .put("password", password)
                .toString()
                .toRequestBody(jsonMedia)

            val loginReq = Request.Builder()
                .url("${store.apiBaseUrl}/api/v1/auth/login")
                .post(loginBody)
                .build()

            val token = client.newCall(loginReq).execute().use { resp ->
                val raw = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("Sign-in failed (${resp.code}): $raw")
                JSONObject(raw).getString("access_token")
            }
            store.userToken = token

            val regBody = JSONObject()
                .put("device_name", deviceName)
                .put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL)
                .put("android_version", Build.VERSION.RELEASE)
                .put("app_version", "1.0.0")
                .put("fcm_token", store.fcmToken.orEmpty())
                .toString()
                .toRequestBody(jsonMedia)

            val regReq = Request.Builder()
                .url("${store.apiBaseUrl}/api/v1/devices/register")
                .addHeader("Authorization", "Bearer $token")
                .post(regBody)
                .build()

            client.newCall(regReq).execute().use { resp ->
                val raw = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("Device registration failed (${resp.code}): $raw")
                val json = JSONObject(raw)
                val deviceId = json.getString("device_id")
                store.deviceId = deviceId
                store.deviceSecret = json.getString("device_secret")
                deviceId
            }
        }
    }

    suspend fun refreshFcmToken(fcmToken: String): Boolean = withContext(Dispatchers.IO) {
        val deviceId = store.deviceId ?: return@withContext false
        val deviceSecret = store.deviceSecret ?: return@withContext false
        val body = JSONObject().put("fcm_token", fcmToken).toString().toRequestBody(jsonMedia)

        val req = Request.Builder()
            .url("${store.apiBaseUrl}/api/v1/connector/fcm-token")
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Device-Secret", deviceSecret)
            .post(body)
            .build()

        executeWithRetry(2) {
            client.newCall(req).execute().use { it.isSuccessful }
        }
    }

    suspend fun sendHeartbeat(payload: JSONObject): Boolean = withContext(Dispatchers.IO) {
        val deviceId = store.deviceId ?: return@withContext false
        val deviceSecret = store.deviceSecret ?: return@withContext false

        val req = Request.Builder()
            .url("${store.apiBaseUrl}/api/v1/connector/heartbeat")
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Device-Secret", deviceSecret)
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()

        executeWithRetry(3) {
            client.newCall(req).execute().use { it.isSuccessful }
        }
    }

    suspend fun fetchPendingCommands(): List<PendingCommand> = withContext(Dispatchers.IO) {
        val deviceId = store.deviceId ?: return@withContext emptyList()
        val deviceSecret = store.deviceSecret ?: return@withContext emptyList()

        val req = Request.Builder()
            .url("${store.apiBaseUrl}/api/v1/connector/commands/pending")
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Device-Secret", deviceSecret)
            .get()
            .build()

        runCatching {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use emptyList()
                val arr = JSONArray(resp.body?.string().orEmpty())
                buildList {
                    for (i in 0 until arr.length()) {
                        val obj = arr.getJSONObject(i)
                        add(
                            PendingCommand(
                                id = obj.getString("id"),
                                commandType = obj.getString("command_type"),
                                expiresAt = obj.getString("expires_at")
                            )
                        )
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    suspend fun ackCommand(
        commandId: String,
        status: String,
        errorMessage: String = "",
        telemetry: JSONObject? = null
    ): Boolean = withContext(Dispatchers.IO) {
        val deviceId = store.deviceId ?: return@withContext false
        val deviceSecret = store.deviceSecret ?: return@withContext false

        val bodyObj = JSONObject()
            .put("status", status)
            .put("error_message", errorMessage)
        if (telemetry != null) {
            bodyObj.put("telemetry", telemetry)
        }

        val req = Request.Builder()
            .url("${store.apiBaseUrl}/api/v1/connector/commands/$commandId/ack")
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Device-Secret", deviceSecret)
            .post(bodyObj.toString().toRequestBody(jsonMedia))
            .build()

        executeWithRetry(3) {
            client.newCall(req).execute().use { resp ->
                // 409 (already finalized) or 410 (expired) shouldn't be retried
                resp.isSuccessful || resp.code == 409 || resp.code == 410
            }
        }
    }
}
