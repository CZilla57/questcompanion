import WidgetKit
import SwiftUI

/// Entry point for the FocusQuest widget extension: the Home Screen widget, the
/// Lock Screen accessories, and the Focus session Live Activity.
@main
struct FocusQuestWidgetBundle: WidgetBundle {
    var body: some Widget {
        FocusQuestHomeWidget()
        FocusQuestAccessoryWidget()
        FocusActivityLiveActivity()
    }
}
