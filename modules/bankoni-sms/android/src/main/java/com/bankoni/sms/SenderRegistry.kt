package com.bankoni.sms

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** No body is consulted to authorize a sender. Empty or invalid configuration fails closed. */
object SenderRegistry {
  fun normalize(sender: String): String = sender.trim().uppercase(Locale.ROOT)
  private val providers = setOf("cbe","cbe_birr","telebirr","dashen","boa","awash","mpesa")
  fun validate(json: String): JSONArray {
    val sources = JSONArray(json)
    require(sources.length() <= 50) { "Too many financial sources" }
    val used = mutableSetOf<String>()
    val ids = mutableSetOf<String>()
    for (i in 0 until sources.length()) {
      val source = sources.getJSONObject(i)
      require(ids.add(source.getString("id"))) { "Duplicate financial source" }
      require(source.getString("providerId") in providers) { "Unknown provider" }
      val aliases = source.getJSONArray("senderIds")
      require(aliases.length() in 1..20)
      val active = authorized(source)
      for (j in 0 until aliases.length()) {
        val address = normalize(aliases.getString(j))
        require(address.isNotEmpty() && address.length <= 64 && address.none { it.isISOControl() })
        if (active) require(used.add(address)) { "A sender must map to exactly one account" }
      }
    }
    return sources
  }
  fun active(source: JSONObject): Boolean = authorized(source) && source.optBoolean("automatic")
  fun authorized(source: JSONObject): Boolean = source.optBoolean("selected") && source.optString("walletId", "").let { it.isNotBlank() && it != "null" }
  fun sources(queue: SmsQueue): JSONArray = try { validate(queue.setting("sources", "[]")) } catch (_: Exception) { JSONArray() }
  fun find(queue: SmsQueue, sender: String, automaticOnly: Boolean = true): JSONObject? {
    val sources = sources(queue)
    for (i in 0 until sources.length()) {
      val source = sources.getJSONObject(i)
      if (!authorized(source) || (automaticOnly && !active(source))) continue
      val aliases = source.getJSONArray("senderIds")
      for (j in 0 until aliases.length()) if (normalize(aliases.getString(j)) == normalize(sender)) return source
    }
    return null
  }
  fun addresses(queue: SmsQueue, walletId: String = "", automaticOnly: Boolean = false): List<String> {
    val result = mutableListOf<String>(); val sources = sources(queue)
    for (i in 0 until sources.length()) {
      val source = sources.getJSONObject(i)
      if (authorized(source) && (!automaticOnly || active(source)) && (walletId.isBlank() || source.optString("walletId") == walletId)) for (j in 0 until source.getJSONArray("senderIds").length()) result.add(normalize(source.getJSONArray("senderIds").getString(j)))
    }
    return result.distinct()
  }
}
