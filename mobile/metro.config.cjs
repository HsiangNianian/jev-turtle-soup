const { getDefaultConfig } = require('expo/metro-config')
const config = getDefaultConfig(__dirname)

// The existing web app has its own React patch version. Every native dependency
// must use Expo's matching React renderer, including packages hoisted by npm.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [__dirname] }) }
  }
  return context.resolveRequest(context, moduleName, platform)
}
module.exports = config
