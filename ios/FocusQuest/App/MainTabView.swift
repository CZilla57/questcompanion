import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var router: AppRouter
    var body: some View {
        TabView(selection: $router.tab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
                .tag(AppRouter.Tab.today)

            QuestsView()
                .tabItem { Label("Quests", systemImage: "checklist") }
                .tag(AppRouter.Tab.quests)

            FocusView()
                .tabItem { Label("Focus", systemImage: "timer") }
                .tag(AppRouter.Tab.focus)

            HeroView()
                .tabItem { Label("Hero", systemImage: "figure.walk") }
                .tag(AppRouter.Tab.hero)

            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(AppRouter.Tab.more)
        }
    }
}

/// Hub for the long-tail features so the tab bar stays uncluttered.
struct MoreView: View {
    var body: some View {
        NavigationStack {
            NeonList {
                Section {
                    NavigationLink { ProgressDashboardView() } label: { Label("Progress & Insights", systemImage: "chart.line.uptrend.xyaxis") }
                    NavigationLink { BadgesView() } label: { Label("Badges", systemImage: "rosette") }
                    NavigationLink { LeaderboardView() } label: { Label("Leaderboard", systemImage: "trophy.fill") }
                }
                Section("Social") {
                    NavigationLink { AlliesView() } label: { Label("Allies", systemImage: "person.2.fill") }
                    NavigationLink { BodyDoubleView() } label: { Label("Body Double Rooms", systemImage: "person.3.sequence.fill") }
                }
                Section("Rewards") {
                    NavigationLink { RewardsView() } label: { Label("Coins & Rewards", systemImage: "creditcard.fill") }
                    NavigationLink { GearStoreView() } label: { Label("Gear Store", systemImage: "shield.lefthalf.filled") }
                    NavigationLink { WorldBossView() } label: { Label("World Boss", systemImage: "flame.fill") }
                }
                Section("Mind") {
                    NavigationLink { BrainCheckinView() } label: { Label("Brain Check-in", systemImage: "brain.head.profile") }
                    NavigationLink { ReflectionView() } label: { Label("Evening Reflection", systemImage: "moon.stars.fill") }
                }
                Section {
                    NavigationLink { SettingsView() } label: { Label("Settings", systemImage: "gearshape.fill") }
                }
            }
            .navigationTitle("More")
        }
    }
}
