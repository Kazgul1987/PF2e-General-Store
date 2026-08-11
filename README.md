# PF2e General Store

Ein Foundry-VTT-Modul für **Pathfinder 2e**, das einen kompakt durchsuchbaren General Store mit Warenkorb, Verkauf, Wunschliste, Party-Stash und mehreren szenenabhängigen Shops bereitstellt.

## Zielplattform

- Foundry VTT v14
- PF2e 7.9.1 oder eine neuere, mit Foundry v14 kompatible Version

## Architektur

Der kleine Einstiegspunkt `scripts/main.js` registriert Einstellungen und Hooks. Die bestehende Oberfläche wurde verhaltensschonend nach `scripts/applications/store-app.js` verschoben; neue fachliche Grenzen liegen in `data/`, `pf2e/` und `wishlist/`. PF2e-Währungs- und Transaktionszugriffe sind zentralisiert, Compendium-Indizes werden dedupliziert zwischengespeichert und Shop-Daten werden beim Lesen normalisiert.

Die moduleigenen Oberflächen für `StoreApp`, `WishlistApp`, `SellApp`, `StoreManagerApp` und `GmFiltersApp` verwenden unter Foundry VTT v14 `ApplicationV2` mit `HandlebarsApplicationMixin`. Kleine modale Interaktionen verwenden `DialogV2`; Scene Controls werden über `getSceneControlButtons` registriert.

Die Schichten bleiben bewusst getrennt: **Applications → Services → Foundry/PF2e APIs**. Die Applications koordinieren Darstellung und Eingaben, während Währungs-, Kauf-, Verkaufs-, Wunschlisten- und Shoplogik in den bestehenden Services verbleibt.

## Installation

1. Modul über die Foundry-Paketverwaltung installieren.
2. **PF2e General Store** in den Moduleinstellungen des Worlds aktivieren.

## Datenkompatibilität

Die vorhandenen Setting-Keys (`gmFilters`, `wishlistState`, `wishlistStateClient`, `storeDefinitions`, `activeStoreId`) und das gleichnamige Szenen-Flag bleiben erhalten. Alte flache Shop-Definitionen werden tolerant in das neue Availability-/Pricing-Schema normalisiert und nicht automatisch zurückgesetzt.
