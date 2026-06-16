import React, { useState } from 'react';
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Home, CheckSquare, BarChart2, Users, Trophy, Menu, X, Zap } from "lucide-react";
import { Button } from "./ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/tasks", label: "Quests", icon: CheckSquare },
    { href: "/progress", label: "Progress", icon: BarChart2 },
    { href: "/partners", label: "Allies", icon: Users },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans dark">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-2 text-primary">
          <Zap className="w-6 h-6 fill-current" />
          <span className="font-bold text-lg tracking-wider uppercase">FocusQuest</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </header>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-6 hidden md:flex items-center gap-3 text-primary mb-8">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Zap className="w-6 h-6 fill-current" />
          </div>
          <span className="font-bold text-xl tracking-wider uppercase text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">FocusQuest</span>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-8 md:mt-0">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block" onClick={() => setSidebarOpen(false)}>
                <div className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200
                  ${isActive 
                    ? "bg-primary/15 text-primary neon-glow border border-primary/30" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"}
                `}>
                  <item.icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]" : ""}`} />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden p-4 md:p-8">
        <div className="max-w-5xl mx-auto pb-20">
          {children}
        </div>
      </main>
      
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
