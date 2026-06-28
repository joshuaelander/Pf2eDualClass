## Pf2eDualClass
A Foundry VTT module for PF2e that overlays a secondary class onto a character
sheet by converting a dropped second `class` item into a flagged `feat` and
emitting PF2e `system.rules` (e.g., `GrantProficiency`, `FlatModifier`) so the
PF2e rule engine can apply secondary-class benefits without replacing the
primary class.

**Key features**
- Convert a second `class` drop into a `feat` flagged as a secondary class.
- Emit `GrantProficiency` rules for saves and proficiencies (weapons/armor/skills).
- Emit `FlatModifier` for key-ability and HP adjustments where appropriate.
- UI summary and secondary-class feat slots in the character `Feats` tab.

**Usage**
1. Install the module and enable it for your world.
2. Drop a second `class` item onto a character sheet; the module converts it
	 into a flagged `feat` representing the secondary class.
3. Open the character's `Feats` tab to view the Secondary Class summary and
	 slots for secondary-class feats.

**Refreshing / Re-applying**
- The module adds a small `Refresh Secondary Class` control in the secondary
	class summary that re-runs derived-data preparation so rule elements and
	synthetics are re-applied (useful after manual edits or importing content).
