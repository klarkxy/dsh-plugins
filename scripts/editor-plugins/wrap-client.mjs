import fs from 'node:fs'
import path from 'node:path'

const requestedPackage = process.argv[2]
if (!requestedPackage) {
  console.error('usage: wrap-client.mjs <package-name>')
  process.exit(1)
}
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).name
if (typeof pkg !== 'string' || (requestedPackage !== pkg && requestedPackage !== pkg.split('/').at(-1))) {
  throw new Error('wrap-client package argument does not match the working directory manifest')
}
const inner = path.resolve('lib/client.inner.cjs')
const alt = path.resolve('lib/client.inner.js')
const srcPath = fs.existsSync(inner) ? inner : alt
if (!fs.existsSync(srcPath)) {
  console.error(`missing ${srcPath}`)
  process.exit(1)
}
const body = fs.readFileSync(srcPath, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg)},
  factory: (dshRequire) => {
    var require = dshRequire;
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
fs.writeFileSync(path.resolve('lib/client.js'), wrapped)
console.log('wrapped', pkg, '-> lib/client.js')
