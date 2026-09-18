@objc(BridgePlugin)
public class BridgePlugin: CAPPlugin {
  @objc func liveMethod(_ call: CAPPluginCall) { call.resolve() }
  @objc func phantomBridge(_ call: CAPPluginCall) { call.resolve() }
  @objc func orphanNative(_ call: CAPPluginCall) { call.resolve() }
}
