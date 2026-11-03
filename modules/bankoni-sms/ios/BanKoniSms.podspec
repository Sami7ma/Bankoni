Pod::Spec.new do |s|
  s.name = 'BanKoniSms'
  s.version = '1.0.0'
  s.summary = 'On-device BanKoni SMS import and Shortcuts action'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'BanKoni'
  s.homepage = 'https://bankoni.local'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AppIntents', 'JavaScriptCore'
  s.libraries = 'sqlite3'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'BanKoniSmsResources' => ['Resources/sms-engine.js'] }
  s.swift_version = '5.9'
end
