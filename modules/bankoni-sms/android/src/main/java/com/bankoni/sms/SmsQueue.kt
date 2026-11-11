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
  File(context.noBackupFilesDir, "bankoni-sms-queue.db").absolutePath, null, 3) {
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
    upgradeSources(db)
    upgradeWalletScans(db)
  }
  override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) { if (old < 2) upgradeSources(db); if (old < 3) upgradeWalletScans(db) }
  private fun upgradeSources(db: SQLiteDatabase) {
    db.execSQL("ALTER TABLE messages ADD COLUMN sender_norm TEXT")
    db.execSQL("ALTER TABLE messages ADD COLUMN wallet_id TEXT")
    db.execSQL("ALTER TABLE messages ADD COLUMN provider_id TEXT")
    db.execSQL("ALTER TABLE messages ADD COLUMN transport_at INTEGER")
    db.execSQL("CREATE TABLE authorized_senders(sender TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, provider_id TEXT NOT NULL)")
    db.execSQL("CREATE INDEX queue_source ON messages(sender_norm,wallet_id,status,next_at)")
    // Existing unconsented queue records remain intact, but cannot join the authorization table.
    // Existing ledger transactions are in the separate application database and are untouched.
    db.execSQL("INSERT OR REPLACE INTO settings(key,value) VALUES('lifecycle','no_sources_selected')")
    db.execSQL("INSERT OR REPLACE INTO settings(key,value) VALUES('scanState','idle')")
  }
  private fun upgradeWalletScans(db: SQLiteDatabase) {
    db.execSQL("ALTER TABLE authorized_senders ADD COLUMN automatic INTEGER NOT NULL DEFAULT 1")
    db.execSQL("ALTER TABLE messages ADD COLUMN window_start INTEGER")
    db.execSQL("ALTER TABLE messages ADD COLUMN window_end INTEGER")
    db.execSQL("CREATE TABLE scan_messages(scan_id TEXT NOT NULL,message_id TEXT NOT NULL,duplicate INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scan_id,message_id))")
    db.execSQL("CREATE INDEX scan_message_lookup ON scan_messages(scan_id,message_id)")
    // Rebuild only the derived authorization index from the user's existing consent.
    // v2 indexed automatic sources only; a manual-only source must now be readable in history.
    val stored=db.rawQuery("SELECT value FROM settings WHERE key='sources'",null).use { if(it.moveToFirst())it.getString(0) else "[]" }
    val sources=try {SenderRegistry.validate(stored)} catch(_:Exception) {JSONArray()}
    db.execSQL("DELETE FROM authorized_senders")
    for(i in 0 until sources.length()) {
      val source=sources.getJSONObject(i)
      if(SenderRegistry.authorized(source))for(j in 0 until source.getJSONArray("senderIds").length()) {
        db.execSQL("INSERT INTO authorized_senders(sender,wallet_id,provider_id,automatic) VALUES(?,?,?,?)",arrayOf<Any>(SenderRegistry.normalize(source.getJSONArray("senderIds").getString(j)),source.getString("walletId"),source.getString("providerId"),if(source.optBoolean("automatic"))1 else 0))
      }
    }
    // Preserve the existing in-progress global scan and its event window.
    db.execSQL("UPDATE messages SET window_start=(SELECT value FROM settings WHERE key='scanStart'),window_end=(SELECT value FROM settings WHERE key='scanEnd') WHERE source='history'")
  }
  private val scanKeys = listOf("scanWallet","scanRun","scanState","scanPhase","scanStart","scanEnd","scanDate","scanId","scanSeen","scanTotal","scanFiltered","lastScan","scanError")
  fun saveScan() {
    val snapshot=JSONObject(); for (key in scanKeys) snapshot.put(key,setting(key))
    set("walletScan:"+setting("scanWallet"),snapshot.toString())
  }
  fun cancelScan() {
    val db=writableDatabase;db.beginTransaction()
    try {set("scanState","cancelled");set("lifecycle","cancelled");saveScan();db.setTransactionSuccessful()} finally {db.endTransaction()}
  }
  fun configureSources(json: String) {
    val sources = SenderRegistry.validate(json)
    fun bindings(rows: JSONArray, walletId: String = setting("scanWallet")): List<String> {
      val result=mutableListOf<String>()
      for(i in 0 until rows.length()) {
        val row=rows.getJSONObject(i)
        if(SenderRegistry.authorized(row) && (walletId.isBlank() || row.optString("walletId")==walletId)) {
          for(j in 0 until row.getJSONArray("senderIds").length()) result.add(SenderRegistry.normalize(row.getJSONArray("senderIds").getString(j))+"|"+row.getString("providerId")+"|"+row.getString("walletId"))
        }
      }
      return result.sorted()
    }
    val previousSources=SenderRegistry.sources(this)
    val changedScanBindings=bindings(previousSources) != bindings(sources)
    val changedWallets=mutableSetOf<String>()
    for(rows in listOf(previousSources,sources))for(i in 0 until rows.length()) {
      val wallet=rows.getJSONObject(i).optString("walletId")
      if(wallet.isNotBlank() && bindings(previousSources,wallet)!=bindings(sources,wallet))changedWallets.add(wallet)
    }
    val db = writableDatabase
    db.beginTransaction()
    try {
      if (setting("sources", "[]") != sources.toString()) {
        db.execSQL("DELETE FROM authorized_senders")
        set("sources", sources.toString())
        for (i in 0 until sources.length()) {
          val source = sources.getJSONObject(i)
          if (SenderRegistry.authorized(source)) for (j in 0 until source.getJSONArray("senderIds").length()) {
            db.execSQL("INSERT INTO authorized_senders(sender,wallet_id,provider_id,automatic) VALUES(?,?,?,?)", arrayOf(SenderRegistry.normalize(source.getJSONArray("senderIds").getString(j)),source.getString("walletId"),source.getString("providerId"),if(source.optBoolean("automatic")) 1 else 0))
          }
        }
        // The new selection needs an explicit scan; opening Settings never starts one.
        for(wallet in changedWallets) {
          val saved=setting("walletScan:"+wallet)
          if(saved.isNotBlank()) {
            val snapshot=JSONObject(saved).put("scanState","idle").put("scanDate","").put("scanId","-1")
            set("walletScan:"+wallet,snapshot.toString())
          }
        }
        if(changedScanBindings) { set("scanState","idle"); set("scanDate",""); set("scanId","-1"); saveScan() }
        set("lifecycle", if (hasSources()) "idle" else "no_sources_selected")
        db.execSQL("UPDATE messages SET next_at=0 WHERE $authorized AND status IN ('pending','failed')")
      }
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  fun hasSources(): Boolean = SenderRegistry.addresses(this).isNotEmpty()
  private val authorized = "EXISTS (SELECT 1 FROM authorized_senders a WHERE a.sender=messages.sender_norm AND a.wallet_id=messages.wallet_id AND a.provider_id=messages.provider_id)"
  private fun eligible(): String = "$authorized AND (source<>'live' OR EXISTS (SELECT 1 FROM authorized_senders a WHERE a.sender=messages.sender_norm AND a.automatic=1)) AND (source<>'history' OR ('${setting("scanState")}'<>'cancelled' AND (${if(setting("scanWallet").isBlank()) "1=1" else "wallet_id='"+setting("scanWallet").replace("'","''")+"'"})))"
  fun setting(key: String, default: String = ""): String = readableDatabase.rawQuery("SELECT value FROM settings WHERE key=?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) else default }
  fun set(key: String, value: String) { writableDatabase.execSQL("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", arrayOf(key,value)) }
  fun enabled(): Boolean = setting("enabled") == "true"
  private fun duplicateKey(sender: String, provider: String, wallet: String): String = "duplicate:" + MessageDigest.getInstance("SHA-256").digest(JSONArray(listOf(SenderRegistry.normalize(sender),provider,wallet)).toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  fun enqueue(body: String, sender: String, received: Long, source: String, transportAt: Long? = received): Boolean {
    if (!enabled()) return false
    val financialSource = SenderRegistry.find(this,sender,source == "live") ?: return false
    if ((source != "file" && (received < 946684800000L || received > System.currentTimeMillis()+300000L)) || !SmsFilter.accepts(body,sender)) return false
    val normalized = body.trim().replace(Regex("\\s+"), " ")
    val identity = "${SenderRegistry.normalize(sender)}|$normalized|${(transportAt ?: received) / 1000}"
    val id = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    val values = ContentValues().apply {
      put("id", id); put("body", body); put("sender", sender); put("received", received); put("source", source)
      put("sender_norm",SenderRegistry.normalize(sender)); put("wallet_id",financialSource.getString("walletId")); put("provider_id",financialSource.getString("providerId"))
      if (source == "history") { put("window_start",setting("scanStart").toLongOrNull()); put("window_end",setting("scanEnd").toLongOrNull()) }
      if (transportAt != null && transportAt > 0) put("transport_at",transportAt)
    }
    val db = writableDatabase
    db.beginTransaction()
    try {
      val currentSource=SenderRegistry.find(this,sender,source == "live")
      if (!enabled() || currentSource == null || currentSource.getString("walletId") != financialSource.getString("walletId") || currentSource.getString("providerId") != financialSource.getString("providerId")) return false
      var accepted = db.insertWithOnConflict("messages", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
      if (!accepted && source in listOf("history","file")) {
        val restored = ContentValues(values).apply {
          remove("id"); put("created",System.currentTimeMillis()); put("status","pending")
          put("reason",""); put("attempts",0); put("next_at",0)
        }
        accepted = db.update("messages",restored,"id=? AND status='skipped' AND reason=?",arrayOf(id,"Review expired after 30 days")) > 0
        // Only a fresh, explicitly requested historical scan may bind old pending
        // evidence to the user's newly configured account. Never move imported entries.
        if (!accepted && source == "history" && setting("scanPhase") == "history") {
          accepted = db.update("messages",restored,"id=? AND status NOT IN ('imported','duplicate') AND (wallet_id IS NULL OR wallet_id<>? OR provider_id<>?)",arrayOf(id,financialSource.getString("walletId"),financialSource.getString("providerId"))) > 0
        }
      }
      if (!accepted) {
        val key=duplicateKey(sender,financialSource.getString("providerId"),financialSource.getString("walletId"))
        set(key,((setting(key,"0").toLongOrNull() ?: 0)+1).toString())
      }
      if (source == "history" && setting("scanRun").isNotBlank()) {
        val duplicate = if (!accepted && db.rawQuery("SELECT 1 FROM messages WHERE id=? AND status IN ('imported','duplicate','skipped')",arrayOf(id)).use { it.moveToFirst() }) 1 else 0
        db.execSQL("INSERT OR IGNORE INTO scan_messages(scan_id,message_id,duplicate) VALUES(?,?,?)",arrayOf<Any>(setting("scanRun"),id,duplicate))
      }
      db.setTransactionSuccessful()
      return accepted
    } finally { db.endTransaction() }
  }
  fun pending(limit: Int = 40): String {
    if (!enabled() || !hasSources()) return "[]"
    // Claims survive process death. Retry backoff starts at five minutes and caps at one day.
    val now = System.currentTimeMillis()
    val db = writableDatabase
    db.execSQL("UPDATE messages SET status='skipped', body='', reason='Review expired after 30 days' WHERE status='review' AND created < ?", arrayOf(now - 30L*86400000))
    db.execSQL("UPDATE messages SET status='failed',reason='Processing interrupted. Automatic retry is scheduled.' WHERE status='pending' AND attempts>0 AND next_at<=?",arrayOf(now))
    val result = JSONArray()
    db.beginTransaction()
    try {
    db.rawQuery("SELECT id,body,sender,received,source,attempts,wallet_id,provider_id,transport_at,window_start,window_end FROM messages WHERE ${eligible()} AND status IN ('pending','failed') AND next_at<=? ORDER BY received,id LIMIT ?", arrayOf(now.toString(), limit.coerceIn(1,100).toString())).use { c ->
      while(c.moveToNext()) result.put(JSONObject().put("id", c.getString(0)).put("body",c.getString(1)).put("sender",c.getString(2)).put("receivedAt",c.getLong(3)).put("source",c.getString(4)).put("attempts",c.getInt(5)).put("walletId",c.getString(6)).put("providerId",c.getString(7)).put("hasTransportIdentity",!c.isNull(8)).put("windowStart",if(c.isNull(9)) null else c.getLong(9)).put("windowEnd",if(c.isNull(10)) null else c.getLong(10)))
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
  fun retryWallet(walletId: String) {
    writableDatabase.execSQL("UPDATE messages SET status='pending',attempts=0,next_at=0,reason='' WHERE $authorized AND wallet_id=? AND status='failed'",arrayOf(walletId))
  }
  fun reviews(): String {
    val result = JSONArray()
    readableDatabase.rawQuery("SELECT id,body,sender,received,source,status,reason,wallet_id,provider_id,window_start,window_end,transport_at FROM messages WHERE $authorized AND status IN ('review','failed') ORDER BY received DESC LIMIT 50", null).use { c -> while(c.moveToNext()) result.put(JSONObject().put("id",c.getString(0)).put("body",c.getString(1)).put("sender",c.getString(2)).put("receivedAt",c.getLong(3)).put("source",c.getString(4)).put("status",c.getString(5)).put("reason",c.getString(6)).put("walletId",c.getString(7)).put("providerId",c.getString(8)).put("windowStart",if(c.isNull(9)) null else c.getLong(9)).put("windowEnd",if(c.isNull(10)) null else c.getLong(10)).put("hasTransportIdentity",!c.isNull(11))) }
    return result.toString()
  }
  fun hasPending(): Boolean = enabled() && hasSources() && readableDatabase.rawQuery("SELECT 1 FROM messages WHERE ${eligible()} AND status IN ('pending','failed') AND next_at<=? LIMIT 1",arrayOf(System.currentTimeMillis().toString())).use { it.moveToFirst() }
  fun beginScan(reset: Boolean, walletId: String = "", windowStart: Long? = null, windowEnd: Long? = null) {
    val db=writableDatabase;db.beginTransaction()
    try { configureScan(reset,walletId,windowStart,windowEnd);db.setTransactionSuccessful() } finally {db.endTransaction()}
  }
  private fun configureScan(reset: Boolean, walletId: String, windowStart: Long?, windowEnd: Long?) {
    require(walletId.length <= 200 && walletId.none { it.isISOControl() })
    if (walletId != setting("scanWallet")) {
      require(setting("scanState") != "running" && !hasPendingHistory()) { "Cancel or finish the current account import before switching accounts" }
      saveScan()
      val previous=try { JSONObject(setting("walletScan:"+walletId,"{}")) } catch (_:Exception) { JSONObject() }
      for (key in scanKeys) set(key,previous.optString(key,""))
      set("scanWallet",walletId)
    }
    if (SenderRegistry.addresses(this,walletId).isEmpty()) { set("lifecycle","no_sources_selected"); return }

    if (!reset && setting("scanState") in listOf("running","complete")) return
    if (!reset && setting("scanState") in listOf("cancelled","failed") && setting("scanDate").isNotBlank()) {
      writableDatabase.execSQL("UPDATE messages SET next_at=0 WHERE $authorized AND status IN ('pending','failed')")
      set("scanState","running"); set("scanError",""); set("lifecycle","scanning"); saveScan(); return
    }
    val end = windowEnd ?: System.currentTimeMillis()
    val start = windowStart ?: Calendar.getInstance().apply { timeInMillis=end; add(Calendar.MONTH,-12) }.timeInMillis
    require(start>=946674000000L && start<=end && end<=System.currentTimeMillis()+300000L) { "Choose a valid import period ending now" }
    writableDatabase.beginTransaction()
    try {
      writableDatabase.execSQL("UPDATE messages SET window_start=?,window_end=? WHERE wallet_id=? AND source='history' AND status IN ('pending','failed') AND received>=? AND received<=?",arrayOf<Any>(start,end,walletId,start,end))
      writableDatabase.execSQL("UPDATE messages SET status='skipped',reason='Outside the newly selected import period',body='' WHERE wallet_id=? AND source='history' AND status IN ('pending','failed') AND (received<? OR received>?)",arrayOf<Any>(walletId,start,end))
      set("scanStart",start.toString()); set("scanEnd",end.toString()); set("scanDate",start.toString()); set("scanId","-1"); set("scanSeen","0"); set("scanTotal","0"); set("scanFiltered","0"); set("scanState","running"); set("scanPhase","history"); set("scanError","")
      set("scanRun",java.util.UUID.randomUUID().toString()); set("lifecycle","scanning"); saveScan()
      writableDatabase.setTransactionSuccessful()
    } finally { writableDatabase.endTransaction() }
  }
  private fun hasPendingHistory(): Boolean = readableDatabase.rawQuery("SELECT 1 FROM messages WHERE $authorized AND source='history' AND (${if(setting("scanWallet").isBlank()) "1=1" else "wallet_id='"+setting("scanWallet").replace("'","''")+"'"}) AND status IN ('pending','failed') LIMIT 1",null).use { it.moveToFirst() } && setting("scanState") != "cancelled"
  private fun catchUpCandidates(): List<JSONObject> {
    val result=mutableListOf<JSONObject>();val now=System.currentTimeMillis()
    readableDatabase.rawQuery("SELECT value FROM settings WHERE key LIKE 'walletScan:%'",null).use { c -> while(c.moveToNext()) {
      val snapshot=JSONObject(c.getString(0));val wallet=snapshot.optString("scanWallet")
      if(snapshot.optString("scanState")=="complete" && snapshot.optString("scanDate").isNotBlank()
        && (snapshot.optString("lastScan").toLongOrNull() ?: 0)<now-15L*60000
        && SenderRegistry.addresses(this,wallet,true).isNotEmpty()) result.add(snapshot)
    } }
    return result.sortedBy { it.optString("lastScan").toLongOrNull() ?: 0 }
  }
  fun hasCatchUp(): Boolean = setting("scanState") != "running" && !hasPendingHistory() && catchUpCandidates().isNotEmpty()
  fun beginCatchUp() {
    if (!hasSources()) return
    val db=writableDatabase;db.beginTransaction()
    try {
      if(setting("scanState")!="running" && !hasPendingHistory()) {
        saveScan()
        val candidate=catchUpCandidates().firstOrNull()
        if(candidate!=null) {
          for(key in scanKeys)set(key,candidate.optString(key,""))
          val end=System.currentTimeMillis()
          val previousStart=setting("scanStart").toLongOrNull()
          val isCbe=SenderRegistry.sources(this).let { rows -> (0 until rows.length()).any { rows.getJSONObject(it).optString("walletId")==setting("scanWallet") && rows.getJSONObject(it).optString("providerId")=="cbe" } }
          val start=if(isCbe && previousStart!=null) previousStart else Calendar.getInstance().apply {timeInMillis=end;add(Calendar.MONTH,-12)}.timeInMillis
          set("scanStart",start.toString());set("scanEnd",end.toString())
          set("scanPhase","catchup");set("scanState","running");saveScan()
        }
      }
      db.setTransactionSuccessful()
    } finally {db.endTransaction()}
  }
  private fun countsForRun(run: String, filtered: Long): JSONObject {
    val counts=JSONObject()
    readableDatabase.rawQuery("SELECT CASE WHEN s.duplicate=1 THEN 'duplicate' ELSE m.status END,count(*) FROM scan_messages s JOIN messages m ON m.id=s.message_id WHERE s.scan_id=? GROUP BY 1",arrayOf(run)).use { c -> while(c.moveToNext()) counts.put(c.getString(0),c.getInt(1)) }
    counts.put("skipped",counts.optLong("skipped")+filtered)
    return counts
  }
  fun wipe() {
    val db=writableDatabase;db.beginTransaction()
    try {set("enabled","false");db.execSQL("DELETE FROM scan_messages");db.execSQL("DELETE FROM messages");db.execSQL("DELETE FROM authorized_senders");db.execSQL("DELETE FROM settings");db.setTransactionSuccessful()} finally {db.endTransaction()}
  }
  fun status(): String {
    val result = JSONObject().put("enabled",enabled()).put("sources",SenderRegistry.sources(this))
      .put("lifecycle",if (!hasSources()) "no_sources_selected" else if (!enabled()) "idle" else setting("lifecycle","idle"))
    val counts = JSONObject()
    readableDatabase.rawQuery("SELECT status,count(*) FROM messages WHERE $authorized GROUP BY status",null).use { while(it.moveToNext()) counts.put(it.getString(0),it.getInt(1)) }
    var nativeDuplicates=0L
    for (sender in SenderRegistry.addresses(this)) {
      val source=SenderRegistry.find(this,sender,false) ?: continue
      nativeDuplicates+=setting(duplicateKey(sender,source.getString("providerId"),source.getString("walletId")),"0").toLongOrNull() ?: 0L
    }
    if(nativeDuplicates>0) counts.put("duplicate",counts.optLong("duplicate")+nativeDuplicates)
    result.put("counts",counts)
    val scan = JSONObject()
    for(key in scanKeys) scan.put(key,setting(key))
    val runCounts=countsForRun(setting("scanRun"),setting("scanFiltered","0").toLongOrNull() ?: 0)
    val walletScans=JSONObject();val walletCounts=JSONObject()
    readableDatabase.rawQuery("SELECT key,value FROM settings WHERE key LIKE 'walletScan:%'",null).use { c -> while(c.moveToNext()) run {
      val wallet=c.getString(0).removePrefix("walletScan:");val snapshot=JSONObject(c.getString(1))
      walletScans.put(wallet,snapshot);walletCounts.put(wallet,countsForRun(snapshot.optString("scanRun"),snapshot.optString("scanFiltered").toLongOrNull() ?: 0))
    } }
    return result.put("scan",scan).put("scanCounts",runCounts).put("walletScans",walletScans).put("walletScanCounts",walletCounts).toString()
  }
}
