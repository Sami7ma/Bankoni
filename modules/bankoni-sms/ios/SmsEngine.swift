import Foundation
import JavaScriptCore

private final class ResourceMarker: NSObject {}

/// The App Intent never guesses at financial fields. It runs the very same TS plan and SQL commands as Android.
final class SmsEngine {
  private let engine: JSValue
  private let context: JSContext
  init() throws {
    guard let context = JSContext(),
      let resources = Bundle(for: ResourceMarker.self).url(forResource: "BanKoniSmsResources", withExtension: "bundle"),
      let bundle = Bundle(url: resources), let url = bundle.url(forResource: "sms-engine", withExtension: "js") else { throw SmsError.engine }
    self.context = context
    context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
    guard context.exception == nil, let engine = context.objectForKeyedSubscript("BanKoniSmsEngine"), !engine.isUndefined else { throw SmsError.engine }
    self.engine = engine
  }
  func process(_ messages: [[String: Any]], inbox: SmsInbox) throws {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("SQLite/bankoni.db")
    let vault = try SmsDatabase(url: url, create: false)
    let profileCount = try vault.rows("SELECT COUNT(*) AS count FROM users").first?["count"] as? NSNumber
    guard profileCount?.intValue == 1 else { throw SmsError.storage }
    // The app initializes/migrates the vault before the user can enable this action.
    let importContext: [String: Any] = [
      "wallets": try vault.rows("SELECT id,name,icon,provider_id AS providerId,currency,account_number_last4 AS accountNumberLast4,is_archived AS isArchived FROM wallets"),
      "categories": try vault.rows("SELECT id,name,flow FROM categories"),
      "knownAccounts": try vault.rows("SELECT id,wallet_id AS walletId,provider_id AS providerId,account_number AS accountNumber,account_last4 AS accountLast4,ownership FROM known_accounts"),
      "merchants": try vault.rows("SELECT id,name,normalized_name AS normalizedName,merchant_type AS merchantType,default_category_id AS defaultCategoryId FROM merchants"),
      "merchantRules": try vault.rows("SELECT id,merchant_id AS merchantId,pattern,category_id AS categoryId,auto_apply AS autoApply FROM merchant_rules"),
      "educationInstitutions": try vault.rows("SELECT id,name,normalized_name AS normalizedName,preferred_frequency AS preferredFrequency,preferred_fee_type AS preferredFeeType FROM education_institutions")
    ]
    for message in messages {
      if !SmsInbox.enabled { return }
      let id = message["id"] as! String
      do {
        if !(try vault.rows("SELECT message_key FROM sms_import_receipts WHERE message_key=?",[id])).isEmpty {
          try inbox.finish(id,"duplicate","Transaction is already in the ledger")
          continue
        }
        context.exception = nil
        guard let plan = engine.invokeMethod("buildImportPlan", withArguments: [message,importContext]), context.exception == nil,
          let status = plan.forProperty("status")?.toString(), let reason = plan.forProperty("reason")?.toString() else { throw SmsError.engine }
        if status != "imported" { try inbox.finish(id,status,reason); continue }
        let outcome = try vault.transaction { () throws -> String in
          if !(try vault.rows("SELECT message_key FROM sms_import_receipts WHERE message_key=?",[id])).isEmpty { return "duplicate" }
          guard let query = engine.invokeMethod("duplicateQuery", withArguments: [plan])?.toDictionary() as? [String: Any],
            let sql = query["sql"] as? String, let params = query["params"] as? [Any] else { throw SmsError.engine }
          if let existing = try vault.rows(sql,params).first {
            try vault.execute("INSERT INTO sms_import_receipts(message_key,transaction_id,created_at) VALUES(?,?,?)",[id,existing["id"]!,ISO8601DateFormatter().string(from: Date())])
            return "duplicate"
          }
          guard let commands = plan.forProperty("commands")?.toArray() as? [[String: Any]] else { throw SmsError.engine }
          for command in commands {
            guard let sql = command["sql"] as? String, let params = command["params"] as? [Any] else { throw SmsError.engine }
            try vault.execute(sql,params)
          }
          return "imported"
        }
        try inbox.finish(id,outcome,reason)
      } catch {
        try inbox.finish(id,"failed","Processing interrupted. Open BanKoni to retry safely.")
      }
    }
  }
}
