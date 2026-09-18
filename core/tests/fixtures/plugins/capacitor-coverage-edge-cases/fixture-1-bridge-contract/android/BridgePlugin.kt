@CapacitorPlugin(name = "Bridge")
class BridgePlugin : Plugin() {
  @PluginMethod
  fun liveMethod(call: PluginCall) { call.resolve() }

  @PluginMethod
  fun phantomBridge(call: PluginCall) { call.resolve() }

  @PluginMethod
  fun orphanNative(call: PluginCall) { call.resolve() }
}
