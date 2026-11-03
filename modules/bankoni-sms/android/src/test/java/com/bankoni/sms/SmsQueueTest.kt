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
    for(text in listOf("call me tomorrow","Your OTP is 123456 for ETB 100 payment","ETB 100 payment security code 123456")) assertFalse(queue.enqueue(text,"CBE",System.currentTimeMillis(),"live"))
    queue.set("enabled","false")
    assertFalse(queue.enqueue(body,"CBE",System.currentTimeMillis(),"live"))
    assertEquals(0,JSONObject(queue.status()).getJSONObject("counts").length())
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
    var queue=SmsQueue(application); queue.set("enabled","true"); queue.beginScan(false)
    try {
      try { SmsHistory.scanBatch(application,queue); fail("Expected interrupted scan") }
      catch (_: IllegalStateException) { }
      assertEquals("0",queue.setting("scanSeen")); assertEquals("-1",queue.setting("scanId"))
      assertEquals(0,JSONObject(queue.status()).getJSONObject("counts").length())
      interruptBatch = false
      SmsHistory.scanBatch(application,queue)
      assertEquals("200",queue.setting("scanSeen")); assertEquals("430",queue.setting("scanTotal")); assertEquals("running",queue.setting("scanState"))
      queue.close(); queue=SmsQueue(application); queue.beginScan(false)
      SmsHistory.scanBatch(application,queue)
      assertEquals("400",queue.setting("scanSeen"))
      SmsHistory.scanBatch(application,queue)
      assertEquals("430",queue.setting("scanSeen")); assertEquals("complete",queue.setting("scanState"))
      assertEquals(430,JSONObject(queue.status()).getJSONObject("counts").getInt("pending"))
      val later = System.currentTimeMillis()-1000
      sms.execSQL("INSERT INTO inbox VALUES(?,?,?,?,?)",arrayOf<Any>(600,"CBE","ETB 200 credited to your account. Reference LATER600",later,later))
      queue.beginCatchUp(); SmsHistory.scanBatch(application,queue)
      assertEquals("1",queue.setting("scanSeen")); assertEquals("1",queue.setting("scanTotal")); assertEquals("catchup",queue.setting("scanPhase"))
      assertEquals(431,JSONObject(queue.status()).getJSONObject("counts").getInt("pending"))
    } finally { queue.close(); sms.close() }
  }
}
