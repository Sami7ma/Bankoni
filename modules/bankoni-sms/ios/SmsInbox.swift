import Foundation
import CryptoKit

final class SmsInbox {
  static let enabledKey = "bankoni.automaticSms.enabled"
  static var enabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }
  let db: SmsDatabase
  init() throws {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("BanKoniSms", isDirectory: true)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    var excluded = base
    var resource = URLResourceValues(); resource.isExcludedFromBackup = true
    try excluded.setResourceValues(resource)
    // Keep the system's default file protection; never downgrade vault protection for automation.
    db = try SmsDatabase(url: base.appendingPathComponent("queue.sqlite"))
    try db.execute("CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, body TEXT NOT NULL, sender TEXT NOT NULL, received INTEGER NOT NULL, source TEXT NOT NULL, created INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000), status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0)")
    try db.execute("CREATE INDEX IF NOT EXISTS queue_ready ON messages(status,next_at,received)")
    try db.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value INTEGER NOT NULL)")
  }
  static func accepts(_ body: String, sender: String = "") -> Bool {
    guard !body.isEmpty, body.utf8.count <= 64000, body.count <= 16000 else { return false }
    let secret = #"\b(otp\d*|one[ -]time\s+(password|code)|verification\s+code|security\s+code|secret\s+code|authentication\s+code|pin\s+is|code\s+is)\b"#
    let money = #"\b(ETB|birr|credited|debited|withdrawn|deposited|e-money)\b|ብር"#
    let event = #"\b(received|transferred|paid|bought|payment|debit|debited|credit|credited|withdraw|withdrawn|withdrawal|deposited|deposit|purchase|sent|transaction|balance)\b"#
    let provider = #"cbe|commercial bank|telebirr|mpesa|m-pesa|safaricom|awash|dashen|abyssinia|\bboa\b"#
    let institution = #"\b(your\s+((current|available|e-money)\s+)*(account|balance)|you\s+have\s+(paid|received|transferred|withdrawn)|service\s+charge|reference)\b"#
    let institutional = (sender + " " + body).range(of: provider, options: [.regularExpression,.caseInsensitive]) != nil || body.range(of: institution,options:[.regularExpression,.caseInsensitive]) != nil
    return institutional && body.range(of: secret, options: [.regularExpression,.caseInsensitive]) == nil && body.range(of: money, options: [.regularExpression,.caseInsensitive]) != nil && body.range(of: event, options: [.regularExpression,.caseInsensitive]) != nil
  }
  @discardableResult func enqueue(body: String, sender: String, received: Double, source: String) throws -> String? {
    guard Self.enabled else { throw SmsError.disabled }
    guard Self.accepts(body,sender: sender), received.isFinite, received > 0 else { return nil }
    let normalized = body.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    let identity = "\(sender)|\(normalized)|\(Int64(received / 1000))"
    let id = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    return try db.transaction {
      try db.execute("INSERT OR IGNORE INTO messages(id,body,sender,received,source) VALUES(?,?,?,?,?)", [id,body,sender,received,source])
      var changed = (try db.rows("SELECT changes() AS count").first?["count"] as? NSNumber)?.intValue ?? 0
      if changed == 0 && source == "file" {
        try db.execute("UPDATE messages SET body=?,sender=?,received=?,source=?,created=?,status='pending',reason='',attempts=0,next_at=0 WHERE id=? AND status='skipped' AND reason='Review expired after 30 days'",[body,sender,received,source,Date().timeIntervalSince1970*1000,id])
        changed = (try db.rows("SELECT changes() AS count").first?["count"] as? NSNumber)?.intValue ?? 0
      }
      if changed == 0 {
        try db.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('nativeDuplicates',0)")
        try db.execute("UPDATE settings SET value=value+1 WHERE key='nativeDuplicates'")
      }
      return id
    }
  }
  func pending(_ limit: Int) throws -> [[String: Any]] {
    let now = Date().timeIntervalSince1970 * 1000
    return try db.transaction {
      try db.execute("UPDATE messages SET status='skipped',body='',reason='Review expired after 30 days' WHERE status='review' AND created < ?", [now - 30*86400000])
      try db.execute("UPDATE messages SET status='failed',reason='Processing interrupted. Automatic retry is scheduled.' WHERE status='pending' AND attempts>0 AND next_at<=?", [now])
      let rows = try db.rows("SELECT id,body,sender,received AS receivedAt,source,attempts FROM messages WHERE status IN ('pending','failed') AND next_at<=? ORDER BY received,id LIMIT ?", [now,min(max(limit,1),100)])
      for row in rows {
        let attempts = (row["attempts"] as? NSNumber)?.intValue ?? 0
        let delay = min(86400000.0,300000.0 * pow(2.0,Double(min(max(attempts,0),9))))
        try db.execute("UPDATE messages SET attempts=attempts+1,next_at=? WHERE id=?", [now+delay,row["id"]!])
      }
      return rows
    }
  }
  func finish(_ id: String, _ status: String, _ reason: String) throws {
    guard ["imported","duplicate","skipped","review","failed"].contains(status) else { throw SmsError.invalid }
    let terminal = ["imported","duplicate","skipped"].contains(status)
    let next = Date().timeIntervalSince1970*1000+300000
    try db.execute("UPDATE messages SET status=?,reason=?,body=CASE WHEN ? THEN '' ELSE body END,next_at=CASE WHEN ?='failed' THEN MAX(next_at,?) ELSE ? END WHERE id=?", [status,String(reason.prefix(600)),terminal ? 1 : 0,status,next,next,id])
  }
  func retry() throws { try db.execute("UPDATE messages SET status='pending',attempts=0,next_at=0,reason='' WHERE status IN ('review','failed')") }
  func reviews() throws -> [[String: Any]] {
    try db.rows("SELECT id,body,sender,received AS receivedAt,source,status,reason FROM messages WHERE status IN ('review','failed') ORDER BY received DESC LIMIT 50")
  }
  func status() throws -> [String: Any] {
    var counts: [String: Int] = [:]
    for row in try db.rows("SELECT status,count(*) AS count FROM messages GROUP BY status") { counts[row["status"] as! String] = (row["count"] as! NSNumber).intValue }
    let duplicates = (try db.rows("SELECT value FROM settings WHERE key='nativeDuplicates'").first?["value"] as? NSNumber)?.intValue ?? 0
    if duplicates > 0 { counts["duplicate",default:0] += duplicates }
    return ["enabled":Self.enabled,"counts":counts,"scan":[:]]
  }
  static func json(_ value: Any) throws -> String { String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)! }
}
