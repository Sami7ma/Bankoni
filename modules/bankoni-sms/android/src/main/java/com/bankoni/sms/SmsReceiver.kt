package com.bankoni.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import java.util.concurrent.Executors

class SmsReceiver: BroadcastReceiver() {
  companion object { private val executor = Executors.newSingleThreadExecutor() }
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val queue = SmsQueue.get(context)
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    val result = goAsync()
    executor.execute {
      try {
        if (!queue.enabled()) return@execute
        var retained = false
        // getMessagesFromIntent returns the PDUs in multipart order. Separate senders defensively.
        parts.groupBy { it.originatingAddress ?: "" }.forEach { (sender, messages) ->
          retained = queue.enqueue(messages.joinToString("") { it.messageBody ?: "" },sender,messages.first().timestampMillis,"live") || retained
        }
        if (retained || queue.hasPending()) SmsWork.schedule(context)
      } catch (_: Exception) {
        // A later inbox catch-up can recover a broadcast that could not reach storage.
        SmsWork.schedule(context)
      } finally { result.finish() }
    }
  }
}
class RecoveryReceiver: BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (SmsQueue.get(context).enabled()) SmsWork.recover(context)
  }
}
