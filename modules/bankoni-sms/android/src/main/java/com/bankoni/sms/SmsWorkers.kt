package com.bankoni.sms

import android.Manifest
import android.content.Context
import android.content.ContentResolver
import android.os.Build
import android.os.Bundle
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import androidx.work.*
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object SmsWork {
  fun schedule(context: Context) {
    val manager = WorkManager.getInstance(context)
    manager.enqueueUniqueWork("bankoni-sms-import", ExistingWorkPolicy.APPEND_OR_REPLACE,
      OneTimeWorkRequestBuilder<SmsImportWorker>().setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build())
  }
  fun recover(context: Context) {
    WorkManager.getInstance(context).enqueueUniquePeriodicWork("bankoni-sms-recovery",ExistingPeriodicWorkPolicy.KEEP,
      PeriodicWorkRequestBuilder<SmsImportWorker>(15,TimeUnit.MINUTES).build())
    schedule(context)
  }
}

class SmsImportWorker(context: Context, params: WorkerParameters): Worker(context,params) {
  override fun doWork(): Result {
    val queue = SmsQueue.get(applicationContext)
    if (!queue.enabled()) return Result.success()
    return try {
      queue.beginCatchUp()
      if (queue.setting("scanState") == "running") SmsHistory.scanBatch(applicationContext,queue)
      if (queue.hasPending() && !runJavaScript()) return Result.retry()
      if (queue.setting("scanState") == "running" || queue.hasPending()) {
        // Chain a bounded unit of work; do not hold one worker for a 12-month inbox.
        SmsWork.schedule(applicationContext)
      }
      Result.success()
    } catch (e: SecurityException) {
      queue.set("scanError","SMS permission was revoked. Grant access in Settings to resume.")
      Result.success()
    } catch (e: Exception) {
      queue.set("scanError", "Background processing interrupted; will retry.")
      Result.retry()
    }
  }
  private fun runJavaScript(): Boolean {
    // WorkManager owns the process/wakelock. ReactHost starts without an Activity or service.
    val host = (applicationContext as ReactApplication).reactHost ?: return false
    val started = host.start()
    if (!started.waitForCompletion(45,TimeUnit.SECONDS) || started.isFaulted() || started.isCancelled()) return false
    val context = host.currentReactContext ?: return false
    val done = CountDownLatch(1)
    val tasks = HeadlessJsTaskContext.getInstance(context)
    var runningTaskId = -1
    val listener = object: HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(taskId: Int) = Unit
      override fun onHeadlessJsTaskFinish(taskId: Int) { if(taskId==runningTaskId) done.countDown() }
    }
    tasks.addTaskEventListener(listener)
    try {
      UiThreadUtil.runOnUiThread {
        try { runningTaskId = tasks.startTask(HeadlessJsTaskConfig("BanKoniSmsImport",Arguments.createMap(),90000,true)) }
        catch (_: Exception) { done.countDown() }
      }
      return done.await(100,TimeUnit.SECONDS) && runningTaskId != -1
    } finally { tasks.removeTaskEventListener(listener) }
  }
}

object SmsHistory {
  fun scanBatch(applicationContext: Context, queue: SmsQueue) {
    if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) throw SecurityException()
    val resolver = applicationContext.contentResolver
    val start = queue.setting("scanStart")
    val end = queue.setting("scanEnd")
    val lastDate = queue.setting("scanDate")
    val lastId = queue.setting("scanId")
    if (queue.setting("scanSeen","0") == "0") {
      resolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf("_id"),"date>=? AND date<=? AND (date>? OR (date=? AND _id>?))",arrayOf(start,end,lastDate,lastDate,lastId),null)?.use { queue.set("scanTotal",it.count.toString()) }
    }
    var count = 0
    val db = queue.writableDatabase
    db.beginTransaction()
    try {
      val selection = "date>=? AND date<=? AND (date>? OR (date=? AND _id>?))"
      val args = arrayOf(start,end,lastDate,lastDate,lastId)
      val projection = arrayOf("_id","address","body","date","date_sent")
      val cursor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        resolver.query(Telephony.Sms.Inbox.CONTENT_URI,projection,Bundle().apply {
          putString(ContentResolver.QUERY_ARG_SQL_SELECTION,selection)
          putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,args)
          putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER,"date ASC, _id ASC")
          putInt(ContentResolver.QUERY_ARG_LIMIT,200)
        },null)
      } else resolver.query(Telephony.Sms.Inbox.CONTENT_URI,projection,selection,args,"date ASC, _id ASC")
      // Providers may ignore the structured limit. CursorWindow is bounded; consume only 200 rows
      // and resume by key, without unsupported SQL LIMIT text in the ORDER BY clause.
      cursor?.use { c ->
        while(c.moveToNext() && count<200) {
          if (!queue.enabled()) break
          val body = c.getString(2) ?: ""
          val sender = c.getString(1) ?: ""
          val received = c.getLong(3)
          if (!SmsFilter.accepts(body,sender)) queue.set("scanFiltered",(queue.setting("scanFiltered","0").toLong()+1).toString())
          else queue.enqueue(body,sender,c.getLong(4).takeIf { it > 0 } ?: received,"history")
          queue.set("scanDate",received.toString()); queue.set("scanId",c.getLong(0).toString()); count++
        }
      } ?: throw IllegalStateException("SMS provider unavailable")
      queue.set("scanSeen",(queue.setting("scanSeen","0").toLong()+count).toString())
      if (count<200 && queue.enabled()) { queue.set("scanState","complete"); queue.set("lastScan",System.currentTimeMillis().toString()) }
      queue.set("scanError","")
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
}
