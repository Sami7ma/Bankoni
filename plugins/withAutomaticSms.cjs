const { withXcodeProject, withInfoPlist, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
module.exports = function withAutomaticSms(config) {
  require('../scripts/build-sms-engine.cjs')();
  // The PWA is the iPhone distribution target. Preserve native experiments behind
  // explicit opt-in for a future signed iOS build; Android behavior is unchanged.
  if (!config.extra?.enableExperimentalIosSms) return config;
  config = withInfoPlist(config, mod => {
    mod.modResults.UIBackgroundModes = [...new Set([...(mod.modResults.UIBackgroundModes || []), 'fetch'])];
    mod.modResults.BGTaskSchedulerPermittedIdentifiers = [...new Set([...(mod.modResults.BGTaskSchedulerPermittedIdentifiers || []), 'com.sami7ma.bankoni.sms-recovery'])];
    return mod;
  });
  return withXcodeProject(config, mod => {
    const projectName = mod.modRequest.projectName || IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
    const relative = `${projectName}/BanKoniAppIntents.swift`;
    const destination = path.join(mod.modRequest.platformProjectRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `import AppIntents
import BanKoniSms

@available(iOS 17.0, *)
struct BanKoniAppIntents: AppIntentsPackage {
  static var includedPackages: [any AppIntentsPackage.Type] { [BanKoniSmsIntentsPackage.self] }
}

@available(iOS 17.0, *)
struct BanKoniShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: ImportBankMessageIntent(),
      phrases: ["Import bank message with \\(.applicationName)"],
      shortTitle: "Import Bank Message", systemImageName: "text.bubble")
  }
}
`);
    mod.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: relative, groupName: projectName, project: mod.modResults });
    return mod;
  });
};
