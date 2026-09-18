@CapacitorPlugin(name = "Lifecycle")
class LifecyclePlugin : Plugin() {
  override fun load() {}
  override fun handleOnStart() {}
  override fun handleOnResume() {}
  override fun handleOnDestroy() {}
  @PermissionCallback
  fun permissionCallback(call: PluginCall) {}
  private fun trulyDeadHelper() {}
}
