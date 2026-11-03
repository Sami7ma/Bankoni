import AppIntents
import Foundation

@available(iOS 17.0, *)
public struct BanKoniSmsIntentsPackage: AppIntentsPackage {}

@available(iOS 17.0, *)
public struct ImportBankMessageIntent: AppIntent {
  public static var title: LocalizedStringResource = "Import Bank Message"
  public static var description = IntentDescription("Import a bank or mobile-money message into your BanKoni vault on this iPhone. Enable Automatic SMS Import first.")
  public static var openAppWhenRun = false
  // Explicit opt-in authorizes only append-only SMS ingestion, never viewing/unlocking the vault.
  public static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  @Parameter(title: "Message") public var message: String
  @Parameter(title: "Sender", default: "") public var sender: String
  @Parameter(title: "Received At") public var receivedAt: Date?
  public init() {}
  public func perform() async throws -> some IntentResult & ReturnsValue<String> {
    guard SmsInbox.enabled else { throw SmsError.disabled }
    let inbox = try SmsInbox()
    guard let id = try inbox.enqueue(body: message,sender: sender,received: (receivedAt ?? Date()).timeIntervalSince1970*1000,source: "shortcut") else {
      return .result(value: "Skipped: not a completed financial message")
    }
    SmsRecovery.schedule()
    let messages = try inbox.pending(40)
    do { try SmsEngine().process(messages,inbox: inbox) }
    catch { try inbox.finish(id,"failed","Saved safely. Open BanKoni to finish importing on this iPhone.") }
    // Return only status, never account information or balances to Shortcuts/Siri.
    let rows = try inbox.db.rows("SELECT status FROM messages WHERE id=?",[id])
    return .result(value: rows.first?["status"] as? String ?? "pending")
  }
}
