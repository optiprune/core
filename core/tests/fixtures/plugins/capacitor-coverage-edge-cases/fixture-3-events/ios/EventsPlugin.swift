@objc(EventsPlugin)
public class EventsPlugin: CAPPlugin {
  func emit() {
    notifyListeners("myPluginEvent", data: [:])
    notifyListeners("legacyEvent", data: [:])
  }
}
