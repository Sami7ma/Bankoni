import ExpoModulesCore
import Foundation
import BackgroundTasks

public final class BanKoniSmsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BanKoniSms")
    AsyncFunction("status") { () throws -> String in try SmsInbox.json(SmsInbox().status()) }
    AsyncFunction("setEnabled") { (enabled: Bool) in
      UserDefaults.standard.set(enabled,forKey: SmsInbox.enabledKey)
      if enabled { SmsRecovery.schedule() }
      else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: SmsRecovery.identifier) }
    }
    AsyncFunction("startScan") { (_: Bool) throws in throw SmsError.invalid }
    AsyncFunction("recover") { SmsRecovery.schedule() }
    AsyncFunction("pending") { (limit: Int) throws -> String in try SmsInbox.json(SmsInbox().pending(limit)) }
    AsyncFunction("reviews") { () throws -> String in try SmsInbox.json(SmsInbox().reviews()) }
    AsyncFunction("finish") { (id: String, status: String, reason: String) throws in try SmsInbox().finish(id,status,reason) }
    AsyncFunction("retry") { () throws in try SmsInbox().retry() }
    AsyncFunction("enqueue") { (body: String, sender: String, receivedAt: Double, source: String) throws -> Bool in
      try SmsInbox().enqueue(body: body,sender: sender,received: receivedAt,source: source) != nil
    }
  }
}
