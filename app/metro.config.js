// Metro config extending Expo's defaults.
//
// @supabase/supabase-js dynamically imports "@opentelemetry/api" for optional
// tracing (wrapped in a try/catch). We don't use it, and Metro resolves
// dynamic imports statically, so we stub the module to keep the bundle lean.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@opentelemetry/api") {
    return { type: "empty" };
  }
  const resolver = defaultResolveRequest ?? context.resolveRequest;
  return resolver(context, moduleName, platform);
};

module.exports = config;
