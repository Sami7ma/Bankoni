import BackgroundTasks
import ExpoModulesCore
import UIKit

public final class SmsRecoverySubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    BGTaskScheduler.shared.register(forTaskWithIdentifier: SmsRecovery.identifier, using: nil) { task in
      let operation = OperationQueue()
      task.expirationHandler = { operation.cancelAllOperations() }
      operation.addOperation {
        var success = false
        if SmsInbox.enabled, !operation.operations.contains(where: { $0.isCancelled }) {
          do {
            let inbox = try SmsInbox()
            try SmsEngine().process(inbox.pending(40),inbox: inbox)
            success = true
          } catch { /* Protected storage or a failed runtime is retried on foreground/next opportunity. */ }
          SmsRecovery.schedule()
        }
        task.setTaskCompleted(success: success)
      }
    }
    if SmsInbox.enabled { SmsRecovery.schedule() }
    return true
  }
}
enum SmsRecovery {
  static let identifier = "com.sami7ma.bankoni.sms-recovery"
  static func schedule() {
    guard SmsInbox.enabled else { return }
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15*60)
    try? BGTaskScheduler.shared.submit(request)
  }
}
