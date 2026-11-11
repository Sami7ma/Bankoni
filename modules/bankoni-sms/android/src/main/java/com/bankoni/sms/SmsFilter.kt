package com.bankoni.sms

/** Privacy prefilter before any body is retained. Parsing remains in shared TypeScript. */
object SmsFilter {
  private val secret = Regex("\\b(otp\\d*|one[ -]time\\s+(password|code)|verification\\s+code|security\\s+code|secret\\s+code|authentication\\s+code|pin\\s+is|code\\s+is)\\b", RegexOption.IGNORE_CASE)
  private val money = Regex("\\b(ETB|birr|credited|debited|withdrawn|deposited|e-money)\\b|ብር", RegexOption.IGNORE_CASE)
  private val numericSecret = Regex("\\b(pin|passcode|password|verification\\s+code|security\\s+code)\\s*((is|[:=-])\\s*)?\\d{4,8}\\b", RegexOption.IGNORE_CASE)
  private val event = Regex("\\b(received|transferred|paid|bought|payment|debit|debited|credit|credited|withdraw|withdrawn|withdrawal|deposited|deposit|purchase|sent|transaction|refund|refunded|reversal|reversed)\\b", RegexOption.IGNORE_CASE)
  private val unsuccessful = Regex("\\b(insufficient\\s+(funds|balance)|(transaction|payment|transfer|withdrawal)\\s+((has\\s+been|was|is)\\s+)?(failed|declined|rejected|pending|unsuccessful)|login\\s+(alert|attempt)|password\\s+(changed|reset)|security\\s+alert)\\b", RegexOption.IGNORE_CASE)
  private val provider = Regex("cbe|commercial bank|telebirr|mpesa|m-pesa|safaricom|awash|dashen|abyssinia|\\bboa\\b", RegexOption.IGNORE_CASE)
  private val institutional = Regex("\\b(your\\s+((current|available|e-money)\\s+)*(account|balance)|you\\s+have\\s+(paid|received|transferred|withdrawn)|service\\s+charge|reference)\\b", RegexOption.IGNORE_CASE)
  fun accepts(body: String, sender: String = ""): Boolean = body.length in 1..16000 && !secret.containsMatchIn(body) && !numericSecret.containsMatchIn(body) && !unsuccessful.containsMatchIn(body) && money.containsMatchIn(body) && event.containsMatchIn(body) && (provider.containsMatchIn(sender + " " + body) || institutional.containsMatchIn(body))
}
