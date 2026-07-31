import type { CosmeticCategory, CosmeticsPanelProps } from "../ui-types";
import { Icon, type IconName } from "./Icons";

const categories: ReadonlyArray<{ id: CosmeticCategory; label: string; icon: IconName }> = [
  { id: "shell", label: "Shells", icon: "shell" },
  { id: "trail", label: "Trails", icon: "trail" },
  { id: "burst", label: "Bursts", icon: "burst" },
];

export function CosmeticsPanel({
  items,
  activeCategory,
  onCategoryChange,
  onEquip,
}: CosmeticsPanelProps) {
  const visibleItems = items.filter((item) => item.category === activeCategory);

  return (
    <div className="vp-cosmetics-panel">
      <div aria-label="Cosmetic category" className="vp-segmented" role="tablist">
        {categories.map((category) => (
          <button
            aria-selected={activeCategory === category.id}
            className="vp-segmented__item"
            key={category.id}
            onClick={() => onCategoryChange(category.id)}
            role="tab"
            type="button"
          >
            <Icon name={category.icon} size={17} />
            {category.label}
          </button>
        ))}
      </div>

      <div className="vp-cosmetic-stage" data-accent={visibleItems.find((item) => item.equipped)?.accent ?? "cyan"}>
        <div aria-hidden="true" className="vp-cosmetic-stage__grid" />
        <div aria-hidden="true" className="vp-cosmetic-stage__runner">
          <span className="vp-cosmetic-stage__trail" />
          <span className="vp-cosmetic-stage__shell" />
        </div>
        <p>Live signal preview</p>
      </div>

      <div className="vp-cosmetic-grid" role="tabpanel">
        {visibleItems.length > 0 ? visibleItems.map((item) => (
          <button
            aria-label={`${item.name}${item.equipped ? ", equipped" : item.owned ? ", equip" : ", locked"}`}
            className={`vp-cosmetic-card${item.equipped ? " is-equipped" : ""}`}
            data-accent={item.accent}
            disabled={!item.owned}
            key={item.id}
            onClick={() => onEquip(item.id)}
            type="button"
          >
            <span aria-hidden="true" className="vp-cosmetic-card__visual">
              {item.category === "shell" && <span className="vp-mini-shell" />}
              {item.category === "trail" && <span className="vp-mini-trail" />}
              {item.category === "burst" && <span className="vp-mini-burst"><Icon name="burst" size={29} /></span>}
            </span>
            <span className="vp-cosmetic-card__copy">
              <strong>{item.name}</strong>
              <small>{item.equipped ? "Equipped" : item.owned ? item.description ?? "Ready" : "Signal locked"}</small>
            </span>
            {!item.owned && <Icon className="vp-cosmetic-card__lock" name="lock" size={16} />}
          </button>
        )) : (
          <p className="vp-empty-state">No cosmetics detected in this signal band.</p>
        )}
      </div>
    </div>
  );
}
