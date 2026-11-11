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
    if (!queue.enabled() || !queue.hasSources()) return
    val receivedAt = System.currentTimeMillis()
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    val result = goAsync()
    executor.execute {
      try {
        if (!queue.enabled()) return@execute
        // getMessagesFromIntent returns the PDUs in multipart order. Separate senders defensively.
        val retained = SmsReception.enqueue(queue,parts.map { message -> ReceivedPart(message.originatingAddress ?: "",message.timestampMillis) { message.messageBody ?: "" } },receivedAt)
        if (retained || queue.hasPending()) SmsWork.schedule(context)
      } catch (_: Exception) {
        // A later inbox catch-up can recover a broadcast that could not reach storage.
        SmsWork.schedule(context)
      } finally { result.finish() }
    }
  }
}
internal data class ReceivedPart(val sender: String, val sentAt: Long, val body: () -> String)
internal object SmsReception {
  fun enqueue(queue: SmsQueue, parts: List<ReceivedPart>, receivedAt: Long): Boolean {
    if (!queue.enabled() || !queue.hasSources()) return false
    var retained=false
    parts.groupBy { SenderRegistry.normalize(it.sender) }.forEach { (sender,messages) ->
      if (SenderRegistry.find(queue,sender) != null) {
        retained=queue.enqueue(messages.joinToString("") { it.body() },sender,receivedAt,"live",messages.first().sentAt.takeIf { it>0 }) || retained
      }
    }
    return retained
  }
}
class RecoveryReceiver: BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (SmsQueue.get(context).enabled()) SmsWork.recover(context)
  }
}
