package com.bankoni.sms

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.Calendar

class SmsQueue internal constructor(context: Context) : SQLiteOpenHelper(context,
  File(context.noBackupFilesDir, "bankoni-sms-queue.db").absolutePath, null, 1) {
  companion object {
    @Volatile private var instance: SmsQueue? = null
    fun get(context: Context): SmsQueue = instance ?: synchronized(this) {
      instance ?: SmsQueue(context.applicationContext).also { instance = it }
    }
  }
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY, body TEXT NOT NULL, sender TEXT NOT NULL, received INTEGER NOT NULL, source TEXT NOT NULL, created INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000), status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0)")
    db.execSQL("CREATE INDEX queue_ready ON messages(status,next_at,received)")
    db.execSQL("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  }
  override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit
  fun setting(key: String, default: String = ""): String = readableDatabase.rawQuery("SELECT value FROM settings WHERE key=?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) else default }
  fun set(key: String, value: String) { writableDatabase.execSQL("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", arrayOf(key,value)) }
  fun enabled(): Boolean = setting("enabled") == "true"
  fun enqueue(body: String, sender: String, received: Long, source: String): Boolean {
    if (!enabled() || !SmsFilter.accepts(body,sender)) return false
    val normalized = body.trim().replace(Regex("\\s+"), " ")
    val identity = "$sender|$normalized|${received / 1000}"
    val id = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    val values = ContentValues().apply {
      put("id", id); put("body", body); put("sender", sender); put("received", received); put("source", source)
    }
    val db = writableDatabase
    db.beginTransaction()
    try {
      var accepted = db.insertWithOnConflict("messages", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
      if (!accepted && source in listOf("history","file")) {
        val restored = ContentValues(values).apply {
          remove("id"); put("created",System.currentTimeMillis()); put("status","pending")
          put("reason",""); put("attempts",0); put("next_at",0)
        }
        accepted = db.update("messages",restored,"id=? AND status='skipped' AND reason=?",arrayOf(id,"Review expired after 30 days")) > 0
      }
      if (!accepted) {
        db.execSQL("INSERT OR IGNORE INTO settings(key,value) VALUES('nativeDuplicates','0')")
        db.execSQL("UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='nativeDuplicates'")
      }
      db.setTransactionSuccessful()
      return accepted
    } finally { db.endTransaction() }
  }
  fun pending(limit: Int = 40): String {
    // Claims survive process death. Retry backoff starts at five minutes and caps at one day.
    val now = System.currentTimeMillis()
    val db = writableDatabase
    db.execSQL("UPDATE messages SET status='skipped', body='', reason='Review expired after 30 days' WHERE status='review' AND created < ?", arrayOf(now - 30L*86400000))
    db.execSQL("UPDATE messages SET status='failed',reason='Processing interrupted. Automatic retry is scheduled.' WHERE status='pending' AND attempts>0 AND next_at<=?",arrayOf(now))
    val result = JSONArray()
    db.beginTransaction()
    try {
    db.rawQuery("SELECT id,body,sender,received,source,attempts FROM messages WHERE status IN ('pending','failed') AND next_at<=? ORDER BY received,id LIMIT ?", arrayOf(now.toString(), limit.coerceIn(1,100).toString())).use { c ->
      while(c.moveToNext()) result.put(JSONObject().put("id", c.getString(0)).put("body",c.getString(1)).put("sender",c.getString(2)).put("receivedAt",c.getLong(3)).put("source",c.getString(4)).put("attempts",c.getInt(5)))
    }
    for (i in 0 until result.length()) {
      val message = result.getJSONObject(i)
      val delay = (300000L * (1L shl message.getInt("attempts").coerceIn(0,9))).coerceAtMost(86400000L)
      db.execSQL("UPDATE messages SET attempts=attempts+1,next_at=? WHERE id=?", arrayOf<Any>(now+delay,message.getString("id")))
    }
    db.setTransactionSuccessful()
    } finally { db.endTransaction() }
    return result.toString()
  }
  fun finish(id: String, status: String, reason: String) {
    require(status in listOf("imported","duplicate","skipped","review","failed"))
    val db = writableDatabase
    val terminal = status in listOf("imported","duplicate","skipped")
    val next = System.currentTimeMillis()+300000
    db.execSQL("UPDATE messages SET status=?,reason=?,body=CASE WHEN ? THEN '' ELSE body END,next_at=CASE WHEN ?='failed' THEN MAX(next_at,?) ELSE ? END WHERE id=?", arrayOf<Any>(status, reason.take(600), if(terminal) 1 else 0, status, next, next, id))
  }
  fun retry() { writableDatabase.execSQL("UPDATE messages SET status='pending',attempts=0,next_at=0,reason='' WHERE status IN ('failed','review')") }
  fun reviews(): String {
    val result = JSONArray()
    readableDatabase.rawQuery("SELECT id,body,sender,received,source,status,reason FROM messages WHERE status IN ('review','failed') ORDER BY received DESC LIMIT 50", null).use { c -> while(c.moveToNext()) result.put(JSONObject().put("id",c.getString(0)).put("body",c.getString(1)).put("sender",c.getString(2)).put("receivedAt",c.getLong(3)).put("source",c.getString(4)).put("status",c.getString(5)).put("reason",c.getString(6))) }
    return result.toString()
  }
  fun hasPending(): Boolean = readableDatabase.rawQuery("SELECT 1 FROM messages WHERE status IN ('pending','failed') AND next_at<=? LIMIT 1",arrayOf(System.currentTimeMillis().toString())).use { it.moveToFirst() }
  fun beginScan(reset: Boolean) {
    if (!reset && setting("scanState") in listOf("running","complete")) return
    val end = System.currentTimeMillis()
    val start = Calendar.getInstance().apply { timeInMillis=end; add(Calendar.MONTH,-12) }.timeInMillis
    writableDatabase.beginTransaction()
    try {
      set("scanStart",start.toString()); set("scanEnd",end.toString()); set("scanDate",start.toString()); set("scanId","-1"); set("scanSeen","0"); set("scanTotal","0"); set("scanFiltered","0"); set("scanState","running"); set("scanPhase","history"); set("scanError","")
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }
  fun beginCatchUp() {
    val db = writableDatabase
    db.beginTransaction()
    try {
      if (setting("scanState") == "complete") {
        val end = System.currentTimeMillis()
        val start = Calendar.getInstance().apply { timeInMillis=end; add(Calendar.MONTH,-12) }.timeInMillis
        set("scanStart",start.toString()); set("scanEnd",end.toString())
        set("scanSeen","0"); set("scanTotal","0"); set("scanFiltered","0")
        set("scanPhase","catchup"); set("scanState","running")
      }
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  fun status(): String {
    val result = JSONObject().put("enabled",enabled())
    val counts = JSONObject()
    readableDatabase.rawQuery("SELECT status,count(*) FROM messages GROUP BY status",null).use { while(it.moveToNext()) counts.put(it.getString(0),it.getInt(1)) }
    val nativeDuplicates = setting("nativeDuplicates","0").toLongOrNull() ?: 0L
    if(nativeDuplicates>0) counts.put("duplicate",counts.optLong("duplicate")+nativeDuplicates)
    result.put("counts",counts)
    val scan = JSONObject()
    for(key in listOf("scanState","scanPhase","scanStart","scanEnd","scanSeen","scanTotal","scanFiltered","lastScan","scanError")) scan.put(key,setting(key))
    return result.put("scan",scan).toString()
  }
}
