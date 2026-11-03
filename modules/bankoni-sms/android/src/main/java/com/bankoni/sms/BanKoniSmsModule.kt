package com.bankoni.sms

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BanKoniSmsModule: Module() {
  private fun context() = requireNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("BanKoniSms")
    AsyncFunction("status") { SmsQueue.get(context()).status() }
    AsyncFunction("setEnabled") { enabled: Boolean ->
      val context = context()
      SmsQueue.get(context).set("enabled",enabled.toString())
      if(enabled) SmsWork.recover(context) else {
        androidx.work.WorkManager.getInstance(context).cancelUniqueWork("bankoni-sms-import")
        androidx.work.WorkManager.getInstance(context).cancelUniqueWork("bankoni-sms-recovery")
      }
    }
    AsyncFunction("startScan") { reset: Boolean ->
      val context = context()
      require(SmsQueue.get(context).enabled()) { "Enable Automatic SMS Import first" }
      SmsQueue.get(context).beginScan(reset); SmsWork.schedule(context)
    }
    AsyncFunction("recover") { if(SmsQueue.get(context()).enabled()) SmsWork.recover(context()) }
    AsyncFunction("pending") { limit: Int -> SmsQueue.get(context()).pending(limit) }
    AsyncFunction("reviews") { SmsQueue.get(context()).reviews() }
    AsyncFunction("finish") { id: String, status: String, reason: String -> SmsQueue.get(context()).finish(id,status,reason) }
    AsyncFunction("retry") { SmsQueue.get(context()).retry(); SmsWork.schedule(context()) }
    AsyncFunction("enqueue") { body: String, sender: String, receivedAt: Double, source: String ->
      val inserted = SmsQueue.get(context()).enqueue(body,sender,receivedAt.toLong(),source)
      if(source != "file") SmsWork.schedule(context()); inserted
    }
  }
}
