// Bundle only local, pure TypeScript modules for JavaScriptCore; no network or Node runtime in the bundle.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
function build() {
  const root = path.resolve(__dirname, '..');
  const modules = new Map();
  function visit(filename) {
    const id = path.relative(root, filename).replaceAll('\\', '/');
    if (modules.has(id)) return id;
    modules.set(id, '');
    const transformed = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename, configFile: false, babelrc: false,
      presets: ['@babel/preset-typescript'], plugins: ['@babel/plugin-transform-modules-commonjs'],
      comments: false, compact: true,
    }).code;
    const code = transformed.replace(/require\(["']([^"']+)["']\)/g, (_, dependency) => {
      if (!dependency.startsWith('.')) throw new Error(`Non-local dependency in SMS engine: ${dependency}`);
      const base = path.resolve(path.dirname(filename), dependency);
      const file = [base + '.ts', path.join(base, 'index.ts')].find(fs.existsSync);
      if (!file) throw new Error(`Missing dependency ${dependency}`);
      return `require(${JSON.stringify(visit(file))})`;
    });
    modules.set(id, code);
    return id;
  }
  const entry = visit(path.join(root, 'sms/automatic/plan.ts'));
  const code = `(function(){'use strict';var modules={${[...modules].map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports){${code}}`).join(',')}};var cache={};function require(id){if(cache[id])return cache[id].exports;var m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}globalThis.BanKoniSmsEngine=require(${JSON.stringify(entry)});})();\n`;
  const destination = path.join(root, 'modules/bankoni-sms/ios/Resources/sms-engine.js');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== code) fs.writeFileSync(destination, code);
  return { destination, bytes: Buffer.byteLength(code), modules: modules.size };
}
module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
