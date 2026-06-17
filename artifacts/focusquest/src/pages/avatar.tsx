import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAvatar,
  useUpdateAvatar,
  useGetGearStore,
  useBuyGear,
  useEquipGear,
  useUnequipGear,
  useGetBattleCurrent,
  useEnterBattle,
  getGetAvatarQueryKey,
  getGetGearStoreQueryKey,
  getGetBattleCurrentQueryKey,
} from "@workspace/api-client-react";
import type { GearStoreItem } from "@workspace/api-client-react";
import { AvatarRenderer, SKIN_PALETTES, type AvatarClass, type AvatarSkin, type EquippedSlot } from "@/components/avatar-renderer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Sword, HardHat, ShieldHalf, Shield, Footprints, Gem, Crown,
  Zap, Swords, Skull, Trophy, Lock, Check, ShoppingBag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Sword, HardHat, ShieldHalf, Shield, Footprints, Gem, Crown,
};

const RARITY_COLORS: Record<string, string> = {
  common:    "#9ca3af",
  rare:      "#3b82f6",
  epic:      "#a855f7",
  legendary: "#f59e0b",
};

const RARITY_LABELS: Record<string, string> = {
  common:    "Common",
  rare:      "Rare",
  epic:      "Epic",
  legendary: "Legendary",
};

const SLOT_LABELS: Record<string, string> = {
  weapon:    "Weapon",
  helmet:    "Helmet",
  armor:     "Armor",
  boots:     "Boots",
  accessory: "Accessory",
};

const CLASS_INFO: Record<string, { label: string; color: string }> = {
  fighter: { label: "Fighter", color: "#ef4444" },
  mage:    { label: "Mage",    color: "#8b5cf6" },
  ranger:  { label: "Ranger",  color: "#22c55e" },
  healer:  { label: "Healer",  color: "#f59e0b" },
};

const AVATAR_COLORS = [
  "#00FFFF", "#A855F7", "#F97316", "#22C55E",
  "#EC4899", "#EAB308", "#6366F1", "#F43F5E",
];

const SLOT_ORDER = ["weapon", "helmet", "armor", "boots", "accessory"] as const;
type SlotFilter = "all" | typeof SLOT_ORDER[number];

function GearIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Comp = ICON_MAP[name] ?? Gem;
  return <Comp style={{ width: size, height: size }} />;
}

function RarityBadge({ rarity }: { rarity: string }) {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color: RARITY_COLORS[rarity], backgroundColor: RARITY_COLORS[rarity] + "22" }}
    >
      {RARITY_LABELS[rarity]}
    </span>
  );
}

function PowerBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}88` }}
      />
    </div>
  );
}

function EquipmentSlotCard({ slot, item }: { slot: typeof SLOT_ORDER[number]; item?: EquippedSlot }) {
  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all
        ${item ? "bg-muted/20" : "border-dashed border-muted-foreground/20 bg-transparent"}
      `}
      style={item ? { borderColor: RARITY_COLORS[item.rarity] + "80" } : undefined}
    >
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
        style={item
          ? { backgroundColor: RARITY_COLORS[item.rarity] + "22", color: RARITY_COLORS[item.rarity] }
          : { color: "var(--muted-foreground)" }
        }
      >
        {item ? (
          <GearIcon
            name={slot === "weapon" ? "Sword" : slot === "helmet" ? "HardHat" : slot === "armor" ? "ShieldHalf" : slot === "boots" ? "Footprints" : "Gem"}
            size={16}
          />
        ) : (
          <span className="text-muted-foreground/40 text-xs">{SLOT_LABELS[slot][0]}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {item ? (
          <>
            <p className="text-sm font-medium truncate">{item.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <RarityBadge rarity={item.rarity} />
              <span className="text-xs text-muted-foreground">+{item.statPower} power</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground/50">{SLOT_LABELS[slot]} — empty</p>
        )}
      </div>
    </div>
  );
}

function GearCard({
  item,
  userXp,
  onBuy,
  onEquip,
  onUnequip,
  isBuying,
  isEquipping,
}: {
  item: GearStoreItem;
  userXp: number;
  onBuy: (id: number) => void;
  onEquip: (id: number) => void;
  onUnequip: (id: number) => void;
  isBuying: boolean;
  isEquipping: boolean;
}) {
  const rarityColor = RARITY_COLORS[item.rarity];
  const locked = !item.meetsLevel;

  return (
    <div
      className={`
        relative rounded-xl border p-4 transition-all duration-200 flex flex-col gap-3
        ${item.equipped ? "ring-1" : ""}
        ${locked ? "opacity-50" : ""}
      `}
      style={{
        borderColor: item.equipped ? rarityColor : rarityColor + "44",
        boxShadow: item.equipped ? `0 0 12px ${rarityColor}33` : undefined,
        ...(item.equipped ? { "--tw-ring-color": rarityColor } as React.CSSProperties : {}),
      }}
    >
      {item.equipped && (
        <div className="absolute top-2 right-2">
          <Check className="w-4 h-4" style={{ color: rarityColor }} />
        </div>
      )}

      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: rarityColor + "22", color: rarityColor }}
        >
          <GearIcon name={item.icon} size={20} />
        </div>
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="font-semibold text-sm leading-tight">{item.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RarityBadge rarity={item.rarity} />
        <span className="text-xs text-muted-foreground">{SLOT_LABELS[item.slot]}</span>
        <span className="ml-auto text-xs font-medium" style={{ color: rarityColor }}>
          +{item.statPower} power
        </span>
      </div>

      {locked ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3 h-3" />
          Requires Level {item.levelRequired}
        </div>
      ) : !item.owned ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8 gap-1.5"
          style={item.canAfford ? { borderColor: rarityColor + "66", color: rarityColor } : undefined}
          disabled={!item.canAfford || isBuying}
          onClick={() => onBuy(item.id)}
        >
          <Zap className="w-3 h-3" />
          {item.costXp.toLocaleString()} XP
          {!item.canAfford && (
            <span className="text-muted-foreground ml-1 text-[10px]">
              (need {(item.costXp - userXp).toLocaleString()} more)
            </span>
          )}
        </Button>
      ) : item.equipped ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-8"
          disabled={isEquipping}
          onClick={() => onUnequip(item.id)}
        >
          Unequip
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-full text-xs h-8"
          style={{ backgroundColor: rarityColor, color: "black" }}
          disabled={isEquipping}
          onClick={() => onEquip(item.id)}
        >
          Equip
        </Button>
      )}
    </div>
  );
}

function BattlePanel() {
  const qc = useQueryClient();
  const { data: battle, isLoading } = useGetBattleCurrent();
  const enterBattle = useEnterBattle();
  const { toast } = useToast();
  const [freshResult, setFreshResult] = useState<{
    result: string; xpAwarded: number; roll: number; bossPower: number; yourPower: number;
  } | null>(null);

  async function handleEnter() {
    try {
      const res = await enterBattle.mutateAsync();
      setFreshResult(res);
      await qc.invalidateQueries({ queryKey: getGetBattleCurrentQueryKey() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Battle error", description: msg, variant: "destructive" });
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-40"><Zap className="w-6 h-6 text-primary animate-pulse" /></div>;
  }
  if (!battle) return null;

  const displayResult = freshResult ?? (battle.entered && battle.result ? {
    result: battle.result,
    xpAwarded: battle.xpAwarded ?? 0,
    roll: battle.roll ?? 0,
    bossPower: battle.bossPower,
    yourPower: battle.yourPower,
  } : null);

  const maxPower = Math.max(battle.bossPower, battle.yourPower, 1) * 1.2;
  const winChancePct = battle.yourPower === 0 ? 0
    : Math.round(Math.max(0, Math.min(100,
        ((battle.yourPower * 1.25 - battle.bossPower) / (battle.yourPower * 0.5)) * 100
      )));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">Weekly Boss Battle</h3>
          <p className="text-sm text-muted-foreground">{battle.weekKey}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Win reward</p>
          <p className="font-bold text-primary flex items-center gap-1 justify-end">
            <Zap className="w-4 h-4" />{battle.winXp.toLocaleString()} XP
          </p>
        </div>
      </div>

      {/* VS display */}
      <div className="flex items-center gap-4">
        <div className="flex-1 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto">
            <Swords className="w-8 h-8 text-primary" />
          </div>
          <p className="text-xs font-medium mt-2">You</p>
          <p className="text-lg font-bold text-primary">{battle.yourPower}</p>
        </div>
        <div className="text-2xl font-black text-muted-foreground">VS</div>
        <div className="flex-1 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
            <Skull className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-xs font-medium mt-2">Boss</p>
          <p className="text-lg font-bold text-red-400">{battle.bossPower}</p>
        </div>
      </div>

      {/* Power bars */}
      <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Your Power</span>
            <span className="font-bold text-primary">{battle.yourPower}</span>
          </div>
          <PowerBar value={battle.yourPower} max={maxPower} color="#00FFFF" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Boss Power</span>
            <span className="font-bold text-red-400">{battle.bossPower}</span>
          </div>
          <PowerBar value={battle.bossPower} max={maxPower} color="#ef4444" />
        </div>
        {!battle.entered && (
          <div className="pt-1 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              Estimated win chance: <span className="font-semibold text-foreground">{winChancePct}%</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Power rolls ±25% — equip better gear to improve odds
            </p>
          </div>
        )}
      </div>

      {/* Result or Enter */}
      {displayResult ? (
        <div className={`
          rounded-xl border-2 p-5 text-center space-y-3
          ${displayResult.result === "win" ? "border-yellow-500/50 bg-yellow-500/5" : "border-red-500/50 bg-red-500/5"}
        `}>
          <div className="text-4xl">{displayResult.result === "win" ? "🏆" : "💀"}</div>
          <div>
            <h3 className={`text-2xl font-black tracking-tight ${displayResult.result === "win" ? "text-yellow-400" : "text-red-400"}`}>
              {displayResult.result === "win" ? "VICTORY!" : "DEFEATED"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              You rolled <span className="font-bold text-foreground">{displayResult.roll}</span> vs boss{" "}
              <span className="font-bold text-foreground">{displayResult.bossPower}</span>
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold ${
            displayResult.result === "win" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"
          }`}>
            <Zap className="w-4 h-4" />
            +{displayResult.xpAwarded} XP
            {displayResult.result === "lose" && " consolation"}
          </div>
          <p className="text-xs text-muted-foreground">Come back next week to battle again!</p>
        </div>
      ) : (
        <Button
          className="w-full h-12 text-base font-bold gap-2"
          onClick={handleEnter}
          disabled={enterBattle.isPending}
        >
          <Swords className="w-5 h-5" />
          {enterBattle.isPending ? "Battling…" : "Enter Battle"}
        </Button>
      )}

      {/* Rewards reference */}
      <div className="rounded-lg bg-muted/20 border border-border/50 p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rewards</p>
        <div className="flex justify-between text-sm">
          <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-yellow-400" /> Victory</span>
          <span className="font-bold text-primary">+{battle.winXp} XP</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="flex items-center gap-1.5"><Skull className="w-3.5 h-3.5 text-muted-foreground" /> Defeat</span>
          <span className="font-medium text-muted-foreground">+{battle.loseXp} XP</span>
        </div>
      </div>
    </div>
  );
}

export default function AvatarPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: avatarData, isLoading: avatarLoading } = useGetAvatar();
  const { data: storeData, isLoading: storeLoading } = useGetGearStore();
  const updateAvatar = useUpdateAvatar();
  const buyGear = useBuyGear();
  const equipGear = useEquipGear();
  const unequipGear = useUnequipGear();

  const [activeTab, setActiveTab] = useState<"store" | "battle">("store");
  const [slotFilter, setSlotFilter] = useState<SlotFilter>("all");
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [pendingSkin,  setPendingSkin]  = useState<AvatarSkin | null>(null);
  const [busyGearId, setBusyGearId] = useState<number | null>(null);

  const currentColor = pendingColor ?? avatarData?.avatarColor ?? "#6366f1";
  const currentClass = (avatarData?.avatarClass ?? "fighter") as AvatarClass;
  const currentSkin  = pendingSkin  ?? ((avatarData as any)?.avatarSkin as AvatarSkin | undefined) ?? "light";

  const equippedSlots: EquippedSlot[] = (avatarData?.equippedGear ?? []).map(g => ({
    slot: g.slot as EquippedSlot["slot"],
    rarity: g.rarity as EquippedSlot["rarity"],
    name: g.name,
    statPower: g.statPower,
  }));

  async function handleColorSelect(color: string) {
    setPendingColor(color);
    try {
      await updateAvatar.mutateAsync({ data: { avatarColor: color } });
      await qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() });
    } catch {
      setPendingColor(null);
      toast({ title: "Failed to update color", variant: "destructive" });
    }
  }

  async function handleClassSelect(cls: AvatarClass) {
    try {
      await updateAvatar.mutateAsync({ data: { avatarClass: cls } });
      await qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() });
    } catch {
      toast({ title: "Failed to update class", variant: "destructive" });
    }
  }

  async function handleSkinSelect(skin: AvatarSkin) {
    setPendingSkin(skin);
    try {
      await updateAvatar.mutateAsync({ data: { avatarSkin: skin } as any });
      await qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() });
    } catch {
      setPendingSkin(null);
      toast({ title: "Failed to update skin", variant: "destructive" });
    }
  }

  async function handleBuy(id: number) {
    setBusyGearId(id);
    try {
      const res = await buyGear.mutateAsync({ id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetGearStoreQueryKey() }),
      ]);
      toast({
        title: "Gear acquired!",
        description: `-${res.xpSpent} XP spent. ${res.remainingXp} XP remaining.`,
        className: "border-primary bg-primary/10",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Purchase failed";
      toast({ title: "Purchase failed", description: msg, variant: "destructive" });
    } finally {
      setBusyGearId(null);
    }
  }

  async function handleEquip(id: number) {
    setBusyGearId(id);
    try {
      await equipGear.mutateAsync({ id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetGearStoreQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetBattleCurrentQueryKey() }),
      ]);
    } catch {
      toast({ title: "Failed to equip", variant: "destructive" });
    } finally {
      setBusyGearId(null);
    }
  }

  async function handleUnequip(id: number) {
    setBusyGearId(id);
    try {
      await unequipGear.mutateAsync({ id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetGearStoreQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetBattleCurrentQueryKey() }),
      ]);
    } catch {
      toast({ title: "Failed to unequip", variant: "destructive" });
    } finally {
      setBusyGearId(null);
    }
  }

  const filteredItems = (storeData?.items ?? []).filter(
    item => slotFilter === "all" || item.slot === slotFilter
  );

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Hero</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Customize your avatar and gear up for the weekly battle
          </p>
        </div>
        {avatarData && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30">
            <Swords className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary">{avatarData.battlePower}</span>
            <span className="text-xs text-muted-foreground">power</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* ── Left: Character Panel ─────────────────────────── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/50 p-4 flex flex-col items-center gap-4">
            {avatarLoading ? (
              <div className="w-[160px] h-[192px] rounded-lg bg-muted/30 animate-pulse" />
            ) : (
              <AvatarRenderer
                color={currentColor}
                skin={currentSkin}
                avatarClass={currentClass}
                equipped={equippedSlots}
                size={160}
                showGlow
              />
            )}

            {/* Class selector */}
            <div className="w-full space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Class</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CLASS_INFO).map(([cls, info]) => (
                  <button
                    key={cls}
                    onClick={() => handleClassSelect(cls as AvatarClass)}
                    disabled={updateAvatar.isPending}
                    className={`
                      px-2 py-2 rounded-lg border text-xs font-medium transition-all
                      ${currentClass === cls
                        ? "text-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground"}
                    `}
                    style={currentClass === cls ? {
                      borderColor: info.color + "80",
                      backgroundColor: info.color + "15",
                      color: info.color,
                    } : undefined}
                  >
                    {info.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Skin tone picker */}
            <div className="w-full space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Skin</p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(SKIN_PALETTES) as [AvatarSkin, typeof SKIN_PALETTES[AvatarSkin]][]).map(([key, palette]) => (
                  <button
                    key={key}
                    onClick={() => handleSkinSelect(key)}
                    disabled={updateAvatar.isPending}
                    className={`
                      flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs font-medium transition-all
                      ${currentSkin === key
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground"}
                    `}
                  >
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
                      style={{ backgroundColor: palette.base }}
                    />
                    {palette.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Palette (armor + hair color) */}
            <div className="w-full space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Palette</p>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => handleColorSelect(color)}
                    disabled={updateAvatar.isPending}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${currentColor === color ? "scale-110" : "hover:scale-105"}`}
                    style={{
                      backgroundColor: color,
                      borderColor: currentColor === color ? "white" : "transparent",
                      boxShadow: currentColor === color ? `0 0 8px ${color}` : undefined,
                    }}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Equipment slots */}
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Equipment</p>
            {SLOT_ORDER.map(slot => {
              const item = equippedSlots.find(e => e.slot === slot);
              return <EquipmentSlotCard key={slot} slot={slot} item={item} />;
            })}
          </div>
        </div>

        {/* ── Right: Tabs ───────────────────────────────────── */}
        <div className="space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-muted/30 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab("store")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "store" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ShoppingBag className="w-4 h-4" /> Gear Store
            </button>
            <button
              onClick={() => setActiveTab("battle")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "battle" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Swords className="w-4 h-4" /> Weekly Battle
            </button>
          </div>

          {activeTab === "store" && (
            <div className="space-y-4">
              {/* XP balance */}
              {storeData && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Available XP:</span>
                  <span className="font-bold text-primary">{storeData.userXp.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground ml-auto">Level {storeData.userLevel}</span>
                </div>
              )}

              {/* Slot filter */}
              <div className="flex flex-wrap gap-1.5">
                {(["all", ...SLOT_ORDER] as SlotFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setSlotFilter(f)}
                    className={`
                      px-3 py-1 rounded-full text-xs font-medium transition-all border
                      ${slotFilter === f
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"}
                    `}
                  >
                    {f === "all" ? "All" : SLOT_LABELS[f]}
                  </button>
                ))}
              </div>

              {/* Gear grid */}
              {storeLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-36 rounded-xl bg-muted/30 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredItems.map(item => (
                    <GearCard
                      key={item.id}
                      item={item}
                      userXp={storeData?.userXp ?? 0}
                      onBuy={handleBuy}
                      onEquip={handleEquip}
                      onUnequip={handleUnequip}
                      isBuying={busyGearId === item.id && buyGear.isPending}
                      isEquipping={busyGearId === item.id && (equipGear.isPending || unequipGear.isPending)}
                    />
                  ))}
                  {filteredItems.length === 0 && (
                    <p className="col-span-2 text-sm text-muted-foreground text-center py-8">No items found.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "battle" && <BattlePanel />}
        </div>
      </div>
    </div>
  );
}
