@CapacitorPlugin(name = "Events")
class EventsPlugin : Plugin() {
  fun emit() {
    notifyListeners("myPluginEvent", JSObject())
    notifyListeners("legacyEvent", JSObject())
  }
}
