package com.bankoni.sms

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.io.File

private val selectedCbe = """[{"id":"cbe","providerId":"cbe","name":"CBE","senderIds":["CBE","CBE Bank"],"selected":true,"automatic":true,"walletId":"cbe-wallet"}]"""

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[35])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SmsQueueTest {
  private lateinit var context: Context
  private lateinit var queue: SmsQueue
  private val body = "Your account has been credited with ETB 100.00. Current balance ETB 200.00. CBE"
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    File(context.noBackupFilesDir,"bankoni-sms-queue.db").delete()
    queue=SmsQueue(context); queue.set("enabled","true")
    queue.configureSources(selectedCbe)
  }
  @After fun cleanup() { queue.close() }
  @Test fun queueSurvivesDatabaseReopenAndPreventsHistoricalLiveDoubleDelivery() {
    val now=System.currentTimeMillis()
    assertTrue(queue.enqueue(body,"CBE",now,"live"))
    queue.close(); queue=SmsQueue(context)
    assertFalse(queue.enqueue(body,"CBE",now,"history"))
    assertEquals(1,JSONObject(queue.status()).getJSONObject("counts").getInt("duplicate"))
    val messages=JSONArray(queue.pending())
    assertEquals(1,messages.length())
    assertEquals(body,messages.getJSONObject(0).getString("body"))
    assertEquals(0,JSONArray(queue.pending()).length()) // leased, not handed off twice
  }
  @Test fun retryPreservesEvidenceButAcknowledgementRemovesRawText() {
    queue.enqueue(body,"CBE",System.currentTimeMillis(),"live")
    val id=JSONArray(queue.pending()).getJSONObject(0).getString("id")
    queue.finish(id,"failed","Temporary failure")
    assertEquals(body,JSONArray(queue.reviews()).getJSONObject(0).getString("body"))
    queue.retry()
    assertEquals(1,JSONArray(queue.pending()).length())
    queue.finish(id,"imported","Imported")
    queue.readableDatabase.rawQuery("SELECT body,status FROM messages WHERE id=?",arrayOf(id)).use {
      assertTrue(it.moveToFirst()); assertEquals("",it.getString(0)); assertEquals("imported",it.getString(1))
    }
  }
  @Test fun resumesScanCheckpointInsteadOfResettingIt() {
    queue.beginScan(false)
    val end=queue.setting("scanEnd")
    queue.set("scanSeen","200"); queue.set("scanDate","1234"); queue.set("scanId","987")
    queue.close(); queue=SmsQueue(context); queue.beginScan(false)
    assertEquals("200",queue.setting("scanSeen")); assertEquals("987",queue.setting("scanId")); assertEquals(end,queue.setting("scanEnd"))
    queue.beginScan(true)
    assertEquals("0",queue.setting("scanSeen")); assertEquals("-1",queue.setting("scanId"))
  }
  @Test fun oldHistoricalMessagesRetainReviewEvidenceForThirtyDaysAfterIngestion() {
    val originalTime=System.currentTimeMillis()-300L*86400000
    queue.enqueue(body,"CBE",originalTime,"history")
    val id=JSONArray(queue.pending()).getJSONObject(0).getString("id")
    queue.finish(id,"review","Confirm financial account")
    queue.pending() // maintenance must not expire a message merely because the SMS itself is old
    assertEquals(body,JSONArray(queue.reviews()).getJSONObject(0).getString("body"))
    queue.writableDatabase.execSQL("UPDATE messages SET created=? WHERE id=?",arrayOf<Any>(System.currentTimeMillis()-31L*86400000,id))
    queue.pending()
    assertEquals(0,JSONArray(queue.reviews()).length())
    assertTrue(queue.enqueue(body,"CBE",originalTime,"history"))
    assertEquals(1,JSONArray(queue.pending()).length())
  }
  @Test fun failedMessagesContinueRetryingWithBoundedDailyBackoff() {
    queue.enqueue(body,"CBE",System.currentTimeMillis(),"live")
    queue.writableDatabase.execSQL("UPDATE messages SET status='failed',attempts=12,next_at=0,created=0")
    assertEquals(1,JSONArray(queue.pending()).length())
    queue.readableDatabase.rawQuery("SELECT next_at,body FROM messages",null).use {
      assertTrue(it.moveToFirst())
      assertTrue(it.getLong(0)-System.currentTimeMillis()>23L*3600000)
      assertEquals(body,it.getString(1))
    }
  }
  @Test fun doesNotRetainOtpsPersonalMessagesOrMessagesWhenDisabled() {
    for(text in listOf("call me tomorrow","Your OTP is 123456 for ETB 100 payment","ETB 100 payment security code 123456","Your PIN: 123456 for ETB 100 payment","Password 123456 for ETB 100 transaction")) assertFalse(queue.enqueue(text,"CBE",System.currentTimeMillis(),"live"))
    queue.set("enabled","false")
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
    assertEquals(0,JSONObject(queue.status()).getJSONObject("counts").length())
  }
  @Test fun noSelectedSourcesMeansNoQueueNoScanAndNoBodyExposure() {
    queue.configureSources("[]"); queue.beginScan(false)
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
    assertEquals("no_sources_selected",JSONObject(queue.status()).getString("lifecycle"))
    assertEquals(0,JSONArray(queue.pending()).length())
    assertEquals("idle",queue.setting("scanState"))
  }
  @Test fun exactAliasesAndAccountBindingSurviveReopenAndRevocation() {
    assertFalse(queue.enqueue(body,"CBE-offer",System.currentTimeMillis(),"live"))
    assertFalse(queue.enqueue(body,"friend",System.currentTimeMillis(),"live"))
    assertTrue(queue.enqueue(body," cbe bank ",System.currentTimeMillis(),"live"))
    val message=JSONArray(queue.pending()).getJSONObject(0)
    assertEquals("cbe-wallet",message.getString("walletId"))
    queue.finish(message.getString("id"),"review","Confirm transaction")
    queue.configureSources("[]")
    assertEquals(0,JSONArray(queue.reviews()).length())
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
    queue.retry(); assertEquals(0,JSONArray(queue.pending()).length())
    queue.configureSources(selectedCbe.replace("cbe-wallet","different-wallet"))
    assertEquals(0,JSONArray(queue.pending()).length()) // old evidence cannot be silently reassigned
  }
  @Test fun selectedWithoutAnAccountCannotRetainMessages() {
    queue.configureSources(selectedCbe.replace("\"cbe-wallet\"","null"))
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
    assertFalse(queue.hasSources())
  }
  @Test fun cancellationPreservesTheCheckpointAndResumeUsesIt() {
    queue.beginScan(false); queue.set("scanDate","1234567890000"); queue.set("scanId","12")
    queue.set("scanState","cancelled"); queue.beginCatchUp()
    assertEquals("cancelled",queue.setting("scanState"))
    queue.beginScan(false)
    assertEquals("running",queue.setting("scanState")); assertEquals("12",queue.setting("scanId"))
  }
  @Test fun multipartReceptionNeverReadsUnselectedBodiesAndSharesHistoricalDeliveryIdentity() {
    val now=System.currentTimeMillis(); val sent=now-86400000
    val parts=listOf(ReceivedPart("friend",sent) { throw AssertionError("Unselected body was read") },
      ReceivedPart("CBE",sent) { body.take(24) },ReceivedPart("cbe",sent) { body.drop(24) })
    assertTrue(SmsReception.enqueue(queue,parts,now))
    assertFalse(queue.enqueue(body,"CBE",now+1500,"history",sent))
    val message=JSONArray(queue.pending()).getJSONObject(0)
    assertEquals(body,message.getString("body")); assertEquals(now,message.getLong("receivedAt"))
    assertTrue(message.getBoolean("hasTransportIdentity"))
  }
  @Test fun anExplicitHistoricalRescanCanRebindPendingEvidenceButNotAnImportedTransaction() {
    val now=System.currentTimeMillis()
    queue.enqueue(body,"CBE",now,"live")
    val old=JSONArray(queue.pending()).getJSONObject(0).getString("id")
    queue.finish(old,"review","Wrong account configuration")
    queue.configureSources(selectedCbe.replace("cbe-wallet","correct-account"))
    assertEquals(0,JSONArray(queue.reviews()).length())
    queue.beginScan(true)
    assertTrue(queue.enqueue(body,"CBE",now,"history"))
    assertEquals("correct-account",JSONArray(queue.pending()).getJSONObject(0).getString("walletId"))
    queue.finish(old,"imported","Imported")
    queue.configureSources(selectedCbe)
    queue.beginScan(true)
    assertFalse(queue.enqueue(body,"CBE",now,"history"))
    assertEquals(0,JSONArray(queue.pending()).length())
  }
  @Test fun walletAuthorizationDoesNotRequireLiveImportAndRejectsConflictingAliases() {
    queue.configureSources(selectedCbe.replace("\"automatic\":true","\"automatic\":false"))
    assertTrue(queue.hasSources())
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
    queue.beginScan(false,"cbe-wallet")
    assertTrue(queue.enqueue(body,"CBE",System.currentTimeMillis(),"history"))
    assertEquals("cbe-wallet",JSONArray(queue.pending()).getJSONObject(0).getString("walletId"))
    val conflict=JSONArray(selectedCbe).put(JSONObject(selectedCbe.drop(1).dropLast(1)).put("id","other").put("walletId","other-wallet").put("automatic",false))
    try { queue.configureSources(conflict.toString()); fail("Expected conflicting sender rejection") } catch(_:IllegalArgumentException) { }
  }
  @Test fun addingAnotherWalletPreservesTheCurrentAccountCheckpointAndAliases() {
    queue.beginScan(false,"cbe-wallet");queue.set("scanSeen","200");queue.set("scanId","199");queue.saveScan()
    val both=JSONArray(selectedCbe).put(JSONObject("""{"id":"tele","providerId":"telebirr","name":"Telebirr","senderIds":["telebirr"],"selected":true,"automatic":false,"walletId":"tele-wallet"}"""))
    queue.configureSources(both.toString())
    assertEquals("running",queue.setting("scanState"));assertEquals("200",queue.setting("scanSeen"))
    assertEquals(listOf("CBE","CBE BANK"),SenderRegistry.addresses(queue,"cbe-wallet"))
    assertEquals(listOf("TELEBIRR"),SenderRegistry.addresses(queue,"tele-wallet"))
    queue.cancelScan();queue.beginScan(false,"tele-wallet")
    assertEquals("tele-wallet",queue.setting("scanWallet"));assertEquals("0",queue.setting("scanSeen"))
    queue.cancelScan();queue.beginScan(false,"cbe-wallet")
    assertEquals("200",queue.setting("scanSeen"));assertEquals("199",queue.setting("scanId"))
  }
  @Test fun eachQueuedHistoryMessageRetainsItsOriginalWindowAndRunCounts() {
    val now=System.currentTimeMillis();queue.beginScan(false,"cbe-wallet")
    val start=queue.setting("scanStart");val end=queue.setting("scanEnd")
    assertTrue(queue.enqueue(body,"CBE",now,"history"))
    queue.set("scanStart","1");queue.set("scanEnd","2")
    val row=JSONArray(queue.pending()).getJSONObject(0)
    assertEquals(start.toLong(),row.getLong("windowStart"));assertEquals(end.toLong(),row.getLong("windowEnd"))
    queue.finish(row.getString("id"),"imported","Imported")
    assertEquals(1,JSONObject(queue.status()).getJSONObject("scanCounts").getInt("imported"))
    queue.beginScan(true,"cbe-wallet")
    assertFalse(queue.enqueue(body,"CBE",now,"history"))
    assertEquals(1,JSONObject(queue.status()).getJSONObject("scanCounts").getInt("duplicate"))
    assertFalse(JSONObject(queue.status()).getJSONObject("scanCounts").has("imported"))
  }
  @Test fun lastTwelveMonthsClampLeapDayAndNeverReadUnselectedBodies() {
    queue.configureSources(selectedCbe.replace("\"automatic\":true","\"automatic\":false"));queue.beginScan(false,"cbe-wallet")
    val end=queue.setting("scanEnd").toLong()
    val expected=java.util.Calendar.getInstance().apply {timeInMillis=end;add(java.util.Calendar.MONTH,-12)}.timeInMillis
    assertEquals(expected,queue.setting("scanStart").toLong())
    assertFalse(SmsReception.enqueue(queue,listOf(ReceivedPart("CBE",end){throw AssertionError("Live disabled: body accessed")}),end))
    assertFalse(SmsReception.enqueue(queue,listOf(ReceivedPart("friend",end){throw AssertionError("Unselected body accessed")}),end))
  }

  @Test fun incrementalRecoveryRotatesCompletedWalletsButNeverRestartsCancelledHistory() {
    val both=JSONArray(selectedCbe).put(JSONObject("""{"id":"tele","providerId":"telebirr","name":"Telebirr","senderIds":["telebirr"],"selected":true,"automatic":true,"walletId":"tele-wallet"}"""))
    queue.configureSources(both.toString());queue.beginScan(false,"cbe-wallet")
    queue.set("scanState","complete");queue.set("lastScan","0");queue.set("scanId","123");queue.saveScan()
    queue.beginScan(false,"tele-wallet");queue.cancelScan()
    queue.beginCatchUp()
    assertEquals("cbe-wallet",queue.setting("scanWallet"));assertEquals("123",queue.setting("scanId"));assertEquals("catchup",queue.setting("scanPhase"))
    val saved=JSONObject(queue.setting("walletScan:tele-wallet"));assertEquals("cancelled",saved.getString("scanState"))
    queue.set("scanState","complete");queue.set("lastScan",System.currentTimeMillis().toString());queue.saveScan()
    assertFalse(queue.hasCatchUp())
    queue.configureSources(both.toString().replace("CBE Bank","NEW CBE"))
    assertEquals("idle",JSONObject(queue.setting("walletScan:cbe-wallet")).getString("scanState"))
  }

  @Test fun upgradeFromV2PreservesExistingManualConsentWithoutEnablingLiveReception() {
    queue.close();val file=File(context.noBackupFilesDir,"bankoni-sms-queue.db");file.delete()
    android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(file,null).use { db ->
      db.execSQL("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
      db.execSQL("CREATE TABLE authorized_senders(sender TEXT PRIMARY KEY,wallet_id TEXT NOT NULL,provider_id TEXT NOT NULL)")
      db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY,body TEXT NOT NULL,sender TEXT NOT NULL,received INTEGER NOT NULL,source TEXT NOT NULL,created INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,sender_norm TEXT,wallet_id TEXT,provider_id TEXT,transport_at INTEGER)")
      db.execSQL("INSERT INTO settings VALUES('enabled','true')")
      db.execSQL("INSERT INTO settings VALUES('sources',?)",arrayOf(selectedCbe.replace("\"automatic\":true","\"automatic\":false")))
      db.version=2
    }
    queue=SmsQueue(context);queue.beginScan(false,"cbe-wallet")
    assertTrue(queue.enqueue(body,"CBE",System.currentTimeMillis(),"history"))
    assertEquals(1,JSONArray(queue.pending()).length())
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
  }

  @Test fun retryWalletDoesNotRetryAnotherAccountsFailedMessage() {
    val both=JSONArray(selectedCbe).put(JSONObject("""{"id":"tele","providerId":"telebirr","name":"Telebirr","senderIds":["telebirr"],"selected":true,"automatic":true,"walletId":"tele-wallet"}"""))
    queue.configureSources(both.toString());val now=System.currentTimeMillis()
    queue.enqueue(body,"CBE",now,"live");queue.enqueue(body,"telebirr",now,"live")
    val messages=JSONArray(queue.pending())
    for(i in 0 until messages.length())queue.finish(messages.getJSONObject(i).getString("id"),"failed","Temporary storage interruption")
    queue.retryWallet("cbe-wallet")
    val retried=JSONArray(queue.pending());assertEquals(1,retried.length());assertEquals("cbe-wallet",retried.getJSONObject(0).getString("walletId"))
    assertEquals("tele-wallet",JSONArray(queue.reviews()).getJSONObject(0).getString("walletId"))
  }

  @Test fun historicalReviewRetainsTheOriginalWindowAndDeliveryProvenance() {
    queue.beginScan(false,"cbe-wallet")
    val start=queue.setting("scanStart").toLong();val end=queue.setting("scanEnd").toLong()
    assertTrue(queue.enqueue(body,"CBE",end,"history",end-1000))
    val id=JSONArray(queue.pending()).getJSONObject(0).getString("id")
    queue.finish(id,"review","Confirm CBE financial evidence")
    val review=JSONArray(queue.reviews()).getJSONObject(0)
    assertEquals(start,review.getLong("windowStart"));assertEquals(end,review.getLong("windowEnd"))
    assertTrue(review.getBoolean("hasTransportIdentity"))
  }
  @Test fun accountRangeKeepsItsExactStartAndRejectsAFutureEnd() {
    val end=System.currentTimeMillis();val start=end-90L*86400000
    queue.beginScan(true,"cbe-wallet",start,end)
    assertEquals(start.toString(),queue.setting("scanStart"));assertEquals(end.toString(),queue.setting("scanEnd"))
    queue.cancelScan();queue.beginScan(false,"cbe-wallet",start-1000,end+1)
    assertEquals(start.toString(),queue.setting("scanStart"))
    queue.cancelScan()
    try{queue.beginScan(true,"cbe-wallet",start,end+86400000);fail("Future range must fail")}catch(_:IllegalArgumentException){}
    assertEquals(start.toString(),queue.setting("scanStart"))
  }
  @Test fun wipeClearsAllQueueEvidenceAndAuthorization() {
    queue.enqueue(body,"CBE",System.currentTimeMillis(),"live");queue.wipe()
    assertFalse(queue.enabled());assertFalse(queue.hasSources());assertEquals(0,JSONArray(queue.reviews()).length())
  }

}

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[35])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SmsHistoryTest {
  @Test fun batchesAndResumesExactlyAtTheDateAndIdCheckpoint() {
    val application = RuntimeEnvironment.getApplication() as android.app.Application
    org.robolectric.Shadows.shadowOf(application).grantPermissions(android.Manifest.permission.READ_SMS)
    val sms = android.database.sqlite.SQLiteDatabase.create(null)
    sms.execSQL("CREATE TABLE inbox(_id INTEGER PRIMARY KEY,address TEXT,body TEXT,date INTEGER,date_sent INTEGER)")
    val now=System.currentTimeMillis()
    for(index in 1..430) sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(index,"CBE","ETB 100 credited to your account. Reference SCAN$index",now-86400000,now-86400000))
    for(index in 700..900) sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(index,if(index%2==0) "friend" else "CBE-other","ETB 100 credited to your account. Reference PRIVATE$index",now-86400000,now-86400000))
    sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(500,"CBE","ETB 100 credited",now-400L*86400000,now-400L*86400000))
    sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(501,"CBE","ETB 100 credited",now+86400000,now+86400000))
    var interruptBatch = true
    val provider=object: android.content.ContentProvider() {
      override fun onCreate()=true
      override fun getType(uri: android.net.Uri): String? = null
      override fun query(uri: android.net.Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): android.database.Cursor {
        val cursor = sms.query("inbox",projection,selection,args,null,null,sort)
        return object: android.database.CursorWrapper(cursor) {
          override fun getString(column: Int): String {
            if(column==2) assertEquals("CBE",super.getString(1)) // an unselected body must never be materialized
            if(interruptBatch && column==2 && position==100) throw IllegalStateException("Interrupted batch")
            return super.getString(column)
          }
        }
      }
      override fun insert(uri: android.net.Uri,values:android.content.ContentValues?):android.net.Uri?=null
      override fun delete(uri: android.net.Uri,selection:String?,args:Array<out String>?):Int=0
      override fun update(uri:android.net.Uri,values:android.content.ContentValues?,selection:String?,args:Array<out String>?):Int=0
    }
    org.robolectric.shadows.ShadowContentResolver.registerProviderInternal("sms",provider)
    File(application.noBackupFilesDir,"bankoni-sms-queue.db").delete()
    var queue=SmsQueue(application); queue.set("enabled","true")
    queue.configureSources(JSONArray(selectedCbe).put(JSONObject("""{"id":"tele","providerId":"telebirr","name":"Telebirr","senderIds":["telebirr"],"selected":true,"automatic":true,"walletId":"tele-wallet"}""")).toString())
    sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(650,"telebirr","ETB 100 received. PRIVATE TELE",now-86400000,now-86400000))
    queue.beginScan(false,"cbe-wallet")
    try {
      try { SmsHistory.scanBatch(application,queue); fail("Expected interrupted scan") }
      catch (_: IllegalStateException) { }
      assertEquals("0",queue.setting("scanSeen")); assertEquals("-1",queue.setting("scanId"))
      assertEquals(0,JSONObject(queue.status()).getJSONObject("counts").length())
      interruptBatch = false
      SmsHistory.scanBatch(application,queue)
      assertEquals("200",queue.setting("scanSeen")); assertEquals("430",queue.setting("scanTotal")); assertEquals("running",queue.setting("scanState"))
      queue.close(); queue=SmsQueue(application); queue.beginScan(false,"cbe-wallet")
      SmsHistory.scanBatch(application,queue)
      assertEquals("400",queue.setting("scanSeen"))
      SmsHistory.scanBatch(application,queue)
      assertEquals("430",queue.setting("scanSeen")); assertEquals("complete",queue.setting("scanState"))
      assertEquals(430,JSONObject(queue.status()).getJSONObject("counts").getInt("pending"))
      // Complete the durable financial handoff before asking for incremental catch-up.
      while(true) {
        val ready=JSONArray(queue.pending(100));if(ready.length()==0)break
        for(i in 0 until ready.length())queue.finish(ready.getJSONObject(i).getString("id"),"imported","Imported")
      }
      val later = System.currentTimeMillis()-1000
      sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(600,"CBE","ETB 200 credited to your account. Reference LATER600",later,later))
      queue.set("lastScan","0");queue.saveScan();queue.beginCatchUp(); SmsHistory.scanBatch(application,queue)
      assertEquals("431",queue.setting("scanSeen")); assertEquals("431",queue.setting("scanTotal")); assertEquals("catchup",queue.setting("scanPhase"))
      assertEquals(1,JSONObject(queue.status()).getJSONObject("counts").getInt("pending"))
    } finally { queue.close(); sms.close() }
  }


}
