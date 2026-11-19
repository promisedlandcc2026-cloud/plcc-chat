package org.promisedlandcc.kalink;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * #21 — keeps a Ka Link call going when the member switches apps or locks the
 * phone. Android stops background apps from using the mic unless a visible
 * "ongoing call" notification is showing; this service is that notification.
 * Tapping it brings the member back to the call.
 */
public class KaLinkCallService extends Service {
    public static final String EXTRA_TITLE = "title";
    private static final String CHANNEL_ID = "ka_link_call";
    private static final int NOTIFICATION_ID = 2121;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        if (title == null || title.trim().isEmpty()) title = "Live Ka Link";

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Ka Link calls", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows while you are in a Ka Link so the prayer keeps going in the background.");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("On Ka Link")
            .setContentText(title + " — tap to return")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
        } catch (Exception e) {
            // Mic permission not granted yet: keep the sound going at least.
            try {
                int fallback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fallback);
            } catch (Exception ignored) {
                stopSelf();
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Member swiped the app away: the call is over.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
