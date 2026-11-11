package com.bankoni.sms

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BanKoniSmsModule: Module() {
  private fun context() = requireNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("BanKoniSms")
    AsyncFunction("status") { SmsQueue.get(context()).status() }
    AsyncFunction("configureSources") { json: String -> SmsQueue.get(context()).configureSources(json) }
    AsyncFunction("cancelScan") {
      SmsQueue.get(context()).apply { cancelScan() }
    }
    AsyncFunction("setPhase") { phase: String ->
      require(phase in listOf("idle","permission_required","no_sources_selected","scanning","parsing","importing","completed","cancelled","failed"))
      val queue = SmsQueue.get(context())
      if (queue.setting("scanState") != "cancelled") queue.set("lifecycle",phase)
    }
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
      val queue=SmsQueue.get(context);queue.beginScan(reset,queue.setting("scanWallet")); SmsWork.schedule(context)
    }
    AsyncFunction("startWalletScan") { walletId: String, reset: Boolean ->
      val context=context(); val queue=SmsQueue.get(context)
      queue.beginScan(reset,walletId); queue.set("enabled","true"); SmsWork.recover(context)
    }
    AsyncFunction("startWalletScanRange") { walletId: String, start: Double, end: Double, reset: Boolean ->
      val context=context();val queue=SmsQueue.get(context)
      queue.beginScan(reset,walletId,start.toLong(),end.toLong());queue.set("enabled","true");SmsWork.recover(context)
    }
    AsyncFunction("wipeLocalImportData") {
      val context=context()
      androidx.work.WorkManager.getInstance(context).cancelUniqueWork("bankoni-sms-import")
      androidx.work.WorkManager.getInstance(context).cancelUniqueWork("bankoni-sms-recovery")
      SmsQueue.get(context).wipe()
    }
    AsyncFunction("retryWallet") { walletId: String ->
      SmsQueue.get(context()).retryWallet(walletId);SmsWork.schedule(context())
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
