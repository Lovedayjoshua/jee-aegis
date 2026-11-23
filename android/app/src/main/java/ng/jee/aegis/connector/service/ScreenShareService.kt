package ng.jee.aegis.connector.service

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import androidx.core.app.NotificationCompat
import ng.jee.aegis.connector.MainActivity
import java.io.ByteArrayOutputStream

class ScreenShareService : Service() {

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(NOTIF_ID, buildNotification("Preparing JEE AEGIS Screen Share..."))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopProjection()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_DATA)
                }
                if (resultCode == Activity.RESULT_OK && data != null) {
                    startProjection(resultCode, data)
                } else {
                    stopSelf()
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun startProjection(resultCode: Int, data: Intent) {
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = mgr.getMediaProjection(resultCode, data)

        val metrics = resources.displayMetrics
        val width = (metrics.widthPixels / 2).coerceAtLeast(360)
        val height = (metrics.heightPixels / 2).coerceAtLeast(640)
        val density = metrics.densityDpi

        handlerThread = HandlerThread("AegisScreenCapture").apply { start() }
        handler = Handler(handlerThread!!.looper)

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        var lastSampleMs = 0L

        imageReader?.setOnImageAvailableListener({ reader ->
            val now = System.currentTimeMillis()
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                // Sample at most 1 frame per second to control bandwidth and AI API costs
                if (now - lastSampleMs < 1000L) return@setOnImageAvailableListener
                lastSampleMs = now

                val plane = image.planes[0]
                val buffer = plane.buffer
                val pixelStride = plane.pixelStride
                val rowStride = plane.rowStride
                val rowPadding = rowStride - pixelStride * width
                val bitmap = Bitmap.createBitmap(
                    width + rowPadding / pixelStride,
                    height,
                    Bitmap.Config.ARGB_8888
                )
                bitmap.copyPixelsFromBuffer(buffer)
                val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)
                val out = ByteArrayOutputStream()
                cropped.compress(Bitmap.CompressFormat.JPEG, 70, out)
                latestFrameJpeg = out.toByteArray()
                bitmap.recycle()
                cropped.recycle()
            } finally {
                image.close()
            }
        }, handler)

        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "JeeAegisScreenShare",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            handler
        )

        isSharing = true
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotification("Screen Sharing Active — Tap Stop to end"))
    }

    private fun stopProjection() {
        isSharing = false
        latestFrameJpeg = null
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.stop()
        mediaProjection = null
        handlerThread?.quitSafely()
        handlerThread = null
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(
                CHANNEL_ID,
                "AEGIS Screen Sharing",
                NotificationManager.IMPORTANCE_LOW
            )
            nm.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("JEE AEGIS Live Screen Share")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .addAction(0, "Stop Sharing", stopIntent)
            .build()
    }

    override fun onDestroy() {
        stopProjection()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "aegis_screen_share_channel"
        const val NOTIF_ID = 4002
        const val ACTION_START = "ng.jee.aegis.SCREEN_SHARE_START"
        const val ACTION_STOP = "ng.jee.aegis.SCREEN_SHARE_STOP"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"

        @Volatile
        var isSharing: Boolean = false

        @Volatile
        var latestFrameJpeg: ByteArray? = null
    }
}
