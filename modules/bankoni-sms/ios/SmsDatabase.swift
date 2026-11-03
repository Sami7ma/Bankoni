import Foundation
import SQLite3

// Narrow SQLite adapter; transaction SQL is produced by the shared TS financial engine.
final class SmsDatabase {
  private var handle: OpaquePointer?
  init(url: URL, create: Bool = true) throws {
    if create { try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true) }
    guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | (create ? SQLITE_OPEN_CREATE : 0) | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      if let handle { sqlite3_close(handle) }; handle = nil
      throw SmsError.storage
    }
    sqlite3_busy_timeout(handle, 5000)
    try execute("PRAGMA foreign_keys = ON")
  }
  deinit { sqlite3_close(handle) }
  func execute(_ sql: String, _ params: [Any] = []) throws {
    _ = try rows(sql, params)
  }
  func rows(_ sql: String, _ params: [Any] = []) throws -> [[String: Any]] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw SmsError.storage }
    defer { sqlite3_finalize(statement) }
    for (index, value) in params.enumerated() {
      let position = Int32(index + 1)
      var code: Int32
      if value is NSNull { code = sqlite3_bind_null(statement, position) }
      else if let number = value as? NSNumber { code = sqlite3_bind_double(statement, position, number.doubleValue) }
      else if let string = value as? String {
        code = sqlite3_bind_text(statement, position, string, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
      } else { throw SmsError.storage }
      guard code == SQLITE_OK else { throw SmsError.storage }
    }
    var result: [[String: Any]] = []
    var code = sqlite3_step(statement)
    while code == SQLITE_ROW {
      var row: [String: Any] = [:]
      for index in 0..<sqlite3_column_count(statement) {
        let key = String(cString: sqlite3_column_name(statement,index))
        switch sqlite3_column_type(statement,index) {
        case SQLITE_INTEGER: row[key] = NSNumber(value: sqlite3_column_int64(statement,index))
        case SQLITE_FLOAT: row[key] = NSNumber(value: sqlite3_column_double(statement,index))
        case SQLITE_TEXT: row[key] = String(cString: sqlite3_column_text(statement,index))
        default: row[key] = NSNull()
        }
      }
      result.append(row)
      code = sqlite3_step(statement)
    }
    guard code == SQLITE_DONE else { throw SmsError.storage }
    return result
  }
  func transaction<T>(_ body: () throws -> T) throws -> T {
    try execute("BEGIN IMMEDIATE")
    do { let result = try body(); try execute("COMMIT"); return result }
    catch { try? execute("ROLLBACK"); throw error }
  }
}
enum SmsError: Error, LocalizedError {
  case storage, disabled, invalid, engine
  var errorDescription: String? {
    switch self {
    case .storage: return "BanKoni could not access local storage. Open BanKoni after unlocking your iPhone, then retry."
    case .disabled: return "Enable Automatic SMS Import in BanKoni Settings first."
    case .invalid: return "The input must be a completed bank or mobile-money message."
    case .engine: return "The local SMS engine could not run. Open BanKoni to recover the queued message."
    }
  }
}
